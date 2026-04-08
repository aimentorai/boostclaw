# Startup Diagnostic Logging Design

**Date:** 2026-04-08
**Goal:** Add timing instrumentation across all startup phases to identify bottlenecks and measure optimization improvements.

---

## Overview

Add comprehensive timing logs across all startup phases (main process, renderer, gateway, background services) to identify where time is being spent during application startup. This diagnostic logging will help:

1. Identify actual bottlenecks vs. assumed bottlenecks
2. Measure before/after improvements when optimizations are applied
3. Provide visibility into startup flow for debugging

---

## Design

### 1. Startup Timer Utility

Create a simple elapsed time tracker at `electron/utils/startup-timer.ts`:

**API:**
- `timer.mark(label)` - Log elapsed time since app start with label
- `timer.getElapsed()` - Get current elapsed ms
- `timer.reset()` - Reset timer (useful for testing)

**Output format:**
```
[STARTUP] label: 123ms
```

**Implementation:**
- Store start time on module load
- Simple calculation for each mark
- No external dependencies

### 2. Main Process Instrumentation

Instrument `electron/main/index.ts` at these points:

| Phase | Label |
|-------|-------|
| App ready event | `app_ready` |
| Before each background task | `before_<task_name>` |
| After each background task | `after_<task_name>` |
| Window creation start | `window_creating` |
| Window creation complete | `window_created` |
| Gateway spawn | `gateway_spawn` |
| Gateway ready | `gateway_ready` |
| Startup complete | `complete` |

### 3. Gateway Instrumentation

Instrument gateway-related files:

**`electron/gateway/manager.ts`:**
- `gateway_start` - When start() is called
- `gateway_process_spawned` - After child process spawn
- `gateway_ws_connecting` - WebSocket connection attempt
- `gateway_ws_connected` - WebSocket established
- `gateway_ready` - Gateway reports ready state

**`electron/gateway/ws-client.ts`:**
- `ws_probe_start` - Before probing gateway
- `ws_probe_success` - Successful probe

### 4. Renderer Process Instrumentation

**`src/App.tsx`:**
- `renderer_mount` - App component mount
- `routes_rendered` - First route render

**Store initialization (`src/stores/*.ts`):**
- `settings_store_init` - Settings store init complete
- `gateway_store_init` - Gateway store init complete
- `providers_store_init` - Providers store init complete

### 5. Background Tasks

Each background task should log before/after:

| Task | Labels |
|------|--------|
| Telemetry init | `telemetry_start` / `telemetry_done` |
| Proxy settings | `proxy_start` / `proxy_done` |
| Skills installation | `skills_start` / `skills_done` |
| CLI installation | `cli_start` / `cli_done` |
| Provider auth sync | `provider_sync_start` / `provider_sync_done` |

---

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `electron/utils/startup-timer.ts` | Create | Timing utility module |
| `electron/main/index.ts` | Modify | Add timing marks at key points |
| `electron/gateway/manager.ts` | Modify | Add gateway timing marks |
| `electron/gateway/ws-client.ts` | Modify | Add WebSocket timing marks |
| `src/App.tsx` | Modify | Add renderer timing marks |
| `src/stores/settings.ts` | Modify | Add store init timing |
| `src/stores/gateway.ts` | Modify | Add store init timing |
| `src/stores/providers.ts` | Modify | Add store init timing |

---

## Output Example

```
[STARTUP] app_ready: 45ms
[STARTUP] window_creating: 120ms
[STARTUP] window_created: 185ms
[STARTUP] gateway_spawn: 195ms
[STARTUP] telemetry_start: 200ms
[STARTUP] proxy_start: 201ms
[STARTUP] telemetry_done: 210ms
[STARTUP] proxy_done: 215ms
[STARTUP] skills_start: 220ms
[STARTUP] cli_start: 221ms
[STARTUP] gateway_ws_connecting: 350ms
[STARTUP] gateway_ws_connected: 520ms
[STARTUP] gateway_ready: 525ms
[STARTUP] renderer_mount: 540ms
[STARTUP] settings_store_init: 580ms
[STARTUP] gateway_store_init: 610ms
[STARTUP] providers_store_init: 625ms
[STARTUP] skills_done: 850ms
[STARTUP] cli_done: 860ms
[STARTUP] routes_rendered: 880ms
[STARTUP] === COMPLETE: 2,340ms ===
```

---

## Future Work

Once we have the diagnostic logs, we can:
1. Run multiple startups and identify consistent slow phases
2. Target specific phases for optimization
3. Measure improvement after each optimization
4. Set performance budget targets (e.g., "startup should complete in <3s")
