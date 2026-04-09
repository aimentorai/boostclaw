# Startup Diagnostic Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add timing instrumentation across all startup phases to identify bottlenecks.

**Architecture:** Create a simple startup timer utility, then instrument main process, gateway, and renderer initialization points with timing marks.

**Tech Stack:**
- Electron (main process)
- TypeScript
- React (renderer)
- Zustand (state management)

---

## Task 1: Create Startup Timer Utility

**Files:**
- Create: `electron/utils/startup-timer.ts`
- Create: `tests/electron/utils/startup-timer.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { startupTimer } from '../../../electron/utils/startup-timer';

describe('startup-timer', () => {
  beforeEach(() => {
    startupTimer.reset();
  });

  it('should track elapsed time since module load', () => {
    const elapsed = startupTimer.getElapsed();
    expect(elapsed).toBeGreaterThanOrEqual(0);
  });

  it('should format mark output with label and time', () => {
    const consoleSpy = vi.spyOn(console, 'log');
    startupTimer.mark('test_phase');
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringMatching(/\[STARTUP\] test_phase: \d+ms/)
    );
  });

  it('should return elapsed time from getElapsed', () => {
    const elapsed1 = startupTimer.getElapsed();
    expect(typeof elapsed1).toBe('number');
    expect(elapsed1).toBeGreaterThanOrEqual(0);
  });

  it('should reset timer', async () => {
    await new Promise(resolve => setTimeout(resolve, 10));
    startupTimer.reset();
    const elapsed = startupTimer.getElapsed();
    expect(elapsed).toBeLessThan(10);
  });

  it('should log complete message with total time', () => {
    const consoleSpy = vi.spyOn(console, 'log');
    startupTimer.complete();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringMatching(/\[STARTUP\] === COMPLETE: \d+ms ===/)
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run test tests/electron/utils/startup-timer.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Write minimal implementation**

```typescript
/**
 * Startup Timer Utility
 * Tracks elapsed time from app start for diagnostic logging
 */

const startTime = Date.now();

export interface StartupTimer {
  getElapsed: () => number;
  mark: (label: string) => void;
  reset: () => void;
  complete: () => void;
}

class StartupTimerImpl implements StartupTimer {
  private startTime: number;

  constructor() {
    this.startTime = Date.now();
  }

  getElapsed(): number {
    return Date.now() - this.startTime;
  }

  mark(label: string): void {
    const elapsed = this.getElapsed();
    console.log(`[STARTUP] ${label}: ${elapsed}ms`);
  }

  reset(): void {
    this.startTime = Date.now();
  }

  complete(): void {
    const elapsed = this.getElapsed();
    console.log(`[STARTUP] === COMPLETE: ${elapsed}ms ===`);
  }
}

