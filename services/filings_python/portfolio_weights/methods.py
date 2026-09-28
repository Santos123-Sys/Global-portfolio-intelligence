"""Long-only, fully-invested allocations with a common feasible asset cap.

Kelly_frac is constrained quadratic growth with fraction 0.5 (not leveraged
unconstrained Kelly). BlackLitterman uses an equal-weight equilibrium prior;
no relative asset view is invented. HRP/RiskParity are cap-constrained variants.
"""
import numpy as np
import pandas as pd
from scipy.optimize import minimize
from scipy.cluster.hierarchy import linkage, leaves_list
from scipy.spatial.distance import squareform

METHODS = {name: None for name in (
    '1/N', 'MinVar', 'MaxSharpe', 'RiskParity', 'MaxDiv', 'Kelly_frac',
    'BlackLitterman', 'HRP')}


def solve(fn, n, cap):
    result = minimize(fn, np.ones(n)/n, method='SLSQP', bounds=[(0, cap)]*n,
                      constraints=[{'type': 'eq', 'fun': lambda w: w.sum()-1}],
                      options={'ftol': 1e-11, 'maxiter': 500})
    if not result.success or not np.isfinite(result.x).all():
        raise ValueError(f'Allocation optimizer failed: {result.message}')
    w = np.maximum(result.x, 0)
    w /= w.sum()
    if w.max() > cap + 1e-7:
        raise ValueError('Optimizer violated asset cap')
    return w


def w_hrp(S):
    n = len(S)
    sd = np.sqrt(np.diag(S))
    corr = np.clip(S / np.outer(sd, sd), -1, 1)
    dist = np.sqrt(np.maximum(0, (1-corr)/2))
    np.fill_diagonal(dist, 0)
    order = leaves_list(linkage(squareform(dist, checks=False), method='single')).tolist()
    w = np.ones(n)
    stack = [order]
    def variance(idx):
        sub = S[np.ix_(idx, idx)]
        iv = 1/np.diag(sub)
        iv /= iv.sum()
        return iv @ sub @ iv
    while stack:
        cluster = stack.pop()
        if len(cluster) < 2:
            continue
        left, right = cluster[:len(cluster)//2], cluster[len(cluster)//2:]
        vl, vr = variance(left), variance(right)
        w[left] *= vr/(vl+vr)
        w[right] *= vl/(vl+vr)
        stack.extend([left, right])
    return w


def compute_weights(mu, S, rf=0.02, methods=None, per_asset_max=0.60):
    n = len(mu)
    cap = per_asset_max
    if n < 2 or not 0 < cap <= 1 or n*cap < 1-1e-10:
        raise ValueError('At least two assets and a feasible asset cap are required')
    if not np.isfinite(mu).all() or not np.isfinite(S).all() or np.min(np.diag(S)) <= 0:
        raise ValueError('Finite returns and positive asset variances required')
    variance = lambda w: max(float(w @ S @ w), 1e-15)
    vols = np.sqrt(np.diag(S))
    prior = 2.5*S @ (np.ones(n)/n)
    def parity(w):
        contributions = w*(S@w)/variance(w)
        return np.square(contributions-1/n).sum()
    objectives = {
        'MinVar': lambda w: variance(w),
        'MaxSharpe': lambda w: -(w@mu-rf)/np.sqrt(variance(w)),
        'RiskParity': parity,
        'MaxDiv': lambda w: -(w@vols)/np.sqrt(variance(w)),
        'Kelly_frac': lambda w: -(w@mu-rf) + variance(w)/(2*0.5),
        'BlackLitterman': lambda w: -(w@prior)/np.sqrt(1.05*variance(w)),
    }
    out = {}
    for name in (methods or list(METHODS)):
        if name == '1/N':
            w = np.ones(n)/n
        elif name == 'HRP':
            raw = w_hrp(S)
            w = solve(lambda x: np.square(x-raw).sum(), n, cap)
        elif name in objectives:
            w = solve(objectives[name], n, cap)
        else:
            raise ValueError(f'Unknown method: {name}')
        out[name] = w
    return pd.DataFrame(out)
