# Changelog

## 1.0.1 — 2026-11-16

- Fix: after an update the open page could stay blank until a manual refresh. A module-level watchdog now compares the page's boot release with the Host's `/state.currentVersion` and reloads the page once when they differ, with a `sessionStorage` guard against loops. Verified: stale-release reload in 2.3s, exactly one reload, no repeat within the quiet window.
- Keep polling tight (1.2s) through the install/restart window instead of falling back to the slow interval.
- Publish-ready packaging: npm name/repository/engines, MIT license, PNG storefront icons, screenshots, tests (`npm test`), and a tag-driven npm publish workflow.

## 1.0.0 — 2026-11-16

- First release: startup + 24h update checks, light-green badge beside the account row, current/latest confirm dialog, `npm install -g` of the newer `@deepseek-ai/dsh`, and a detached restart helper with health check and rollback.
