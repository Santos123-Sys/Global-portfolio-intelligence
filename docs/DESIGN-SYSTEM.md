# Design System — Global Portfolio Intelligence

Status: implemented foundation (token layer + first primitives) · see §8 for the adoption roadmap
Baseline: main branch, October 2026
Guiding design language: **IBM Carbon Design System** (adapted, not vendored)

---

## 1. Why Carbon, and why adapted

Global Portfolio Intelligence is a dense, evidence-led financial decision-support
product: tables of positions, methodology-bearing risk metrics, audit trails, and a
strict status vocabulary (Ready / Working / Attention / Blocked / Complete).
The evaluation compared four candidates against that reality:

| Criterion | Carbon | shadcn/ui + Tailwind | Ant Design | Material (MUI) |
| --- | --- | --- | --- | --- |
| Dense data tables / finance heritage | Excellent (IBM enterprise/finance) | DIY | Good | Weak |
| Data-visualization guidance | First-class chart library guidance | None | Basic | Basic |
| Accessibility (WCAG 2.2 AA) | Strong, documented | Depends on Radix | Good | Good |
| Status/notification semantics | Strong | DIY | Good | Moderate |
| Fit with current stack (Next 16, React 19, **no Tailwind**, 5k lines of hand-rolled CSS, bundled Inter) | Works as token layer, no forced dependency | Requires Tailwind migration + lockfile churn | Heavy visual-identity clash, large bundle | Rework of theme + emotion runtime |
| Migration risk to this repo | Low | Medium–high | High | High |

**Decision:** adopt Carbon as the *design language* — its token philosophy, status
semantics, data-viz rules and accessibility posture — implemented on the repository's
existing CSS-custom-property foundation. This keeps the build dependency-free,
preserves both existing themes (light + dark glass-green), and lets components be
migrated incrementally. If the component inventory grows (complex date pickers,
filterable data grids), reassess pulling in Radix primitives under the same tokens.

## 2. Token architecture

`src/app/design-tokens.css` is the single source of truth. It is imported **first**
in `src/app/layout.tsx`; the legacy variables in `globals.css`
(`--bg`, `--panel`, `--border`, `--text`, `--muted`, `--accent`, `--warn`, `--danger`)
are now aliases onto the token scale, so all existing styles keep rendering while new
code consumes `--pi-*` tokens directly.

Token categories:

- **Color** — core palette (`--pi-blue-*`, `--pi-teal-*`, `--pi-gray-*`), semantic
  roles (`--pi-color-action|success|warning|danger|info|neutral`), and the workflow
  status pairs (`--pi-status-{ready,working,attention,blocked,complete}-{fg,bg}`).
  One role per meaning; a color never carries a second unrelated meaning.
- **Typography** — Inter (bundled woff2, weights 400–700), `--pi-text-xs` …
  `--pi-text-figure`; `font-variant-numeric: tabular-nums` is the global default so
  numeric columns align. Mono token reserved for code/trace surfaces.
- **Spacing** — 4px base scale (`--pi-space-2xs` … `--pi-space-2xl`), Carbon-compatible.
- **Shape & elevation** — `--pi-radius-sm|md|lg|pill`, `--pi-shadow-sm|md|lg`.
- **Motion** — `--pi-motion-fast` (120ms) / `--pi-motion-standard` (200ms) with a
  Carbon-style easing curve; forced to 0 under `prefers-reduced-motion`.
  Motion signals UI state, never market movement — data values are not animated.
- **Layout** — `--pi-content-max: 1200px` (matches the existing shell).

Both themes define the full token set; the dark theme keeps the established
glass-green identity while satisfying the same semantic roles.

## 3. Status vocabulary is a design-system contract

The five workflow states are not copy; they are UI primitives with fixed colors:

| State | Meaning (authoritative: architecture manual §11) | Token pair |
| --- | --- | --- |
| Ready | Prerequisites met; an action is available | `--pi-status-ready-*` |
| Working | A durable job/session is executing | `--pi-status-working-*` |
| Attention | Non-blocking evidence or judgment gap | `--pi-status-attention-*` |
| Blocked | Hard prerequisite or required evidence missing | `--pi-status-blocked-*` |
| Complete | Stage finished; review and decide next step | `--pi-status-complete-*` |

Rules carried over from the UX architecture docs:

- A status badge never hides coverage or uncertainty — pair it with a visible note
  when evidence is partial.
- "Unverified" (missing hard-rule evidence) renders as **Attention/Blocked per
  policy**, never as a green pass.
- Progressive disclosure: status first, supporting evidence next, raw traces later.

## 4. Primitives

`src/components/ui/` holds the design-system components. Current inventory:

- **`StatusPill`** (`status-pill.tsx`) — canonical status indicator with typed
  `WorkflowStatus`; already wired into the workflow command bar
  (`workflow-next-action.tsx`), where the internal `locked` state maps to the
  `blocked` vocabulary term.

Planned next primitives (in priority order): `Button` (primary/secondary/ghost/danger
with loading state), `Card`/`Panel`, `DataTable` wrapper (sortable, sticky header,
tabular numerals), `EvidenceTag` (source + date), `InlineCaveat` (warning note),
`EmptyState` (coverage-aware: supplied / eligible / unverified counts).

## 5. Data visualization rules

- Charts (Recharts) must derive series colors from semantic tokens, never hex
  literals; positive/negative use `--pi-color-success` / `--pi-color-danger`.
- Currency is always labeled on the figure (`cur` suffix pattern) — a chart mixing
  CHF and BRL values is a bug, per the native-currency integrity invariant.
- Uncertainty (missing observations, stale evidence) is drawn, not hidden: gaps in
  series stay gaps.

## 6. Accessibility baseline

- WCAG 2.2 AA contrast for text and status pairs in both themes.
- Carbon-style 2px `:focus-visible` outline in the action color (implemented in the
  token layer for links, buttons, inputs and selects).
- `prefers-reduced-motion` zeroes all token-driven transitions.
- Status is never color-only: `StatusPill` always carries a text label.

## 7. What this does not change

- No new runtime dependencies; no Tailwind, no CSS-in-JS.
- All 5k+ lines of existing CSS keep working through the legacy aliases.
- No change to the quant/agent boundary — the design system is presentation-only.

## 8. Adoption roadmap

1. ✅ Token layer + aliases + focus styles + `StatusPill` (this change).
2. Migrate `commercial-v3*.css` status colors onto `--pi-status-*` pairs.
3. Extract `Button`, `Card`, `DataTable` primitives; migrate one workspace
   (Discovery first — it has the richest status semantics).
4. Add a `/design-system` internal showcase page behind auth for visual regression.
5. Re-evaluate Radix/shadcn adoption once primitive count exceeds ~10.
