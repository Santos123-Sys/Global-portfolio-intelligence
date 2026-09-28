
# Portfolio Weight Computation — Integration Specification

**Purpose.** This package computes portfolio asset weights across eight
established allocation methods, validates every method out-of-sample, and
produces exactly one **recommendation**. The system recommends; it never
decides. The final weight vector is always chosen and confirmed by the human
operator (the user).

**Status of data.** The bundled demo runs on clearly-labeled SYNTHETIC data.
Replace with real total-return price history before any production use. Never
present demo outputs as real market results.

---

## 1. Architecture and file map

```
portfolio_weights_solution/
├── README.md                  ← this document (implementation spec)
├── requirements.txt           ← pinned minimum versions
├── config.example.json        ← copy to config.json and edit
├── run_demo.py                ← end-to-end demo on synthetic data
└── portfolio_weights/         ← the package (import, do not edit casually)
    ├── data.py                # price loading + clearly-labeled synthetic generator
    ├── estimation.py          # annualized mu + Ledoit-Wolf shrunk covariance
    ├── methods.py             # 8 allocation methods (formula-documented)
    ├── validation.py          # walk-forward backtest + bootstrap stability
    ├── recommend.py           # ranking/scoring + the human-decision contract
    └── pipeline.py            # orchestration: run_pipeline()
```

Dependency direction is strictly linear:
`data -> estimation -> methods -> validation -> recommend -> pipeline`.
Nothing imports backwards. You can replace any layer (e.g., swap the optimizer)
without touching the others, provided the function signatures below are kept.

## 2. Install and quickstart

```
pip install -r requirements.txt
python run_demo.py            # synthetic demo; prints tables + recommendation
```

Minimal real-data usage:

```python
import pandas as pd
from portfolio_weights import run_pipeline, finalize

prices = pd.read_csv("prices.csv", index_col=0, parse_dates=True)  # total-return prices
res = run_pipeline(prices, objective="balanced", max_drawdown=0.20)

# 1. The system presents res["recommendation"] plus the ranking table.
# 2. The USER decides: accept, pick another method, or give custom weights.
final = finalize(res["recommendation"], user_choice="HRP",
                 methods_available=res["weights_table"])   # example: user overrode to HRP
# final["final_weights"] is what gets written to the portfolio system.
```

## 3. Configuration (config.json)

| Key | Meaning | Default |
|---|---|---|
| `prices_csv` | path to adjusted/total-return prices CSV | — |
| `objective` | one of `max_sharpe`, `min_vol`, `max_growth`, `balanced` | `balanced` |
| `rf` | annual risk-free rate (decimal) | `0.02` |
| `max_drawdown` | user drawdown limit, positive decimal (`0.20` = −20%); `null` = none | `null` |
| `est_window` | estimation window in trading days | `756` (3y) |
| `step` | rebalancing interval in trading days | `126` (6m) |
| `cost` | one-way transaction cost per unit turnover | `0.001` |
| `n_boot` | bootstrap resamples for the stability test | `60` |
| `caps.per_asset_max` | per-asset weight cap used by the optimizers | `0.60` |

Constraints are currently long-only and fully invested, plus the per-asset cap
inside `methods.py`. To add constraints (group caps, liquidity floors), extend
the optimizer bounds/constraints in `methods.py` and pass the parameters
through `run_pipeline` — the validation and recommendation layers do not
change.

## 4. Input and output contracts

**Input.** CSV of total-return prices: first column dates (any parseable
format), one column per asset, rows in any order (sorted internally).
Gaps are forward-filled then dropped. Log returns are used throughout;
annualization assumes 252 trading days.

**Outputs of `run_pipeline` (a dict):**

| Key | Type | Content |
|---|---|---|
| `inputs` | dict | echo of configuration |
| `weights_table` | DataFrame, assets × methods | full-sample weights, columns sum to 1 |
| `oos_summary` | DataFrame, methods × metrics | walk-forward, net of costs: `cagr`, `vol`, `sharpe`, `max_drawdown`, `ann_turnover` |
| `stability` | DataFrame, methods × metrics | `mad_from_base`, `cross_run_std` from bootstrap perturbation (lower = more robust) |
| `recommendation` | dict | see below |
| `navs` | dict of Series | cumulative NAV per method over the backtest |
| `final` (only if `user_choice` was passed) | dict | audited human decision, see `finalize` |

**`recommendation` schema:**

```json
{
  "recommended_method": "MaxSharpe",
  "recommended_weights": {"Equity_US": 0.0, "...": 0.0},
  "stability_flag": "WARNING: ... or null",
  "constraint_flag": "WARNING: ... or null",
  "ranking": {"<method>": {"score": 0.0, "sharpe": 0.0, "...": 0.0}},
  "user_must_choose": true
}
```

**`finalize` schema (the audit record — persist this):**

