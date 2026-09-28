# Example portfolio sandbox

The home and Allocation pages link to `/example-portfolio`. This is a fixed,
fictional six-company CHF scenario with starting weights totaling 100%. The
research cards and financial inputs are educational fixtures. The analysis table
uses the existing deterministic `deriveFcff` function, plus computed growth and
operating margin. No primary-source filings, real quotes, DCF fair values, or
real candidate decisions are claimed. The scenario does not call the live
Discovery or Analysis services.

The allocation is computed by the **same eight-method Python engine** used for
real weight proposals. Its input is a fixed, seeded SYNTHETIC daily price series;
the private service exposes `GET /v1/portfolio-weights/example` with the existing
internal token. The dashboard exposes an authenticated, read-only
`GET /api/example-portfolio` proxy that validates the response. It returns no
result when the service is unavailable. This route does not use the live CSV
adapter, so synthetic history never passes a total-return attestation or enters
`portfolio_weight_runs`. Selecting a method changes only the local preview.

There is no migration and no user-specific seed record. The six fictional
identifiers cannot enter real portfolio holdings through the sandbox; there is
no import or promotion action. Visitors reach the real thesis and discovery
pages through explicit links at the end.

## Inspiration from product patterns

- [PortfoliosLab's fixed All Weather demo](https://portfolioslab.com/docs/optimization/goal-based-optimization-presets)
  lets people compare original and optimized allocations using a fixed example.
  It explicitly distinguishes its sample preview from a preset calculation.
- [ProjectionLab's sandbox setup](https://cdn.projectionlab.com/help/how-to-get-started)
  prepopulates an example persona and keeps that exercise distinct from a real
  plan.
- [Portfolio Visualizer's sample portfolio](https://www.portfoliovisualizer.com/backtest-asset-class-allocation)
  shows starting allocations, results and comparative historical measures.

Our example adopts prefilled context, an original-versus-proposed comparison,
and a conspicuous data label. The actual method calculations are performed on
request by the production engine, with no investment decision applied.

## Validation and rollout

Deploy the Python service before the dashboard; use the existing private
`FILINGS_API_URL` and `FILINGS_INTERNAL_TOKEN`. Confirm the health endpoint,
then load `/example-portfolio` as an authenticated user. The research and
financial table load without service access; allocation reports an actionable
failure when the service is unavailable. Confirm all eight methods, cap, sum,
1/N comparison and zero database mutations. CI tests the Python computation,
financial formulas, authentication boundary, failure behavior and desktop/mobile
browser flow. Production configuration and service latency must be checked after
deployment. The example is not an investment recommendation.
