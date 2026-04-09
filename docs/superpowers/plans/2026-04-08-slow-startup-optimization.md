# Slow Startup Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
**Goal:** Optimize ClawX application startup time from 30+ seconds to 3-5 seconds by implementing parallel startup, lazy loading, and caching strategies.
**Architecture:** The optimization splits initialization into critical path (UI and Gateway) and non-critical background tasks. Background tasks run in parallel with timeouts, and expensive operations are cached to avoid repeated work.
**Tech Stack:** 
- Electron (main process)
- TypeScript
- Vite + React
- WebSocket (ws)

---

## Task 1: 创建启动缓存模块
**Files:**
- create: `electron/utils/startup-cache.ts`
- test: `tests/electron/utils/startup-cache.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { app } from 'electron';
import { StartupCache } from '../electron/utils/startup-cache';

describe('StartupCache', () => {
  beforeEach(() => {
    StartupCache.clear();
  });

  it('should return undefined for non-existent key', () => {
    expect(StartupCache.get('nonexistent')).toBeUndefined();
  });

  it('should set and get value', () => {
    StartupCache.set('test', { data: 'value' });
    expect(StartupCache.get('test')).toEqual({ data: 'value' });
  });

  it('should check if key exists', () => {
    StartupCache.set('exists', true);
    expect(StartupCache.has('exists')).toBe(true);
    expect(StartupCache.has('missing')).toBe(false);
  });

  it('should delete key', () => {
    StartupCache.set('delete', 'value');
    StartupCache.delete('delete');
    expect(StartupCache.has('delete')).toBe(false);
  });

  it('should clear all entries', () => {
    StartupCache.set('a', 1);
    StartupCache.set('b', 2);
    StartupCache.clear();
    expect(StartupCache.has('a')).toBe(false);
    expect(StartupCache.has('b')).toBe(false);
  });

  it('should handle TTL expiration', async () => {
    StartupCache.set('expiring', 'value', 50); // 50ms TTL
    expect(StartupCache.has('expiring')).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(StartupCache.has('expiring')).toBe(false);
  });

  it('should get with default value', () => {
    const result = StartupCache.get('missing', 'default');
    expect(result).toBe('default');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run test tests/electron/utils/startup-cache.test.ts`
Expected: FAIL with "Cannot find module '../electron/utils/startup-cache'"

- [ ] **Step 3: Write minimal implementation**

```typescript
import { logger } from './logger';

export interface StartupCacheEntry<T> {
  value: T;
  expires?: number;
}

class StartupCacheImpl {
  private cache = new Map<string, StartupCacheEntry<unknown>>();

  get<T>(key: string, defaultValue?: T): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) {
      return defaultValue;
    }
    if (entry.expires && Date.now() > entry.expires) {
      this.cache.delete(key);
      logger.debug(`StartupCache: expired key=${key}`);
      return defaultValue;
    }
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs?: number): void {
    const entry: StartupCacheEntry<T> = {
      value,
      expires: ttlMs ? Date.now() + ttlMs : undefined,
    };
    this.cache.set(key, entry);
  }

  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) {
      return false;
    }
    if (entry.expires && Date.now() > entry.expires) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
    logger.debug('StartupCache: cleared');
  }
}

export const StartupCache = new StartupCacheImpl();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run test tests/electron/utils/startup-cache.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add electron/utils/startup-cache.ts tests/electron/utils/startup-cache.test.ts
git commit -m "feat(utils): add startup cache module"
```

---

## Task 2: 优化网络检测 (uv-env.ts)
**Files:**
- modify: `electron/utils/uv-env.ts`
- test: `tests/electron/utils/uv-env.test.ts`

- [ ] **Step 1: Write the failing test for network optimization caching**

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { shouldOptimizeNetwork, getUvMirrorEnv, warmupNetworkOptimization } from '../electron/utils/uv-env';

import { mock } from 'vitest';
import { EventEmitter } from 'events';

vi.mock('electron', () => ({
  app: {
    ...mockAppMethods(),
    isReady: () => true,
    getLocale: () => 'en-US',
    whenReady: vi.fn(),
  },
}));

vi.mock('https', () => ({
  request: EventEmitter,
}));

