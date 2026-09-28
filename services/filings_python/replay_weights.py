"""Usage: python -m services.filings_python.replay_weights audit-snapshot.json.

Offline replay only. This command never confirms weights or writes a portfolio.
Use the engine commit and dependency versions recorded in the snapshot.
"""
import hashlib
import importlib.metadata
import io
import json
import sys
import pandas as pd
from .portfolio_weights import run_pipeline
from .portfolio_weights.pipeline import ENGINE_VERSION


def replay(snapshot):
    if hashlib.sha256(snapshot['pricesCsv'].encode()).hexdigest() != snapshot['priceHash']:
        raise ValueError('Price snapshot hash mismatch')
    saved = snapshot['resultJson']
    if saved['engine_version'] != ENGINE_VERSION:
        raise ValueError('Engine version mismatch: use the recorded engine version')
    for name, version in saved['dependencies'].items():
        if importlib.metadata.version(name) != version:
            raise ValueError(f'Dependency version mismatch: install {name}=={version}')
    prices = pd.read_csv(io.StringIO(snapshot['pricesCsv']), index_col=0, parse_dates=True)
    prices = prices[saved['inputs']['asset_order']]
    result = run_pipeline(prices, **snapshot['configJson'])
    for method, weights in saved['weights_table'].items():
        for asset, value in weights.items():
            if abs(float(result['weights_table'].loc[asset, method])-value) > 1e-7:
                raise ValueError('Replay weights differ from stored proposal')
    if result['recommendation']['recommended_method'] != saved['recommendation']['recommended_method']:
        raise ValueError('Replay recommendation differs from stored proposal')
    return result['recommendation']

if __name__ == '__main__':
    with open(sys.argv[1], encoding='utf-8') as file:
        print(json.dumps(replay(json.load(file)), indent=2, allow_nan=False))
