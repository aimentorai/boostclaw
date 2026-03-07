# Refactor Summary

## Scope
This branch captures local refactors focused on frontend UX polish, IPC call consolidation, transport abstraction, and channel page responsiveness.

## Key Changes

### 1. Frontend IPC consolidation
- Replaced scattered direct `window.electron.ipcRenderer.invoke(...)` calls with unified `invokeIpc(...)` usage.
- Added lint guard to prevent new direct renderer IPC invokes outside the API layer.
- Introduced a centralized API client with:
  - error normalization (`AppError`)
  - unified `app:request` support + compatibility fallback
  - retry helper for timeout/network errors

### 2. Transport abstraction (extensible protocol layer)
- Added transport routing abstraction inside `src/lib/api-client.ts`:
  - `ipc`, `ws`, `http`
  - rule-based channel routing
  - transport registration/unregistration
  - failure backoff and fallback behavior
- Added default transport initialization in app entry.
- Added gateway-specific transport adapters for WS/HTTP.

### 3. HTTP path moved to Electron main-process proxy
- Added `gateway:httpProxy` IPC handler in main process to avoid renderer-side CORS issues.
- Preload allowlist updated for `gateway:httpProxy`.
- Gateway HTTP transport now uses IPC proxy instead of browser `fetch` direct-to-gateway.

### 4. Settings improvements (Developer-focused transport control)
- Added persisted setting `gatewayTransportPreference`.
- Added runtime application of transport preference in app bootstrap.
- Added UI option (Developer section) to choose routing strategy:
  - WS First / HTTP First / WS Only / HTTP Only / IPC Only
- Added i18n strings for EN/ZH/JA.

### 5. Channel page performance optimization
- `fetchChannels` now supports options:
  - `probe` (manual refresh can force probe)
  - `silent` (background refresh without full-page loading lock)
- Channel status event refresh now debounced (300ms) to reduce refresh storms.
- Initial loading spinner only shown when no existing data.
- Manual refresh uses local spinner state and non-blocking update.

### 6. UX and component enhancements
- Added shared feedback state component for consistent empty/loading/error states.
- Added telemetry helpers and quick-action/dashboard refinements.
- Setup/settings/providers/chat/skills/cron pages received targeted UX and reliability fixes.

### 7. IPC main handler compatibility improvements
- Expanded `app:request` coverage for provider/update/settings/cron/usage actions.
- Unsupported app requests now return structured error response instead of throwing, reducing noisy handler exceptions.

### 8. Tests
- Added unit tests for API client behavior and feedback state rendering.
- Added transport fallback/backoff coverage in API client tests.

## Files Added
- `src/lib/api-client.ts`
- `src/lib/telemetry.ts`
- `src/components/common/FeedbackState.tsx`
- `tests/unit/api-client.test.ts`
- `tests/unit/feedback-state.test.tsx`
- `refactor.md`

## Notes
- Navigation order in sidebar is kept aligned with `main` ordering.
- This commit snapshots current local refactor state for follow-up cleanup/cherry-pick work.
