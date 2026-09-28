"""Educational sandbox: fictional issuers and seeded SYNTHETIC prices only."""
from functools import lru_cache
import importlib.metadata
import json
import numpy as np
from .portfolio_weights import run_pipeline, synthetic_prices
from .portfolio_weights.pipeline import ENGINE_VERSION

EXAMPLE_ASSETS = ('DEMO-ALP', 'DEMO-LIM', 'DEMO-CED', 'DEMO-RIG', 'DEMO-AAR', 'DEMO-TIC')
EXAMPLE_STARTING_WEIGHTS = (0.25, 0.20, 0.18, 0.15, 0.12, 0.10)
EXAMPLE_CONFIG = dict(objective='balanced', rf=0.02, max_drawdown=0.25,
                      est_window=504, step=63, cost=0.001, n_boot=20,
                      seed=17, per_asset_max=0.50)


@lru_cache(maxsize=1)
def compute_example():
    # Reuse the production computation engine, but bypass the real-data CSV
    # adapter. The sandbox never enters portfolio holdings or confirmation.
    prices = synthetic_prices(seed=2026, n_days=1008, n_assets=6, start='2022-01-03')
    prices.columns = list(EXAMPLE_ASSETS)
    result = run_pipeline(prices, **EXAMPLE_CONFIG)
    payload = {key: value for key, value in result.items() if key != 'navs'}
    payload['weights_table'] = result['weights_table'].to_dict()
    payload['oos_summary'] = result['oos_summary'].to_dict('index')
    payload['stability'] = result['stability'].to_dict('index')
    payload['engine_version'] = ENGINE_VERSION
    payload['data_range'] = {'start': str(prices.index[0].date()),
                             'end': str(prices.index[-1].date()), 'rows': len(prices)}
    payload['dependencies'] = {name: importlib.metadata.version(name)
                               for name in ('numpy', 'pandas', 'scipy', 'scikit-learn')}
    returns = np.log(prices/prices.shift(1)).dropna()
    payload['asset_annualized_volatility'] = {
        name: float(returns[name].std() * np.sqrt(252)) for name in EXAMPLE_ASSETS}
    payload['sample_starting_weights'] = dict(zip(EXAMPLE_ASSETS, EXAMPLE_STARTING_WEIGHTS))
    payload['data_kind'] = 'synthetic_educational_example'
    return json.loads(json.dumps(payload, allow_nan=False))
