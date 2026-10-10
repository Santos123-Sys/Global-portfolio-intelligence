# Dependency audit — 9 October 2026

`npm audit --omit=dev --audit-level=moderate` reports zero production advisories for the replacement dependency graph.

The full audit reports five development dependency entries in a single inherited chain: `eslint-config-next` → `@next/eslint-plugin-next` → `fast-glob` → `micromatch` → `braces`. The root report is [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), deeply nested pattern stack exhaustion. The audit's suggested remediation downgrades the framework lint configuration to a different major; that is not an automatically safe fix for this Next.js version.

The inherited `scripts/check-dev-audit.mjs` allows only that specific advisory chain. It rejects any other high/critical development advisory. CI separately rejects moderate-or-higher production advisories. The development exception does not mean the full audit is clean; remove it when an upstream compatible fix is available. Do not feed untrusted patterns to build/lint tooling.
