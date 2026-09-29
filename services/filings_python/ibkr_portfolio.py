"""Read-only Interactive Brokers portfolio adapter and guarded order previews.

The adapter intentionally exposes no order-submission function. TWS or IB
Gateway owns authentication; this service connects with ``readonly=True``.
"""
from __future__ import annotations

import math
import os
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal, ROUND_DOWN
from typing import Any, Protocol

from pydantic import BaseModel, Field, field_validator


SYMBOL = re.compile(r"^[A-Z0-9][A-Z0-9.\-]{0,19}$")
MIC = re.compile(r"^[A-Z0-9]{2,12}$")


class OrderPreviewRequest(BaseModel):
    symbol: str = Field(min_length=1, max_length=20)
    exchange: str = Field(min_length=2, max_length=12)
    currency: str = Field(pattern=r"^[A-Z]{3}$")
    amount: float = Field(gt=0)
    side: str = Field(pattern=r"^(BUY|SELL)$")
    order_type: str = Field(pattern=r"^(MKT|LMT)$")
    limit_price: float | None = Field(default=None, gt=0)

    @field_validator('symbol')
    @classmethod
    def clean_symbol(cls, value: str) -> str:
        value = value.strip().upper()
        if not SYMBOL.fullmatch(value):
            raise ValueError('Unsupported symbol format')
        return value

    @field_validator('exchange')
    @classmethod
    def clean_exchange(cls, value: str) -> str:
        value = value.strip().upper()
        if not MIC.fullmatch(value):
            raise ValueError('Unsupported exchange format')
        return value


@dataclass(frozen=True)
class IBKRSettings:
    enabled: bool
    host: str
    port: int
    client_id: int
    account: str
    max_order_amount: float
    max_cash_portion: float
    allowed_symbols: frozenset[str]

    @classmethod
    def from_env(cls) -> 'IBKRSettings':
        enabled = os.getenv('IBKR_ENABLED', 'false').strip().lower() == 'true'
        host = os.getenv('IBKR_HOST', '').strip()
        if enabled and not host:
            raise ValueError('IBKR_HOST is required when IBKR_ENABLED=true')
        port = int(os.getenv('IBKR_PORT', '4002'))
        if not 1 <= port <= 65535:
            raise ValueError('IBKR_PORT must be a valid TCP port')
        max_order = float(os.getenv('IBKR_MAX_ORDER_AMOUNT', '10000'))
        max_cash = float(os.getenv('IBKR_MAX_CASH_PORTION', '0.25'))
        if max_order <= 0 or not 0 < max_cash <= 1:
            raise ValueError('IBKR preview guardrails are invalid')
        allowed = frozenset(item.strip().upper() for item in os.getenv('IBKR_ALLOWED_SYMBOLS', '').split(',') if item.strip())
        return cls(enabled, host, port, int(os.getenv('IBKR_CLIENT_ID', '41')),
                   os.getenv('IBKR_ACCOUNT', '').strip(), max_order, max_cash, allowed)


class BrokerSession(Protocol):
    def account_summary(self) -> list[Any]: ...
    def portfolio(self) -> list[Any]: ...
    def fills(self) -> list[Any]: ...
    async def price(self, request: OrderPreviewRequest) -> float: ...
    def disconnect(self) -> None: ...


