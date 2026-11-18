# Changelog

## 1.0.2 — 2026-11-18

- Security (as suggested by the dshopen.org reviewer): the `/dsh-web-update/*` routes now **fail closed** when the Host `connection` trust fence is unavailable. Previously a missing `connection` service fell back to a local loopback + same-origin check and admitted requests without the signed browser cookie, which let any local process on a shared machine start an `npm install`. Now such requests get `503` with an explanatory message, and a one-time warning is logged when the first such request is refused; the fence is the only admission path.
- Added `test/fence.test.js`: fence pass-through (401/403), missing fence → 503, unreadable context → 503, throwing fence → 403.
- README: documented that the update surface requires a `dsh web` host with Connection enabled.

## 1.0.1 — 2026-11-16

- Fix: after an update the open page could stay blank until a manual refresh. A module-level watchdog now compares the page's boot release with the Host's `/state.currentVersion` and reloads the page once when they differ, with a `sessionStorage` guard against loops. Verified: stale-release reload in 2.3s, exactly one reload, no repeat within the quiet window.
- Keep polling tight (1.2s) through the install/restart window instead of falling back to the slow interval.
- Publish-ready packaging: npm name/repository/engines, MIT license, PNG storefront icons, screenshots, tests (`npm test`), and a tag-driven npm publish workflow.

## 1.0.0 — 2026-11-16

- First release: startup + 24h update checks, light-green badge beside the account row, current/latest confirm dialog, `npm install -g` of the newer `@deepseek-ai/dsh`, and a detached restart helper with health check and rollback.
