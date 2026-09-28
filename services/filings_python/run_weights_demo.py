
"""End-to-end demo on clearly-labeled SYNTHETIC data."""
import json
from portfolio_weights import run_pipeline, synthetic_prices

res = run_pipeline(synthetic_prices(), objective="balanced", max_drawdown=0.20,
                   user_choice=None)   # recommendation only; decision deferred to user

print("=== WEIGHTS TABLE (synthetic demo) ===")
print((res["weights_table"]*100).round(1))
print("\n=== OUT-OF-SAMPLE SUMMARY (net of costs) ===")
print(res["oos_summary"].round(3))
print("\n=== STABILITY (mean abs deviation under bootstrap) ===")
print(res["stability"].round(4))

rec = res["recommendation"]
print(f"\n=== RECOMMENDATION: {rec['recommended_method']} ===")
print(json.dumps(rec["recommended_weights"], indent=2))
for flag in (rec["stability_flag"], rec["constraint_flag"]):
    if flag: print(flag)
print("\nThe user MUST now choose: accept, pick another method, or supply custom weights.")

# Example of the human decision step (normally interactive / via your system's UI):
final = None
# final = finalize(res["recommendation"], user_choice="HRP", methods_available=res["weights_table"])