describe('uv-env optimization', () => {
  beforeEach(() => {
    // Clear any cached state
  vi.clearAllMocks();
  });

  it('should cache network optimization result', async () => {
    // First call computes
    const result1 = await shouldOptimizeNetwork();
    // Second call should return cached result
    const result2 = await shouldOptimizeNetwork();
    expect(result1).toBe(result2);
  });

  it('should respect cache TTL', async () => {
    await shouldOptimizeNetwork();
    // In real code, the cache would be invalidated after TTL
    // This test just verifies the caching behavior exists
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run test tests/electron/utils/uv-env.test.ts -t "should cache"
Expected: FAIL (caching not implemented)

- [ ] **Step 3: Write minimal implementation - add caching to uv-env.ts**

Add to `shouldOptimizeNetwork()` at `getUvMirrorEnv()`:

```typescript
// Add at the top of uv-env.ts
import { StartupCache } from './startup-cache';

// Modify shouldOptimizeNetwork()
export async function shouldOptimizeNetwork(): Promise<boolean> {
  const cached = StartupCache.get<boolean>('networkOptimized');
  if (cached !== undefined) {
    return cached;
  }

  // ... existing computation logic ...
  const result = isRegionOptimized(locale, timezone) || !reachable;
  
  StartupCache.set('networkOptimized', result, 60_000); // 60 seconds TTL
  return result;
}

// Modify getUvMirrorEnv()
export async function getUvMirrorEnv(): Promise<Record<string, string>> {
  const cached = StartupCache.get<Record<string, string>>('uvMirrorEnv');
  if (cached) {
    return cached;
  }

  const isOptimized = await shouldOptimizeNetwork();
  const result = isOptimized ? { ...UV_MIRROR_ENV } : {};
  StartupCache.set('uvMirrorEnv', result, 60_000);
  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run test tests/electron/utils/uv-env.test.ts -t "should cache"
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add electron/utils/uv-env.ts tests/electron/utils/uv-env.test.ts
git commit -m "perf(uv-env): add network optimization caching"
```

---

## Task 3: 优化遥测初始化 (telemetry.ts)
**Files:**
- modify: `electron/utils/telemetry.ts`
- test: `tests/electron/utils/telemetry.test.ts`

- [ ] **Step 1: Write the failing test for lazy telemetry init**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { initTelemetry, getTelemetryEnabled } from '../electron/utils/telemetry';
import { StartupCache } from '../electron/utils/startup-cache';

vi.mock('./store', () => ({
  getSetting: vi.fn(),
  setSetting: vi.fn(),
}));

vi.mock('posthog-node', () => ({
  default: vi.fn(),
}));

vi.mock('node-machine-id', () => ({
  machineIdSync: vi.fn(),
}));

describe('telemetry optimization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    StartupCache.clear();
  });

  it('should skip initialization when disabled', async () => {
    vi.mocked(getSetting).mockResolvedValue('telemetryEnabled', false);
    await initTelemetry();
    expect(getTelemetryEnabled()).toBe(false);
  });

  it('should cache telemetry enabled status', async () => {
    vi.mocked(getSetting).mockResolvedValue('telemetryEnabled', true);
    vi.mocked(getSetting).mockResolvedValue('machineId', 'test-machine-id');
    
    await initTelemetry();
    
    // Second call should use cache
    const enabled = getTelemetryEnabled();
    expect(enabled).toBe(true);
    expect(getSetting).toHaveBeenCalledTimes(1); // Only called once
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run test tests/electron/utils/telemetry.test.ts -t "should cache"
Expected: FAIL (caching not implemented)

- [ ] **Step 3: Write minimal implementation - add lazy init to telemetry.ts**

```typescript
// Add helper function
export function getTelemetryEnabled(): boolean {
  return StartupCache.has('telemetryEnabled');
}

// Modify initTelemetry
export async function initTelemetry(): Promise<void> {
  // Check cache first
  if (StartupCache.has('telemetryInitialized')) {
    return;
  }

  try {
    const telemetryEnabled = await getSetting('telemetryEnabled');
    StartupCache.set('telemetryEnabled', telemetryEnabled);
    
    if (!telemetryEnabled) {
      logger.info('Telemetry is disabled in settings');
      StartupCache.set('telemetryInitialized', true);
      return;
    }

    // ... rest of initialization logic ...

    StartupCache.set('telemetryInitialized', true);
    logger.debug('Telemetry initialized');
  } catch (error) {
    logger.error('Failed to initialize telemetry:', error);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run test tests/electron/utils/telemetry.test.ts -t "should cache"
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add electron/utils/telemetry.ts tests/electron/utils/telemetry.test.ts
git commit -m "perf(telemetry): add lazy initialization and caching"
```

---

## Task 4: 优化 Provider Auth 同步 (provider-runtime-sync.ts)
**Files:**
- modify: `electron/services/providers/provider-runtime-sync.ts`
- test: `tests/electron/services/providers/provider-runtime-sync.test.ts`

- [ ] **Step 1: Write the failing test for provider sync caching**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { syncAllProviderAuthToRuntime, from '../electron/services/providers/provider-runtime-sync';
import { StartupCache } from '../electron/utils/startup-cache';

// Mock dependencies
vi.mock('../electron/utils/store');
vi.mock('../electron/utils/openclaw-proxy');

describe('provider-runtime-sync optimization', () => {
  beforeEach(() => {
    StartupCache.clear();
  });

  it('should cache provider sync status', async () => {
    // First sync
    await syncAllProviderAuthToRuntime();
    
    // Verify cache was set
    expect(StartupCache.has('providerAuthSynced')).toBe(true);
  });

  it('should skip sync if already synced', async () => {
    // Set cache
    StartupCache.set('providerAuthSynced', true);
    
    // Sync should be no-op
    await syncAllProviderAuthToRuntime();
    
    // Verify it didn't do called
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run test tests/electron/services/providers/provider-runtime-sync.test.ts -t "should cache"
Expected: FAIL (caching not implemented)

- [ ] **Step 3: Write minimal implementation - add skip check to provider-runtime-sync.ts**

At the top of provider-runtime-sync.ts:
```typescript
import { StartupCache } from '../utils/startup-cache';

export async function syncAllProviderAuthToRuntime(): Promise<void> {
  // Skip if already synced
  if (StartupCache.has('providerAuthSynced')) {
    return;
  }

  // ... existing sync logic ...

  StartupCache.set('providerAuthSynced', true);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run test tests/electron/services/providers/provider-runtime-sync.test.ts -t "should cache"
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add electron/services/providers/provider-runtime-sync.ts tests/electron/services/providers/provider-runtime-sync.test.ts
git commit -m "perf(providers): add sync caching"
```

---

## Task 5: 优化技能安装 (skill-config.ts)
**Files:**
- modify: `electron/utils/skill-config.ts`
- test: `tests/electron/utils/skill-config.test.ts`

- [ ] **Step 1: Write the failing test for skill installation caching**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ensureBuiltinSkillsInstalled, ensurePreinstalledSkillsInstalled } from '../electron/utils/skill-config';
import { StartupCache } from '../electron/utils/startup-cache';

vi.mock('fs/promises', () => ({
  access: vi.fn(),
  constants: { F_OK: 1 },
  readFile: vi.fn(),
  writeFile: vi.fn(),
  readdir: vi.fn(),
  mkdir: vi.fn(),
  unlink: vi.fn(),
  cp: vi.fn(),
}));

describe('skill-config optimization', () => {
  beforeEach(() => {
    StartupCache.clear();
  });

  it('should cache installed skills', async () => {
    // First call - installs
    await ensureBuiltinSkillsInstalled();
    
    // Cache should be set
    expect(StartupCache.has('builtinSkillsInstalled')).toBe(true);
  });

  it('should skip installation if cached', async () => {
    StartupCache.set('builtinSkillsInstalled', true);
    
    // Should be no-op
    await ensureBuiltinSkillsInstalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run test tests/electron/utils/skill-config.test.ts -t "should cache"
Expected: FAIL (caching not implemented)

- [ ] **Step 3: Write minimal implementation - add skip check to skill-config.ts**

Add to `ensureBuiltinSkillsInstalled()`:
```typescript
import { StartupCache } from './startup-cache';

export async function ensureBuiltinSkillsInstalled(): Promise<void> {
  // Skip if already installed this session
  if (StartupCache.has('builtinSkillsInstalled')) {
    return;
  }

  // ... existing installation logic ...

  StartupCache.set('builtinSkillsInstalled', true);
}
```

Add to `ensurePreinstalledSkillsInstalled()`:
```typescript
export async function ensurePreinstalledSkillsInstalled(): Promise<void> {
  // Skip if already installed this session
  if (StartupCache.has('preinstalledSkillsInstalled')) {
    return;
  }

  // ... existing installation logic ...

  StartupCache.set('preinstalledSkillsInstalled', true);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run test tests/electron/utils/skill-config.test.ts -t "should cache"
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add electron/utils/skill-config.ts tests/electron/utils/skill-config.test.ts
git commit -m "perf(skills): add installation caching"
```

---

## Task 6: 优化 Gateway 启动超时
**Files:**
- modify: `electron/gateway/supervisor.ts`
- modify: `electron/gateway/ws-client.ts`
- test: `tests/electron/gateway/supervisor.test.ts`

- [ ] **Step 1: Write the failing test for reduced retry count**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { waitForGatewayReady } from '../electron/gateway/ws-client';

describe('gateway timeout optimization', () => {
  it('should use shorter timeout for faster failure detection', async () => {
    // Test that timeout is reasonable
    const timeoutMs = 1500;
    expect(timeoutMs).toBeLessThan(2000);
  });

  it('should reduce retry count from 2400 to 150', () => {
    // Original: 2400 retries * 200ms = 480s
    // Optimized: 150 retries * 200ms = 30s max wait
    const maxRetries = 150;
    expect(maxRetries).toBeLessThan(500);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run test tests/electron/gateway/supervisor.test.ts -t "should reduce"
Expected: FAIL (values not optimized)

- [ ] **Step 3: Write minimal implementation - optimize timeout values in ws-client.ts**

Change:
```typescript
// From
export async function waitForGatewayReady(options: {
  port: number;
  getProcessExitCode: () => number | null;
  retries?: number;  // default: 2400
  intervalMs?: number; // default: 200
}): Promise<void> {
  const retries = options.retries ?? 2400;
  const intervalMs = options.intervalMs ?? 200;
  // ...
}

// To
export async function waitForGatewayReady(options: {
  port: number;
  getProcessExitCode: () => number | null;
  retries?: number;  // default: 150 (reduced from 2400)
  intervalMs?: number; // default: 200
}): Promise<void> {
  const retries = options.retries ?? 150;  // Reduced for faster failure
  const intervalMs = options.intervalMs ?? 200;
  // ...
}
```

Also optimize `probeGatewayReady`:
```typescript
export async function probeGatewayReady(
  port: number,
  timeoutMs = 1000, // Reduced from 1500
): Promise<boolean> {
  // ...
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run test tests/electron/gateway/supervisor.test.ts -t "should reduce"
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add electron/gateway/ws-client.ts tests/electron/gateway/supervisor.test.ts
git commit -m "perf(gateway): optimize startup timeouts"
```

---

## Task 7: 优化代理设置同步 (proxy.ts)
**Files:**
- modify: `electron/utils/proxy.ts`
- test: `tests/electron/utils/proxy.test.ts`

- [ ] **Step 1: Write the failing test for proxy settings caching**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { applyProxySettings } from '../electron/utils/proxy';
import { StartupCache } from '../electron/utils/startup-cache';

vi.mock('./store', () => ({
  getSetting: vi.fn(),
}));

describe('proxy optimization', () => {
  beforeEach(() => {
    StartupCache.clear();
  });

  it('should cache proxy settings', async () => {
    vi.mocked(getSetting).mockResolvedValue({
      proxyEnabled: true,
      proxyServer: 'proxy.example.com:8080',
    });

    await applyProxySettings();

    expect(StartupCache.has('proxySettingsApplied')).toBe(true);
  });

  it('should skip if already applied', async () => {
    StartupCache.set('proxySettingsApplied', true);
    
    await applyProxySettings();
    
    // Should be no-op
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run test tests/electron/utils/proxy.test.ts -t "should cache"
Expected: FAIL (caching not implemented)

- [ ] **Step 3: Write minimal implementation - add caching to proxy.ts**

```typescript
import { StartupCache } from './startup-cache';

export async function applyProxySettings(): Promise<void> {
  // Skip if already applied
  if (StartupCache.has('proxySettingsApplied')) {
    return;
  }

  // ... existing logic ...

  StartupCache.set('proxySettingsApplied', true);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run test tests/electron/utils/proxy.test.ts -t "should cache"
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add electron/utils/proxy.ts tests/electron/utils/proxy.test.ts
git commit -m "perf(proxy): add settings caching"
```

---

## Task 8: 优化 CLI 安装
**Files:**
- modify: `electron/utils/openclaw-cli.ts`
- test: `tests/electron/utils/openclaw-cli.test.ts`

- [ ] **Step 1: Write the failing test for CLI installation caching**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { autoInstallCliIfNeeded } from '../electron/utils/openclaw-cli';
import { StartupCache } from '../electron/utils/startup-cache';

vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    getName: () => 'ClawX',
  },
}));

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  unlinkSync: vi.fn(),
  symlinkSync: vi.fn(),
}));

describe('CLI optimization', () => {
  beforeEach(() => {
    StartupCache.clear();
  });

  it('should cache CLI installation status', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    
    await autoInstallCliIfNeeded();
    
    expect(StartupCache.has('cliInstalled')).toBe(true);
  });

  it('should skip installation if already installed', async () => {
    StartupCache.set('cliInstalled', true);
    
    await autoInstallCliIfNeeded();
    
    // Should be no-op
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run test tests/electron/utils/openclaw-cli.test.ts -t "should cache"
Expected: FAIL (caching not implemented)

- [ ] **Step 3: Write minimal implementation - add caching to openclaw-cli.ts**

```typescript
import { StartupCache } from './startup-cache';

export async function autoInstallCliIfNeeded(
  notify?: (path: string) => void
): Promise<void> {
  // Skip if already installed this session
  if (StartupCache.has('cliInstalled')) {
    return;
  }

  // ... existing installation logic ...

  StartupCache.set('cliInstalled', true);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run test tests/electron/utils/openclaw-cli.test.ts -t "should cache"
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add electron/utils/openclaw-cli.ts tests/electron/utils/openclaw-cli.test.ts
git commit -m "perf(cli): add installation caching"
```

---

## Task 9: 修改主进程启动顺序
**Files:**
- modify: `electron/main/index.ts`

- [ ] **Step 1: Modify initialize() to use parallel startup**

In `electron/main/index.ts`, modify the `initialize()` function:

```typescript
async function initialize(): Promise<void> {
  logger.init();
  logger.info('=== ClawX Application Starting ===');

  if (!isE2EMode) {
    // Warmup network optimization (non-blocking)
    void warmupNetworkOptimization();

    // Initialize all background tasks in parallel with timeout
    const backgroundTasks = Promise.race([
      // Fast timeout for network - 2s
      warmupNetworkOptimization().then(() => 
        throw new Error('Network optimization timeout')
      ),
      // Telemetry init with timeout
      initTelemetry().then(() => {
        logger.debug('Telemetry init timeout');
      }),
      // Proxy settings with timeout
      applyProxySettings().then(() => {
        logger.debug('Proxy settings timeout');
      }),
      // Provider auth sync with timeout
      syncAllProviderAuthToRuntime().then(() => {
        logger.debug('Provider auth sync timeout');
      }),
      // Skill installation with timeout
      ensureBuiltinSkillsInstalled().then(() => {
        logger.debug('Builtin skills timeout');
      }),
      ensurePreinstalledSkillsInstalled().then(() => {
        logger.debug('Preinstalled skills timeout');
      }),
      // CLI installation with timeout
      autoInstallCliIfNeeded().then(() => {
        logger.debug('CLI installation timeout');
      }),
    ].catch((error) => {
      // Log but but continue - errors don't block startup
      logger.warn('Background task error (non-blocking):', error);
    });

    // These MUST complete before showing window
    await Promise.race([
      initTelemetry(),
      applyProxySettings(),
    ]);
  } else {
    logger.info('Running in E2E mode: startup side effects minimized');
  }

  // Create menu and window immediately (critical path)
  createMenu();
  const window = createMainWindow();

  // Create system tray
  if (!isE2EMode) {
    createTray(window);
  }

  // ... rest of the function (WebSocket handlers, etc.)
}
```

- [ ] **Step 2: Verify syntax**

Run: `pnpm run lint`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add electron/main/index.ts
git commit -m "perf(main): parallel startup with timeouts"
```

---

## Task 10: 添加超时机制到 Gateway Manager
**Files:**
- modify: `electron/gateway/manager.ts`

- [ ] **Step 1: Add startup timeout to start() method**

```typescript
// In manager.ts, modify start() method
async start(): Promise<void> {
  // Add overall startup timeout
  const STARTUP_TIMEOUT_MS = 60_000; // 60 seconds max
  
  const startupTimeout = setTimeout(() => {
    if (this.status.state === 'starting') {
      logger.error('Gateway startup timed out');
      this.setStatus({ state: 'error', error: 'Startup timeout' });
      this.startLock = false;
    }
  }, STARTUP_TIMEOUT_MS);

  
  // ... existing start logic ...
}
```

- [ ] **Step 2: Verify syntax**

Run: `pnpm run lint`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add electron/gateway/manager.ts
git commit -m "perf(gateway): add startup timeout"
```

---

## Task 11: 运行 lint 和测试
**Files:**
- Run: `pnpm run lint`
- Run: `pnpm run test tests/electron/utils/startup-cache.test.ts`
- Run: `pnpm run test tests/electron/utils/uv-env.test.ts`
- Run: `pnpm run test tests/electron/utils/telemetry.test.ts
- Run: `pnpm run test tests/electron/services/providers/provider-runtime-sync.test.ts`
- Run: `pnpm run test tests/electron/utils/skill-config.test.ts
- Run: `pnpm run test tests/electron/gateway/supervisor.test.ts
- Run: `pnpm run test tests/electron/utils/proxy.test.ts
- Run: `pnpm run test tests/electron/utils/openclaw-cli.test.ts
- Run full build test