export const startupTimer = new StartupTimerImpl();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run test tests/electron/utils/startup-timer.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add electron/utils/startup-timer.ts tests/electron/utils/startup-timer.test.ts
git commit -m "feat(utils): add startup timer for diagnostic logging"
```

---

## Task 2: Instrument Main Process Initialization

**Files:**
- Modify: `electron/main/index.ts`

- [ ] **Step 1: Add startup timer import and marks to main process**

At the top of `electron/main/index.ts`, add the import:

```typescript
import { startupTimer } from '../utils/startup-timer';
```

Find the `initialize()` function and add timing marks. Based on the codebase, locate these points:

**After `app.whenReady()` callback starts:**
```typescript
async function initialize(): Promise<void> {
  startupTimer.mark('app_ready');
  // ... existing code
```

**Before window creation (around `createWindow()` call):**
```typescript
  startupTimer.mark('window_creating');
  const window = createWindow();
  startupTimer.mark('window_created');
```

**At the end of initialization:**
```typescript
  startupTimer.mark('complete');
  startupTimer.complete();
```

- [ ] **Step 2: Verify syntax**

Run: `pnpm run lint`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add electron/main/index.ts
git commit -m "feat(main): add startup timing marks"
```

---

## Task 3: Instrument Background Tasks

**Files:**
- Modify: `electron/main/index.ts`

- [ ] **Step 1: Add timing marks around background task calls**

Locate the background task initialization calls in `initialize()` and wrap each with timing marks:

```typescript
// Telemetry
startupTimer.mark('telemetry_start');
await initTelemetry();
startupTimer.mark('telemetry_done');

// Proxy settings
startupTimer.mark('proxy_start');
await applyProxySettings();
startupTimer.mark('proxy_done');

// Skills installation
startupTimer.mark('skills_start');
await Promise.all([
  ensureBuiltinSkillsInstalled(),
  ensurePreinstalledSkillsInstalled(),
]);
startupTimer.mark('skills_done');

// CLI installation
startupTimer.mark('cli_start');
await autoInstallCliIfNeeded();
startupTimer.mark('cli_done');

// Provider auth sync
startupTimer.mark('provider_sync_start');
await syncAllProviderAuthToRuntime();
startupTimer.mark('provider_sync_done');
```

Note: Adjust the exact locations based on the actual code flow. Some tasks may run in parallel - wrap accordingly.

- [ ] **Step 2: Verify syntax**

Run: `pnpm run lint`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add electron/main/index.ts
git commit -m "feat(main): add background task timing marks"
```

---

## Task 4: Instrument Gateway Manager

**Files:**
- Modify: `electron/gateway/manager.ts`

- [ ] **Step 1: Add startup timer import**

Add at the top of `electron/gateway/manager.ts`:

```typescript
import { startupTimer } from '../utils/startup-timer';
```

- [ ] **Step 2: Add timing marks to start() method**

In the `start()` method, add marks at key points:

```typescript
async start(): Promise<void> {
  startupTimer.mark('gateway_start');
  // ... existing start logic ...

  // After process spawn:
  startupTimer.mark('gateway_process_spawned');

  // Before WebSocket connection:
  startupTimer.mark('gateway_ws_connecting');

  // After WebSocket connected:
  startupTimer.mark('gateway_ws_connected');

  // When gateway reports ready:
  startupTimer.mark('gateway_ready');
}
```

Locate the actual positions in the code and add marks appropriately. The exact location depends on the code flow.

- [ ] **Step 3: Verify syntax**

Run: `pnpm run lint`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add electron/gateway/manager.ts
git commit -m "feat(gateway): add startup timing marks to manager"
```

---

## Task 5: Instrument WebSocket Client

**Files:**
- Modify: `electron/gateway/ws-client.ts`

- [ ] **Step 1: Add startup timer import**

Add at the top of `electron/gateway/ws-client.ts`:

```typescript
import { startupTimer } from '../utils/startup-timer';
```

- [ ] **Step 2: Add timing marks to probeGatewayReady() and waitForGatewayReady()**

In `probeGatewayReady()`:
```typescript
export async function probeGatewayReady(
  port: number,
  timeoutMs = 1000,
): Promise<boolean> {
  startupTimer.mark('ws_probe_start');
  // ... existing logic ...

  // On success:
  startupTimer.mark('ws_probe_success');
  return true;
}
```

In `waitForGatewayReady()`, add mark after successful connection:
```typescript
// After successful probe/connection:
startupTimer.mark('ws_wait_success');
```

- [ ] **Step 3: Verify syntax**

Run: `pnpm run lint`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add electron/gateway/ws-client.ts
git commit -m "feat(gateway): add WebSocket timing marks"
```

---

## Task 6: Instrument Renderer App Component

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Create renderer startup timer utility**

Create `src/lib/startup-timer.ts`:

```typescript
/**
 * Renderer Startup Timer Utility
 * Tracks elapsed time from renderer init for diagnostic logging
 */

const startTime = Date.now();

export const rendererTimer = {
  getElapsed(): number {
    return Date.now() - startTime;
  },

  mark(label: string): void {
    const elapsed = this.getElapsed();
    console.log(`[RENDERER] ${label}: ${elapsed}ms`);
  },

  reset(): void {
    // Not typically used in renderer, but included for consistency
  },

  complete(): void {
    const elapsed = this.getElapsed();
    console.log(`[RENDERER] === COMPLETE: ${elapsed}ms ===`);
  },
};
```

- [ ] **Step 2: Add timing marks to App component**

Add at the top of `src/App.tsx`:

```typescript
import { rendererTimer } from './lib/startup-timer';
```

In the `App` function component:
```typescript
function App() {
  // Mark mount
  React.useEffect(() => {
    rendererTimer.mark('renderer_mount');
    return () => {
      // Cleanup if needed
    };
  }, []);

  // ... existing code ...

  // Add mark after routes render (in the return statement)
  // Add a useEffect for routes rendered
  React.useEffect(() => {
    rendererTimer.mark('routes_rendered');
    rendererTimer.complete();
  }, []);
```

- [ ] **Step 3: Verify syntax**

Run: `pnpm run lint`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/lib/startup-timer.ts src/App.tsx
git commit -m "feat(renderer): add startup timing marks to App"
```

---

## Task 7: Instrument Settings Store

**Files:**
- Modify: `src/stores/settings.ts`

- [ ] **Step 1: Add timing mark to init function**

Add at the top of `src/stores/settings.ts`:

```typescript
import { rendererTimer } from '../lib/startup-timer';
```

In the `init` async function:
```typescript
init: async () => {
  try {
    const settings = await hostApiFetch<Partial<typeof defaultSettings>>('/api/settings');
    // ... existing logic ...
    rendererTimer.mark('settings_store_init');
  } catch (error) {
    // ... existing error handling ...
  }
},
```

- [ ] **Step 2: Verify syntax**

Run: `pnpm run lint`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/stores/settings.ts
git commit -m "feat(stores): add settings store timing mark"
```

---

## Task 8: Instrument Gateway Store

**Files:**
- Modify: `src/stores/gateway.ts`

- [ ] **Step 1: Add timing mark to init function**

Add at the top of `src/stores/gateway.ts`:

```typescript
import { rendererTimer } from '../lib/startup-timer';
```

Locate the `init` function and add mark at the end:
```typescript
init: async () => {
  // ... existing init logic ...

  rendererTimer.mark('gateway_store_init');
},
```

- [ ] **Step 2: Verify syntax**

Run: `pnpm run lint`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/stores/gateway.ts
git commit -m "feat(stores): add gateway store timing mark"
```

---

## Task 9: Instrument Providers Store

**Files:**
- Modify: `src/stores/providers.ts`

- [ ] **Step 1: Add timing mark to init function**

Add at the top of `src/stores/providers.ts`:

```typescript
import { rendererTimer } from '../lib/startup-timer';
```

Locate the `init` function and add mark at the end:
```typescript
init: async () => {
  await get().refreshProviderSnapshot();
  rendererTimer.mark('providers_store_init');
},
```

- [ ] **Step 2: Verify syntax**

Run: `pnpm run lint`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/stores/providers.ts
git commit -m "feat(stores): add providers store timing mark"
```

---

## Task 10: Run Full Test Suite

**Files:**
- Run all tests

- [ ] **Step 1: Run lint**

Run: `pnpm run lint`
Expected: PASS

- [ ] **Step 2: Run startup timer tests**

Run: `pnpm run test tests/electron/utils/startup-timer.test.ts`
Expected: PASS

- [ ] **Step 3: Run full test suite (if applicable)**

Run: `pnpm run test`
Expected: All tests pass

---

## Task 11: Manual Testing and Verification

**Files:**
- Manual testing

- [ ] **Step 1: Start the app in dev mode**

Run: `pnpm run dev`
Expected: App starts and console shows `[STARTUP]` timing logs

- [ ] **Step 2: Verify output format**

Check console output for expected format:
```
[STARTUP] app_ready: XXms
[STARTUP] window_creating: XXms
[STARTUP] window_created: XXms
...
[STARTUP] === COMPLETE: XXXXms ===
```

- [ ] **Step 3: Document findings**

Create a note with the actual startup times observed for future optimization reference.

---

## Summary

This plan adds diagnostic logging to identify startup bottlenecks:

1. **Main Process** - Tracks app ready, window creation, background tasks, gateway lifecycle
2. **Renderer Process** - Tracks React mount, store initialization, routes render
3. **Gateway** - Tracks process spawn, WebSocket connection, ready state

The output format is simple console logs with elapsed milliseconds, making it easy to:
- Identify slow phases
- Compare before/after optimization
- Set performance targets
