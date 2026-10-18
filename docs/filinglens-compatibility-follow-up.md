# FilingLens signed-in compatibility follow-up — 17 October 2026

Current GPI base `0849ef839733e0043ba98a01e3a6fe824df0373d` already includes the
session-bound delegation repair in PR #159. Railway production runs this SHA
in successful deployment `0a39fd19-8d55-4412-92f9-ecdd1b7b3382`.
The previously reported code mismatch was based on an older GPI checkout.

This follow-up pins GPI CI's real FilingLens consumer to released
`3e2e896085dd7263da5524210693cbadfa7a4a97` and adds assertions that:

- A signed ticket contains the actual session ID, FilingLens audience and both
  allowed operations.
- Logout revokes old tickets, and logging in again does not resurrect them.
- A fresh login obtains a fresh usable delegation.
- Downgrading that account membership to viewer immediately denies analysis
  and publication; no positive authorization cache bypasses current authority.

The complete actual-code approval flow passes against current FilingLens with
isolated PGlite databases. It includes password/session handling, service-token
introspection, deterministic DCF, signed notification, account-scoped import,
source audit, stored synthetic risk and wrong-account denials. SQL transport and
external model/price providers are synthetic; authority implementations are not
mocked. No private holdings, account or production valuation is created.

Verification: 190 tests including the cross-app flow; lint zero errors/one
pre-existing warning; typecheck and production build pass. All three built browser tests pass and
use local loopback and synthetic HTTP fixtures, not a Railway user session.
Production GPI currently redirects the verification browser to the normal
sign-in form. Completing the positive production path requires secure user
sign-in; it is not established by the deployment SHA or test fixtures.

Run `FILINGLENS_TEST_ROOT=/absolute/filinglens npm test` from this checkout.
The new CI pin and regression assertions are local pending authorized release.
No new secret, migration, authentication provider, permission expansion or
production configuration is introduced. No existing auth gate was relaxed.
