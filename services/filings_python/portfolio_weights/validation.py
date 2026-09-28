"""Out-of-sample buy-and-hold segments, daily marked weights, and seeded bootstrap."""
import numpy as np
import pandas as pd
from .estimation import estimate, TRADING_DAYS
from .methods import METHODS, compute_weights


def perf_metrics(returns, rf=0.02):
    nav = (1+returns).cumprod()
    cagr = nav.iloc[-1]**(TRADING_DAYS/len(returns))-1
    vol = returns.std(ddof=1)*np.sqrt(TRADING_DAYS)
    peak = np.maximum.accumulate(np.r_[1.0, nav.values])[1:]
    return {'cagr': float(cagr), 'vol': float(vol),
            'sharpe': float((returns.mean()*TRADING_DAYS-rf)/vol) if vol > 1e-12 else 0.0,
            'max_drawdown': float(np.min(nav.values/peak-1))}


def walk_forward(ret, est_window=756, step=126, cost=0.001, rf=0.02,
                 methods=None, per_asset_max=0.60):
    if len(ret) < est_window+step:
        raise ValueError('History must include estimation window plus a full out-of-sample segment')
    names = methods or list(METHODS)
    port = {m: [] for m in names}
    turns = {m: 0.0 for m in names}
    previous = {m: np.zeros(ret.shape[1]) for m in names}
    for t in range(est_window, len(ret), step):
        mu, S = estimate(ret.iloc[t-est_window:t])
        weights = compute_weights(mu, S, rf, names, per_asset_max)
        # ret is log return: convert each asset BEFORE portfolio aggregation.
        simple = np.expm1(ret.iloc[t:t+step].values)
        for m in names:
            w = weights[m].values.copy()
            traded = float(np.abs(w-previous[m]).sum())
            turns[m] += traded
            for day, asset_returns in enumerate(simple):
                gross = float(w@asset_returns)
                net = (1+gross)*(1-cost*traded)-1 if day == 0 else gross
                port[m].append(net)
                w = w*(1+asset_returns)/(1+gross)
            previous[m] = w
    summary, navs = {}, {}
    for m in names:
        series = pd.Series(port[m], index=ret.index[est_window:])
        summary[m] = perf_metrics(series, rf)
        summary[m]['ann_turnover'] = turns[m]*TRADING_DAYS/len(series)
        navs[m] = (1+series).cumprod()
    return pd.DataFrame(summary).T, navs


def bootstrap_stability(ret, n_boot=60, rf=0.02, methods=None, seed=0, per_asset_max=0.60):
    names = methods or list(METHODS)
    rng = np.random.default_rng(seed)
    mu, S = estimate(ret)
    base = compute_weights(mu, S, rf, names, per_asset_max)
    samples = []
    # The same perturbations are used for every method; failures fail the run,
    # rather than silently biasing stability toward successful samples.
    for _ in range(n_boot):
        idx = rng.integers(0, len(ret), len(ret))
        mu, S = estimate(ret.iloc[idx])
        samples.append(compute_weights(mu, S, rf, names, per_asset_max).values)
    samples = np.array(samples)
    return pd.DataFrame({m: {
        'mad_from_base': float(np.abs(samples[:, :, i]-base[m].values).mean()),
        'cross_run_std': float(samples[:, :, i].std(axis=0).mean()),
    } for i, m in enumerate(names)}).T
