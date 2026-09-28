"""Recommendations are proposals. Only an explicit choice produces an audit record."""
import numpy as np

OBJECTIVES = {'balanced': 'sharpe', 'max_sharpe': 'sharpe', 'min_vol': 'vol_inv', 'max_growth': 'cagr'}


def recommend(weights_table, oos_summary, stability, objective='balanced',
              max_drawdown=None, stability_threshold=0.08, turnover_cost=0.001):
    if objective not in OBJECTIVES:
        raise ValueError('Unknown objective')
    df = oos_summary.join(stability)
    if not np.isfinite(df.values).all():
        raise ValueError('Incomplete validation metrics')
    df['vol_inv'] = 1/df['vol'].clip(lower=1e-8)
    df['eligible'] = True if max_drawdown is None else df['max_drawdown'] >= -max_drawdown
    df['score'] = df[OBJECTIVES[objective]]-2*df['mad_from_base']-df['ann_turnover']*turnover_cost
    df = df.sort_values('score', ascending=False)
    eligible = df[df['eligible']]
    relaxed = eligible.empty
    best = (df if relaxed else eligible).index[0]
    return {'recommended_method': best, 'recommended_weights': weights_table[best].to_dict(),
            'stability_flag': 'WARNING: weights are sensitive to input changes' if df.loc[best, 'mad_from_base'] > stability_threshold else None,
            'constraint_flag': 'WARNING: no method satisfies the drawdown constraint' if relaxed else None,
            'ranking': df.to_dict('index'), 'user_must_choose': True}


def finalize(recommendation, user_choice=None, methods_available=None, per_asset_max=0.60):
    if user_choice is None:
        return None  # Defer: the host preserves the previous target.
    if user_choice == 'recommendation':
        final = recommendation['recommended_weights'].copy()
        source = 'user accepted system recommendation'
    elif isinstance(user_choice, str):
        if user_choice not in recommendation['ranking'] or methods_available is None or user_choice not in methods_available:
            raise ValueError(f'Unknown method: {user_choice}')
        final = methods_available[user_choice].to_dict()
        source = f"user chose method '{user_choice}'"
    elif isinstance(user_choice, dict):
        final = user_choice.copy()
        source = 'user supplied custom weights'
    else:
        raise ValueError('Explicit recommendation, method, or custom weights required')
    if set(final) != set(recommendation['recommended_weights']):
        raise ValueError('Weights must cover exactly the portfolio assets')
    values = np.array(list(final.values()), dtype=float)
    if not np.isfinite(values).all() or np.min(values) < 0 or values.sum() <= 0:
        raise ValueError('Weights must be finite, non-negative and sum positive')
    values /= values.sum()
    if values.max() > per_asset_max+1e-7:
        raise ValueError('Weights exceed per-asset cap')
    final = dict(zip(final, values.tolist()))
    return {'final_weights': final, 'source': source, 'was_user_decision': True,
            'audit': {'recommended_method': recommendation['recommended_method'],
                      'user_choice': user_choice,
                      'stability_flag': recommendation['stability_flag'],
                      'constraint_flag': recommendation['constraint_flag']}}
