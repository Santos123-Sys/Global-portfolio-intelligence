"""Private Railway service: PDF -> structured draft -> deterministic Python analysis."""
import base64
import hmac
import os
import re
import asyncio
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field
from openai import OpenAI
from .analysis import Extraction, analyze
from .ibkr_portfolio import (IBKRSettings, OrderPreviewRequest, build_order_preview,
                             build_snapshot, connect_session)

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

class ExtractionRequest(BaseModel):
    content_base64: str = Field(max_length=7_000_000)
    file_name: str = Field(min_length=1, max_length=160)
    expected_issuer: str = Field(min_length=3, max_length=200)
    expected_currency: str = Field(pattern=r'^[A-Z]{3}$')

@app.get('/health')
def health():
    return {'status': 'ok'}

def issuer_matches(expected: str, extracted: str) -> bool:
    words = lambda value: [word for word in re.sub(r'[^A-Z0-9 ]', ' ', value.upper()).split()
                           if len(word) >= 4 and word not in {'GROUP', 'HOLDING', 'HOLDINGS', 'LIMITED', 'COMPANY'}]
    return bool(set(words(expected)) & set(words(extracted)))

@app.post('/v1/financial-extractions')
def financial_extraction(body: ExtractionRequest, authorization: str = Header(default='')):
    secret = os.getenv('FILINGS_INTERNAL_TOKEN', '')
    if len(secret) < 32 or not hmac.compare_digest(authorization, f'Bearer {secret}'):
        raise HTTPException(401, 'Unauthorized')
    try:
        pdf = base64.b64decode(body.content_base64, validate=True)
    except Exception:
        raise HTTPException(400, 'Invalid document encoding')
    if not pdf.startswith(b'%PDF-') or b'%%EOF' not in pdf[-4096:] or len(pdf) > 5_000_000:
        raise HTTPException(400, 'Complete PDF of at most 5 MB required')
    if re.search(rb'/(?:JavaScript|JS|Launch|EmbeddedFile|Filespec|RichMedia|XFA|AA|Encrypt)\b', pdf, re.I):
        raise HTTPException(400, 'Active or encrypted PDF is not accepted')
    client = OpenAI(api_key=os.environ['OPENAI_API_KEY'], timeout=90, max_retries=1)
    result = client.responses.parse(
        model=os.getenv('FILINGS_EXTRACTION_MODEL', 'gpt-4.1'),
        instructions=('Extract only explicitly printed consolidated annual financial figures from the PDF. '
                      'Copy the issuer, exact fiscal start/end, currency, displayed amount, unit multiplier, PDF page number, '
                      'and a short evidence quote for each fact. Allowed metrics: revenue, gross_profit, operating_income, '
                      'net_income, operating_cash_flow, capital_expenditure, cash_and_equivalents, total_debt, total_equity, '
                      'shares_outstanding. Do not compute, infer, convert currencies, choose between conflicting contexts, '
                      'or invent a missing fact. For uncertainty, add a gap and omit the fact. Output a draft for human review.'),
        input=[{'role': 'user', 'content': [
            {'type': 'input_text', 'text': f'Issuer: {body.expected_issuer}. Expected native currency: {body.expected_currency}.'},
            {'type': 'input_file', 'filename': body.file_name,
             'file_data': f'data:application/pdf;base64,{body.content_base64}'},
        ]}],
        text_format=Extraction,
    )
    extracted = result.output_parsed
    if extracted is None:
        raise HTTPException(422, 'No structured PDF extraction returned')
    if not issuer_matches(body.expected_issuer, extracted.issuer_name):
        raise HTTPException(422, 'Extracted issuer does not match candidate')
    analysis = analyze(extracted, body.expected_currency)
    return {'extraction': extracted.model_dump(), 'analysis': analysis}

# Reuse the deployed private Python runtime; no LLM participates in allocation.
from .weights_api import ComputeRequest, ConfirmRequest, compute, confirm
from threading import BoundedSemaphore
_weights_slot = BoundedSemaphore(1)


def authorize_weights(authorization):
    secret = os.getenv('FILINGS_INTERNAL_TOKEN', '')
    if len(secret) < 32 or not hmac.compare_digest(authorization, f'Bearer {secret}'):
        raise HTTPException(401, 'Unauthorized')


def authorize_internal(authorization):
    authorize_weights(authorization)


_ibkr_slot = asyncio.Lock()


@app.post('/v1/ibkr/snapshot')
async def ibkr_snapshot(authorization: str = Header(default='')):
    authorize_internal(authorization)
    if _ibkr_slot.locked():
        raise HTTPException(429, 'IBKR adapter is busy; retry shortly')
    async with _ibkr_slot:
        session = None
        try:
            settings = IBKRSettings.from_env()
            session = await connect_session(settings)
            return build_snapshot(session, settings.account)
        except (ConnectionError, TimeoutError, OSError, ValueError) as error:
            raise HTTPException(503, str(error)) from error
        finally:
            if session: session.disconnect()


@app.post('/v1/ibkr/order-preview')
async def ibkr_order_preview(body: OrderPreviewRequest, authorization: str = Header(default='')):
    authorize_internal(authorization)
    if _ibkr_slot.locked():
        raise HTTPException(429, 'IBKR adapter is busy; retry shortly')
    async with _ibkr_slot:
        session = None
        try:
            settings = IBKRSettings.from_env()
            session = await connect_session(settings)
            snapshot = build_snapshot(session, settings.account)
            price = await session.price(body)
            position = next((row for row in snapshot['positions']
                             if row['symbol'] == body.symbol and row['currency'] == body.currency), None)
            return build_order_preview(body, price, snapshot['available_funds'], settings,
                                       position['quantity'] if position else 0)
        except (ConnectionError, TimeoutError, OSError, ValueError) as error:
            raise HTTPException(503, str(error)) from error
        finally:
            if session: session.disconnect()


@app.post('/v1/portfolio-weights/compute')
def portfolio_weights_compute(body: ComputeRequest, authorization: str = Header(default='')):
    authorize_weights(authorization)
    if not _weights_slot.acquire(blocking=False):
        raise HTTPException(429, 'Allocation engine is busy; retry shortly')
    try:
        return compute(body)
    except (ValueError, TypeError, KeyError) as error:
        raise HTTPException(422, str(error)) from error
    finally:
        _weights_slot.release()


@app.post('/v1/portfolio-weights/finalize')
def portfolio_weights_finalize(body: ConfirmRequest, authorization: str = Header(default='')):
    authorize_weights(authorization)
    try:
        return confirm(body)
    except (ValueError, TypeError, KeyError) as error:
        raise HTTPException(422, str(error)) from error


@app.get('/v1/portfolio-weights/example')
def portfolio_weights_example(authorization: str = Header(default='')):
    authorize_weights(authorization)
    if not _weights_slot.acquire(blocking=False):
        raise HTTPException(429, 'Allocation engine is busy; retry shortly')
    try:
        from .example_portfolio import compute_example
        return compute_example()
    finally:
        _weights_slot.release()
