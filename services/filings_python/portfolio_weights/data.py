
"""Data ingestion. All prices must be TOTAL-RETURN (dividend-adjusted) prices."""
import numpy as np, pandas as pd

def load_prices(path):
    """CSV with a date column (parsed as index) and one column per asset."""
    p = pd.read_csv(path, index_col=0, parse_dates=True).sort_index()
    return p  # The pipeline rejects gaps; do not silently manufacture observations.

def log_returns(prices):
    return np.log(prices / prices.shift(1)).dropna()

def synthetic_prices(seed=42, n_days=252*10, n_assets=6, start="2016-01-04"):
    """Clearly-labeled SYNTHETIC data for demo/testing only. Never ship as real data."""
    rng = np.random.default_rng(seed)
    mkt   = rng.normal(0.00040, 0.0095, n_days)
    rates = rng.normal(0.00012, 0.0030, n_days)
    bm = np.array([1.00,1.05,0.00,0.35,0.05,0.85])[:n_assets]
    br = np.array([-0.10,-0.10,1.00,0.40,0.00,-0.05])[:n_assets]
    al = np.array([0.00012,0.00005,0.00002,0.00025,0.00005,0.00015])[:n_assets]
    iv = np.array([0.0040,0.0050,0.0015,0.0040,0.0050,0.0050])[:n_assets]
    names = ["Equity_US","Equity_EAFE","Bonds_IG","Bonds_HY","Gold","REIT"][:n_assets]
    r = np.clip(al[None,:] + bm[None,:]*mkt[:,None] + br[None,:]*rates[:,None]
                + rng.normal(0, iv[None,:], (n_days, n_assets)), -0.20, 0.20)
    idx = pd.bdate_range(start, periods=n_days)
    return pd.DataFrame(100*np.exp(np.log1p(pd.DataFrame(r, idx, names)).cumsum()), idx, names)
