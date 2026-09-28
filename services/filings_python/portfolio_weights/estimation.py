
"""Annualized inputs with Ledoit-Wolf covariance shrinkage."""
import numpy as np
from sklearn.covariance import LedoitWolf

TRADING_DAYS = 252

def estimate(ret, annualize=True):
    """ret: DataFrame of log returns. Returns (mu, S) annualized."""
    k = TRADING_DAYS if annualize else 1.0
    mu = ret.mean().values * k
    S  = LedoitWolf().fit(ret.values).covariance_ * k
    return mu, S
