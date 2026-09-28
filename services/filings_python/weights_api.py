"""Private compute adapter. Dashboard authenticates humans and stores immutable runs."""
import csv
import io
import json
import importlib.metadata
from typing import Literal
import pandas as pd
from pydantic import BaseModel, Field, ConfigDict
from .portfolio_weights import run_pipeline, finalize
from .portfolio_weights.pipeline import ENGINE_VERSION

class WeightConfig(BaseModel):
    model_config = ConfigDict(extra='forbid')
    objective: Literal['balanced', 'max_sharpe', 'min_vol', 'max_growth'] = 'balanced'
    rf: float = Field(default=0.02, ge=-0.1, le=0.5, allow_inf_nan=False)
    max_drawdown: float | None = Field(default=None, gt=0, le=1, allow_inf_nan=False)
    est_window: int = Field(default=756, ge=60, le=1260)
    step: int = Field(default=126, ge=21, le=252)
    cost: float = Field(default=0.001, ge=0, le=0.02, allow_inf_nan=False)
    n_boot: int = Field(default=60, ge=10, le=100)
    seed: int = Field(default=0, ge=0, le=2147483647)
    per_asset_max: float = Field(default=0.60, gt=0, le=1, allow_inf_nan=False)

class ComputeRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    prices_csv: str = Field(min_length=20, max_length=2_000_000)
    assets: list[str] = Field(min_length=2, max_length=12)
    config: WeightConfig = Field(default_factory=WeightConfig)

class ConfirmRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    recommendation: dict
    weights_table: dict
    user_choice: str | dict[str, float]
    per_asset_max: float = Field(gt=0, le=1)


def compute(body: ComputeRequest):
    header = next(csv.reader(io.StringIO(body.prices_csv)))
    if len(header) != len(set(header)) or set(header[1:]) != set(body.assets):
        raise ValueError('CSV columns must match exactly the current holding tickers, without duplicates')
    frame = pd.read_csv(io.StringIO(body.prices_csv), index_col=0)
    if not body.config.est_window + body.config.step + 1 <= len(frame) <= 3000:
        raise ValueError('History needs estimation + rebalance window + 1 price rows, up to 3000')
    frame.index = pd.to_datetime(frame.index, format='%Y-%m-%d', errors='raise')
    if frame.index.isna().any():
        raise ValueError('Every row requires a valid date')
    frame = frame[body.assets].apply(pd.to_numeric, errors='raise').sort_index()
    gaps = frame.index.to_series().diff().dt.days.dropna()
    if gaps.median() > 2 or (gaps > 7).any() or (frame.index > pd.Timestamp.now().normalize()).any():
        raise ValueError('Daily history required: no future dates or gaps longer than seven days')
    if frame.index[-1] < pd.Timestamp.now().normalize()-pd.Timedelta(days=10):
        raise ValueError('Price snapshot is stale: latest observation must be within ten days')
    result = run_pipeline(frame, **body.config.model_dump())
    payload = {key: value for key, value in result.items() if key != 'navs'}
    for name in ('weights_table', 'oos_summary', 'stability'):
        payload[name] = result[name].to_dict() if name == 'weights_table' else result[name].to_dict('index')
    payload['engine_version'] = ENGINE_VERSION
    payload['dependencies'] = {name: importlib.metadata.version(name) for name in ('numpy', 'pandas', 'scipy', 'scikit-learn')}
    payload['data_range'] = {'start': str(frame.index[0].date()), 'end': str(frame.index[-1].date()), 'rows': len(frame)}
    # Enforce JSON-safe output at the computation boundary.
    return json.loads(json.dumps(payload, allow_nan=False))


def confirm(body: ConfirmRequest):
    return finalize(body.recommendation, body.user_choice,
                    pd.DataFrame(body.weights_table), body.per_asset_max)