def _finite(value: Any, default: float = 0.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    return number if math.isfinite(number) else default


def _iso_fill_time(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def build_snapshot(session: BrokerSession, account_hint: str = '') -> dict[str, Any]:
    summaries = session.account_summary()
    accounts = sorted({str(row.account) for row in summaries if getattr(row, 'account', None)})
    if account_hint:
        summaries = [row for row in summaries if getattr(row, 'account', '') == account_hint]
    elif len(accounts) > 1:
        raise ValueError('IBKR_ACCOUNT is required when the session exposes multiple accounts')
    account = account_hint or (accounts[0] if accounts else '')
    masked = f'…{account[-4:]}' if account else 'unavailable'

    values: dict[tuple[str, str], float] = {}
    for row in summaries:
        values[(str(getattr(row, 'tag', '')), str(getattr(row, 'currency', '')))] = _finite(getattr(row, 'value', 0))
    base_row = next((row for row in summaries if getattr(row, 'tag', '') == 'NetLiquidation' and getattr(row, 'currency', '') not in ('', 'BASE')), None)
    base_currency = str(getattr(base_row, 'currency', 'USD'))
    def value(tag: str) -> float:
        return values.get((tag, base_currency), values.get((tag, 'BASE'), 0.0))

    earliest: dict[int, datetime] = {}
    for fill in session.fills():
        contract = getattr(fill, 'contract', None)
        execution = getattr(fill, 'execution', None)
        if not contract or not execution or str(getattr(execution, 'side', '')).upper() not in ('BOT', 'BUY'):
            continue
        con_id = int(getattr(contract, 'conId', 0) or 0)
        when = _iso_fill_time(getattr(fill, 'time', None) or getattr(execution, 'time', None))
        if con_id and when and (con_id not in earliest or when < earliest[con_id]):
            earliest[con_id] = when

    now = datetime.now(timezone.utc)
    positions, gaps = [], []
    for item in session.portfolio():
        contract = item.contract
        if str(getattr(contract, 'secType', '')) != 'STK':
            gaps.append(f"Excluded non-equity contract {getattr(contract, 'localSymbol', '') or getattr(contract, 'symbol', 'unknown')}")
            continue
        quantity = _finite(item.position)
        if quantity <= 0:
            gaps.append(f"Excluded zero or short position {getattr(contract, 'localSymbol', '') or getattr(contract, 'symbol', 'unknown')}")
            continue
        avg_cost = _finite(item.averageCost)
        last = _finite(item.marketPrice)
        market_value = _finite(item.marketValue)
        cost_basis = quantity * avg_cost
        return_pct = market_value / cost_basis - 1 if cost_basis > 0 else None
        detected = earliest.get(int(getattr(contract, 'conId', 0) or 0))
        days = max(0, (now - detected).days) if detected else None
        annualized = ((1 + return_pct) ** (365 / days) - 1
                      if return_pct is not None and return_pct > -1 and days and days >= 30 else None)
        positions.append({
            'con_id': int(getattr(contract, 'conId', 0) or 0),
            'symbol': str(getattr(contract, 'localSymbol', '') or getattr(contract, 'symbol', '')).upper(),
            'exchange': str(getattr(contract, 'primaryExchange', '') or getattr(contract, 'exchange', '')).upper(),
            'currency': str(getattr(contract, 'currency', '')).upper(),
            'quantity': quantity, 'avg_cost': avg_cost, 'last_price': last,
            'cost_basis': cost_basis, 'market_value': market_value,
            'unrealized_pnl': _finite(item.unrealizedPNL, market_value - cost_basis),
            'return_pct': return_pct,
            'first_detected_fill': detected.date().isoformat() if detected else None,
            'days_since_detected_fill': days,
            'annualized_return_pct': annualized,
        })
    positions.sort(key=lambda row: (-abs(row['market_value']), row['symbol']))
    if positions and not earliest:
        gaps.append('Entry dates unavailable: IBKR execution history returned no matching fills')
    elif earliest:
        gaps.append('Entry dates use only execution history exposed by this TWS/Gateway session and may not represent the original purchase')
    return {
        'provider': 'interactive_brokers', 'read_only': True, 'account_masked': masked,
        'base_currency': base_currency, 'cash': value('TotalCashValue'),
        'net_liquidation': value('NetLiquidation'), 'available_funds': value('AvailableFunds'),
        'buying_power': value('BuyingPower'), 'captured_at': now.isoformat(),
        'positions': positions, 'information_gaps': gaps,
    }


def build_order_preview(request: OrderPreviewRequest, price: float, available_funds: float,
                        settings: IBKRSettings, position_quantity: float = 0) -> dict[str, Any]:
    if request.order_type == 'LMT' and request.limit_price is None:
        raise ValueError('limit_price is required for LMT previews')
    reference_price = request.limit_price if request.order_type == 'LMT' else price
    if not math.isfinite(reference_price) or reference_price <= 0:
        raise ValueError('A positive market or limit price is required')
    quantity = int((Decimal(str(request.amount)) / Decimal(str(reference_price))).quantize(Decimal('1'), rounding=ROUND_DOWN))
    blockers = []
    if quantity < 1: blockers.append('Requested amount buys fewer than one whole share')
    if request.amount > settings.max_order_amount: blockers.append('Requested amount exceeds the configured preview cap')
    if request.side == 'BUY' and request.amount > available_funds * settings.max_cash_portion:
        blockers.append('Requested amount exceeds the configured portion of available funds')
    if request.side == 'SELL' and quantity > position_quantity:
        blockers.append('Preview quantity exceeds the matching long position')
    if settings.allowed_symbols and request.symbol not in settings.allowed_symbols:
        blockers.append('Symbol is outside IBKR_ALLOWED_SYMBOLS')
    return {
        'provider': 'interactive_brokers', 'preview_only': True, 'transmitted': False,
        'symbol': request.symbol, 'exchange': request.exchange, 'currency': request.currency,
        'side': request.side, 'order_type': request.order_type, 'limit_price': request.limit_price,
        'reference_price': price, 'requested_amount': request.amount,
        'quantity': max(0, quantity), 'estimated_value': max(0, quantity) * reference_price,
        'eligible': not blockers, 'blockers': blockers,
    }


async def connect_session(settings: IBKRSettings):
    if not settings.enabled:
        raise ValueError('IBKR integration is disabled')
    from ib_async import IB, Stock

    class Session:
        def __init__(self):
            self.ib = IB()
        async def connect(self):
            await self.ib.connectAsync(settings.host, settings.port, clientId=settings.client_id,
                                       timeout=8, readonly=True, account=settings.account)
            return self
        def account_summary(self): return self.ib.accountSummary(settings.account)
        def portfolio(self): return self.ib.portfolio(settings.account)
        def fills(self): return self.ib.fills()
        async def price(self, request: OrderPreviewRequest):
            contract = Stock(request.symbol, request.exchange, request.currency)
            qualified = await self.ib.qualifyContractsAsync(contract)
            if len(qualified) != 1:
                raise ValueError('IBKR could not uniquely qualify the requested contract')
            tickers = await self.ib.reqTickersAsync(qualified[0])
            price = _finite(tickers[0].marketPrice() if tickers else 0)
            if price <= 0: raise ValueError('IBKR returned no usable market price')
            return price
        def disconnect(self):
            if self.ib.isConnected(): self.ib.disconnect()
    return await Session().connect()