```json
{
  "final_weights": {"<asset>": 0.0},
  "source": "user accepted system recommendation | user chose method 'X' | user supplied custom weights",
  "was_user_decision": true,
  "audit": {"recommended_method": "...", "user_choice": "...", "stability_flag": null, "constraint_flag": null}
}
```

`finalize` validates: method names must exist in the ranking; custom weights
must be non-negative and sum positive (it normalizes to 1). It raises on
violations — catch these and re-prompt the user, never silently coerce.

## 5. How the recommendation is produced (and how to tune it)

`recommend.py` scores each method as:

```
score = primary_metric                     # objective-dependent OOS metric
        - 2.0 * mad_from_base              # instability penalty
        - 0.5 * ann_turnover * cost * 2    # trading-cost penalty
```

where `primary_metric` is OOS Sharpe (`max_sharpe`, `balanced`), inverse
volatility (`min_vol`), or CAGR (`max_growth`). Methods whose OOS maximum
drawdown breaches `max_drawdown` are eliminated first; if none survive, the
filter is relaxed and `constraint_flag` records the breach. The highest-scoring
method is recommended. If its `mad_from_base` exceeds `stability_threshold`
(0.08), `stability_flag` warns that small input changes move its weights a lot.

All constants (the 2.0 and 0.5 penalties, the threshold, the objective map)
are explicitly named in `recommend.py` and are safe to tune. Changing the
scoring function does not affect computation or validation layers.

Design intent, stated plainly: the score is a transparent, defensible default,
not a claim of optimality. The ranking table and both warning flags are always
shown to the user alongside the recommendation so the recommendation can be
overridden with full information.

## 6. Integration guide for your LLM

Wire the package into the host system in five steps.

**Step 1 — Run computation.** On a rebalance trigger (schedule or user action),
call `run_pipeline(prices, **config)` with fresh total-return prices. Wrap in
try/except: on any exception, fall back to the previously confirmed weights and
log the failure. Never auto-recompute into production weights.

**Step 2 — Present, do not apply.** Render three things to the user: (a) the
recommended method and its weights with both warning flags if present; (b) the
full ranking table (`recommendation["ranking"]`) so alternatives are visible;
(c) the OOS metrics of the recommendation versus 1/N. The UI must make clear
this is a recommendation.

**Step 3 — Collect the human decision.** Offer exactly three options: accept
the recommendation; choose another method from the ranking; enter custom
weights. Call `finalize(recommendation, user_choice=<...>,
methods_available=weights_table)` with the user's answer. `user_choice=None`
means "defer" — the system must then keep the previous confirmed weights.

**Step 4 — Persist.** Store `final` verbatim, including the `audit` block,
versioned with the config and the price snapshot hash. Reproduce-ability
requirement: from the stored record alone you must be able to recompute the
recommendation that was shown.

**Step 5 — Govern.** Enforce in the host system, not in this package: the
package must never be called with `user_choice` set by anything other than an
explicit human action; block API paths that write `final_weights` directly
without a `finalize` audit record; alert on `stability_flag` and
`constraint_flag` before accepting a confirmation.

## 7. Method catalogue (for reference and UI labels)

`1/N` equal weight (benchmark; no estimation). `MinVar` minimum variance,
w = Σ⁻¹1/(1′Σ⁻¹1). `MaxSharpe` tangency portfolio. `RiskParity` equalizes each
asset's risk contribution wᵢ(Σw)ᵢ/√(w′Σw). `MaxDiv` maximizes the
diversification ratio. `Kelly_frac` fractional Kelly, w ∝ Σ⁻¹(μ−r_f), half
Kelly. `BlackLitterman` equilibrium prior plus explicit views. `HRP`
hierarchical risk parity. Covariance estimation uses Ledoit–Wolf shrinkage
throughout; the raw sample covariance is never used for optimization.

Known instability profile (from the accompanying analysis): Kelly and
MaxSharpe have the highest input sensitivity; MinVar, RiskParity, HRP and
Black–Litterman are the most stable. MaxSharpe and Kelly are also
"error maximizers" — they overweight whatever looks best in-sample — which is
precisely why the stability penalty and the out-of-sample gate exist.

## 8. Testing

`python run_demo.py` exercises the full pipeline on synthetic data and must
complete without error after any modification. The demo recommendation must
always carry `user_must_choose: true`, and `finalize` must reject negative
custom weights, unknown method names, and zero-sum weight dicts.

## 9. Limitations and compliance

Estimation error is irreducible; no method here is "optimal" in an absolute
sense, and the 1/N benchmark exists because optimized methods often fail to
beat it out-of-sample. Nothing in this package accounts for tail risk, regime
change, taxes, or liquidity beyond the turnover cost parameter. This software
implements a computational framework for human decision-making; it is not
investment advice, and the deploying system must present it as such to users.
