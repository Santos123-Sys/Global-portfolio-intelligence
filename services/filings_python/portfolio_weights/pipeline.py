"""Deterministic computation; a separate authenticated action confirms targets."""
import numpy as np
import pandas as pd
from .data import log_returns
from .estimation import estimate
from .methods import compute_weights
from .validation import walk_forward, bootstrap_stability
from .recommend import recommend, finalize

ENGINE_VERSION = 'portfolio-weights/1.0.0'


def run_pipeline(prices, objective='balanced', rf=0.02, max_drawdown=None,
                 est_window=756, step=126, cost=0.001, n_boot=60, seed=0,
                 per_asset_max=0.60, user_choice=None):
    prices = prices.copy().sort_index()
    if prices.index.has_duplicates or prices.columns.has_duplicates or prices.shape[1] < 2:
        raise ValueError('Unique dates and at least two unique assets required')
    # Reject gaps instead of inventing stale prices or artificial zero returns.
    if not np.isfinite(prices.values).all() or (prices.values <= 0).any():
        raise ValueError('Prices must be positive, finite and aligned without gaps')
    if not 20 <= est_window <= 1260 or not 5 <= step <= 252 or not 2 <= n_boot <= 100:
        raise ValueError('Invalid validation window or bootstrap count')
    if not np.isfinite([rf, cost, per_asset_max]).all() or not -0.1 <= rf <= 0.5 or not 0 <= cost <= 0.02:
        raise ValueError('Invalid risk-free rate or transaction cost')
    if max_drawdown is not None and not 0 < max_drawdown <= 1:
        raise ValueError('Drawdown limit must be in (0, 1]')
    ret = log_returns(prices)
    mu, S = estimate(ret)
    wtab = compute_weights(mu, S, rf=rf, per_asset_max=per_asset_max)
    wtab.index = prices.columns
    oos, navs = walk_forward(ret, est_window, step, cost, rf, per_asset_max=per_asset_max)
    stab = bootstrap_stability(ret, n_boot=n_boot, rf=rf, seed=seed, per_asset_max=per_asset_max)
    rec = recommend(wtab, oos, stab, objective=objective, max_drawdown=max_drawdown, turnover_cost=cost)
    result = {'inputs': {'engine_version': ENGINE_VERSION, 'asset_order': prices.columns.tolist(), 'objective': objective, 'rf': rf,
                        'max_drawdown': max_drawdown, 'est_window': est_window, 'step': step,
                        'cost': cost, 'n_boot': n_boot, 'seed': seed, 'per_asset_max': per_asset_max},
              'weights_table': wtab, 'oos_summary': oos, 'stability': stab, 'recommendation': rec, 'navs': navs}
    if user_choice is not None:
        result['final'] = finalize(rec, user_choice, wtab, per_asset_max)
    return result
