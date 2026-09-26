# Workspace design refresh

## Research references

- Koyfin, watchlists: https://www.koyfin.com/features/watchlists/ — inspiration for clear task entry points and access to related analysis.
- getquin, portfolio tracker: https://www.getquin.com/portfolio-tracker/ — inspiration for a consolidated overview and readable hierarchy.
- Portfolio Performance, dashboard: https://help.portfolio-performance.info/en/reference/view/reports/performance/dashboard/ — inspiration for grouping related information within a workspace.
- W3C, focus not obscured: https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html
- W3C, target size: https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum

## Applied changes

The entry page groups work into thesis, discovery/evaluation, and portfolio monitoring. Repeated candidate actions are consolidated; detailed process instructions use a native expandable disclosure. Portfolio setup remains directly reachable.

The header adds a searchable page finder using the same role-filtered destinations as navigation. It searches pages, not securities or financial data. Keyboard users can bypass navigation using a translated skip link. Escape returns focus to the visible menu trigger on phones. Authentication pages do not show the authenticated application shell.

Shared surfaces use clearer text contrast, consistent rounded cards, and a two-row desktop header. Mobile navigation remains an explicit expandable menu; the header scrolls with the document to reduce obstruction. Existing reduced-motion and focus styles remain supported. Filled form buttons use dark blue with white text to preserve contrast.

## Scope and limitations

No usage analytics were available to justify deleting analytical capabilities. This change removes duplicate entry-page actions and reduces the prominence of instructional text. It does not claim complete WCAG conformance. Browser tests use mocked account responses to exercise desktop/mobile layout, keyboard focus, navigation search, and role-aware link visibility; production account/data flows still require deployment verification.
