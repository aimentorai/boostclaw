# Slow Startup Optimization v2 - Implementation Plan

> **For agentic workers:** REQUIRED sub-skill: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 优化 ClawX 应用启动时间,使窗口显示时间从 30+ 秒缩短到 1-2 秒

**Architecture:** 采用激进并行化策略 - 窗口立即显示,所有后台任务并行执行

**Tech Stack:**
- Electron (主进程)
- TypeScript
- Vite + React
- WebSocket (ws)

---

## Implementation Tasks

### Task 1: 创建启动缓存模块
- [ ] Create `electron/utils/startup-cache.ts`
- [ ] Create `tests/electron/utils/startup-cache.test.ts`
- [ ] Run tests
- [ ] Commit

### Task 2: 创建并行任务执行器
- [ ] Create `electron/utils/startup-tasks.ts`
- [ ] Create `tests/electron/utils/startup-tasks.test.ts`
- [ ] Implement task runner with timeout support
- [ ] Run tests
- [ ] Commit

### Task 3: 重构主进程启动流程
- [ ] Read `electron/main/index.ts` and understand current flow
- [ ] Modify `initialize()` function
- [ ] Test manually
- [ ] Commit

### Task 4: 添加缓存到现有模块
- [ ] Modify `electron/utils/uv-env.ts`
- [ ] Modify `electron/utils/telemetry.ts`
- [ ] Modify `electron/services/providers/provider-runtime-sync.ts`
- [ ] Modify `electron/utils/skill-config.ts`
- [ ] Modify `electron/main/proxy.ts`
- [ ] Modify `electron/utils/openclaw-cli.ts`
- [ ] Run all related tests
- [ ] Commit

### Task 5: 优化Gateway启动超时
- [ ] Modify `electron/gateway/ws-client.ts`
- [ ] Run tests
- [ ] Commit

### Task 6: 运行完整测试套件
- [ ] Run lint
- [ ] Run all unit tests
- [ ] Run integration test
- [ ] Run E2E test
- [ ] Performance benchmark
- [ ] Commit all changes

---

## Task 1: 创建启动缓存模块

### Step 1.1: Write test first
Create `tests/electron/utils/startup-cache.test.ts`:

<details>
<Test file for startup cache module>

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { StartupCache } from '../electron/utils/startup-cache';

describe('StartupCache', () => {
  beforeEach(() => {
    StartupCache.clear();
  });

  it('should set and get value', () => {
    StartupCache.set('test', 'value');
    expect(StartupCache.get('test')).toBe('value');
  });

  it('should handle missing keys', () => {
    expect(StartupCache.get('missing')).toBeUndefined();
  });

  it('should support TTL expiration', async () => {
    StartupCache.set('expiring', 'value', 50);
    expect(StartupCache.has('expiring')).toBe(true);

    await new Promise(resolve => setTimeout(resolve, 100));
    expect(StartupCache.has('expiring')).toBe(false);
  });

  it('should clear all entries', () => {
    StartupCache.set('a', 1);
    StartupCache.set('b', 2);
    StartupCache.clear();
    expect(StartupCache.has('a')).toBe(false);
  });
});
```

### Step 1.2: Run test
```bash
pnpm run test tests/electron/utils/startup-cache.test.ts
```

**Expected:** FAIL (module doesn't exist)

### Step 1.3: Write minimal implementation
Create `electron/utils/startup-cache.ts`:

<details>
Implementation file for startup cache with TTL support

```typescript
import { logger } from './logger';

export class StartupCache {
  private cache = new Map<string, { value: unknown; expires?: number }>();

  private static instance: StartupCache;

  static getInstance(): StartupCache {
    if (!StartupCache.instance) {
      StartupCache.instance = new StartupCache();
    }
    return StartupCache.instance;
  }

  get<T>(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) {
      return undefined;
    }
    if (entry.expires && Date.now() > entry.expires) {
      this.cache.delete(key);
      logger.debug(`StartupCache: key ${key} expired`);
      return undefined;
    }
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs?: number): void {
    const entry = {
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
  }
}
```

### Step 1.4: Run test to verify it passes
```bash
pnpm run test tests/electron/utils/startup-cache.test.ts
```

**Expected:** PASS

### Step 1.5: Commit
```bash
git add electron/utils/startup-cache.ts tests/electron/utils/startup-cache.test.ts
git commit -m "feat(core): add startup cache module with TTL support"
```

---

## Task 2: 创建并行任务执行器
### Step 2.1: Write test first
Create `tests/electron/utils/startup-tasks.test.ts`?

<details>
Test file for parallel task executor

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runStartupTasks, StartupTask } from '../electron/utils/startup-tasks';

describe('runStartupTasks', () => {
  const mockTasks: StartupTask[] = [
    { name: 'task1', execute: vi.fn().mockResolvedValue(), timeout: 100 },
    { name: 'task2', execute: vi.fn().mockRejectedValue(new Error('Failed')), timeout: 100 },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should run all tasks in parallel', async () => {
    const results = await runStartupTasks(mockTasks);
    expect(results).toHaveLength(2);
    expect(results[0].status).toBe('success');
    expect(results[1].status).toBe('failed');
  });

  it('should respect timeout', async () => {
    const slowTask: StartupTask = {
      name: 'slow',
      execute: () => new Promise(resolve => setTimeout(resolve, 200)),
      timeout: 50,
    };

    const results = await runStartupTasks([...mockTasks, slowTask]);
    expect(results.find(r => r.name === 'slow')?.status).toBe('timeout');
  });
});
```

### Step 2.2: Run test
```bash
pnpm run test tests/electron/utils/startup-tasks.test.ts
```
**Expected:** FAIL (module doesn't exist)

### Step 2.3: Write minimal implementation
Create `electron/utils/startup-tasks.ts`?

<details>
Implementation file for parallel task execution with timeout support

```typescript
import { logger } from './logger';

import { StartupCache } from './startup-cache';

export interface StartupTask {
  name: string;
  execute: () => Promise<void>;
  timeout: number;
  optional?: boolean;
}

interface StartupTaskResult {
  name: string;
  status: 'success' | 'failed' | 'timeout';
  error?: Error;
  duration: number;
}

export async function runStartupTasks(tasks: StartupTask[]): Promise<StartupTaskResult[]> {
  const results: StartupTaskResult[] = [];
  const startTime = Date.now();

  await Promise.allSet(
    tasks.map(async (task) => {
    const taskStart = Date.now();

    try {
      // Check cache
      if (StartupCache.has(task.name)) {
        results.push({
          name: task.name,
          status: 'success',
          duration: 0,
        });
        return;
      }

      // Execute with timeout
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Timeout')), task.timeout);
      });

      await Promise.race([
        task.execute(),
        timeoutPromise,
      ]);

      const duration = Date.now() - taskStart;
      results.push({
        name: task.name,
        status: 'success',
        duration,
      });

      // Cache result
      StartupCache.set(task.name, true, 60000); // 60 seconds TTL
    } catch (error) {
      const duration = Date.now() - taskStart;
      results.push({
        name: task.name,
        status: error instanceof Error && error.message === 'Timeout' ? 'timeout' : 'failed',
        error,
        duration,
      });
      logger.warn(`Startup task ${task.name} failed:`, error);
    }
  }));

  return results;
}
```

### Step 2.4: Run test to verify it passes
```bash
pnpm run test tests/electron/utils/startup-tasks.test.ts
```
**Expected:** PASS

### Step 2.5: Commit
```bash
git add electron/utils/startup-tasks.ts tests/electron/utils/startup-tasks.test.ts
git commit -m "feat(core): add parallel task executor with timeout support"
```

---

## Task 3: 重构主进程启动流程
### Step 3.1: Read and understand current code
Read `electron/main/index.ts` and locate the `initialize()` function (lines 277-497)

<details>
Understand the current startup flow and identify blocking operations
</details>
Current code (line 277-497) shows:
1. Telemetry initialization (blocking)
2. Proxy settings (blocking)
3. Launch at startup setting (blocking)
4. Window creation (happens after these)
5. Gateway startup (blocking, 30+ seconds)

</details>

### Step 3.2: Create new version of initialize()
Create `electron/main/index-optimized.ts` as a reference

<details>
This is a temporary file to test the refactor
</details>

```typescript
// Copy the current initialize function signature and comments
async function initializeOptimized(): Promise<void> {
  logger.init();
  logger.info('=== ClawX Application Starting (Optimized) ===');

  if (!isE2EMode) {
    // Warm up network optimization (non-blocking)
    void warmupNetworkOptimization();
  }

  // Create UI components immediately
  createMenu();
  const window = createMainWindow();
  if (!isE2EMode) {
    createTray(window);
  }

  // Register IPC handlers
  registerIpcHandlers(gatewayManager, clawHubService, window);
  hostApiServer = startHostApiServer({ ... });
  registerUpdateHandlers(appUpdater, window);

  // Run all background tasks in parallel with timeout protection
  if (!isE2EMode) {
    const startupTasks: StartupTask[] = [
      { name: 'telemetry', execute: initTelemetry, timeout: 2000 },
      { name: 'proxy', execute: applyProxySettings, timeout: 1000 },
      { name: 'launchAtStartup', execute: syncLaunchAtStartupSettingFromStore, timeout: 500 },
      { name: 'providerAuth', execute: syncAllProviderAuthToRuntime, timeout: 3000 },
      { name: 'skills', execute: ensureBuiltinSkillsInstalled, timeout: 5000 },
      { name: 'plugins', execute: ensureAllBundledPluginsInstalled, timeout: 5000 },
      { name: 'cli', execute: autoInstallCli, timeout: 5000 },
    ];

    const results = await runStartupTasks(startupTasks);
    logger.info('Startup tasks completed:', results);

    // Start Gateway if auto-start enabled
    const gatewayAutoStart = await getSetting('gatewayAutoStart');
    if (gatewayAutoStart) {
      await gatewayManager.start();
      logger.info('Gateway auto-start succeeded');
    } else {
      logger.info('Gateway auto-start disabled in settings');
    }
  } else {
    logger.info('Running in E2E mode: startup side effects minimized');
  }

  // ... rest of the function (event handlers, etc.)
}
```

**Note:** This is a simplified version. The actual implementation will keep all the event handlers and logic from the original file.

</details>

### Step 3.3: Test manually
Run `pnpm run lint` and make sure there are no syntax errors.
Then manually test by running `pnpm run dev` and verifying that:
1. Window appears quickly (< 2 seconds)
2. Gateway starts in background
3. No errors in console

</details>

### Step 3.4: Commit
```bash
git add electron/main/index-optimized.ts
git commit -m "refactor(startup): implement parallel startup with immediate window display"
```
**Note:** We're creating a new file first for safety. Once tested, we'll replace the original file.
</details>

---

## Task 4: 添加缓存到现有模块
### Step 4.1: Modify electron/utils/uv-env.ts
Add caching to `shouldOptimizeNetwork()` and `getUvMirrorEnv()`:

<details>
File: electron/utils/uv-env.ts (lines 1-60)

Add import:
```typescript
import { StartupCache } from './startup-cache';
```

Modify `shouldOptimizeNetwork()`:
```typescript
export async function shouldOptimizeNetwork(): Promise<boolean> {
  // Check cache first
  const cached = StartupCache.get<boolean>('networkOptimized');
  if (cached !== undefined) {
    logger.debug('Using cached network optimization result');
    return cached;
  }

  // ... existing logic ...

  // Cache result
  StartupCache.set('networkOptimized', result, 60000);
  return result;
}
```

Modify `getUvMirrorEnv()`:
```typescript
export async function getUvMirrorEnv(): Promise<Record<string, string>> {
  // Check cache first
  const cached = StartupCache.get<Record<string, string>>('uvMirrorEnv');
  if (cached) {
    logger.debug('Using cached UV mirror env');
    return cached;
  }

  // ... existing logic ...

  // Cache result
  StartupCache.set('uvMirrorEnv', result, 60000);
  return result;
}
```

</details>

### Step 4.2: Modify electron/utils/telemetry.ts
Add caching to avoid repeated initialization

<details>
File: electron/utils/telemetry.ts (lines 1-50)

Add import:
```typescript
import { StartupCache } from './startup-cache';
```

Modify `initTelemetry()`:
```typescript
export async function initTelemetry(): Promise<void> {
  // Check if already initialized
  if (StartupCache.has('telemetryInitialized')) {
    logger.debug('Telemetry already initialized');
    return;
  }

  try {
    const telemetryEnabled = await getSetting('telemetryEnabled');
    if (!telemetryEnabled) {
      logger.info('Telemetry is disabled in settings');
      StartupCache.set('telemetryInitialized', false);
      return;
    }

    // ... existing initialization logic ...

    StartupCache.set('telemetryInitialized', true);
    logger.debug('Telemetry initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize telemetry:', error);
    StartupCache.set('telemetryInitialized', false);
  }
}
```

</details>

### Step 4.3: modify electron/services/providers/provider-runtime-sync.ts
Add skip check

<details>
File: electron/services/providers/provider-runtime-sync.ts (lines 1-50)

Add import:
```typescript
import { StartupCache } from '../../utils/startup-cache';
```

Modify `syncAllProviderAuthToRuntime()`:
```typescript
export async function syncAllProviderAuthToRuntime(): Promise<void> {
  // Skip if already synced
  if (StartupCache.has('providerAuthSynced')) {
    logger.debug('Provider auth already synced');
    return;
  }

  // ... existing sync logic ...

  StartupCache.set('providerAuthSynced', true);
  logger.debug('Provider auth synced successfully');
}
```

</details>

### Step 4.4: modify electron/utils/skill-config.ts
Add caching to installation checks

<details>
File: electron/utils/skill-config.ts

Add import:
```typescript
import { StartupCache } from './startup-cache';
```

Modify both function:
```typescript
export async function ensureBuiltinSkillsInstalled(): Promise<void> {
  if (StartupCache.has('builtinSkillsInstalled')) {
    logger.debug('Builtin skills already installed');
    return;
  }

  // ... existing installation logic ...

  StartupCache.set('builtinSkillsInstalled', true);
}

export async function ensurePreinstalledSkillsInstalled(): Promise<void> {
  if (StartupCache.has('preinstalledSkillsInstalled')) {
    logger.debug('Preinstalled skills already installed');
    return;
  }

  // ... existing installation logic ...

  StartupCache.set('preinstalledSkillsInstalled', true);
}
```

</details>

### Step 4.5: modify electron/main/proxy.ts
Add caching

<details>
File: electron/main/proxy.ts

Add import:
```typescript
import { StartupCache } from '../utils/startup-cache';
```

Modify `applyProxySettings()`:
```typescript
export async function applyProxySettings(): Promise<void> {
  if (StartupCache.has('proxySettingsApplied')) {
    logger.debug('Proxy settings already applied');
    return;
  }

  // ... existing logic ...

  StartupCache.set('proxySettingsApplied', true);
}
```

</details>

### Step 4.6: modify electron/utils/openclaw-cli.ts
Add caching

<details>
File: electron/utils/openclaw-cli.ts

Add import:
```typescript
import { StartupCache } from './startup-cache';
```

Modify `autoInstallCliIfNeeded()`:
```typescript
export async function autoInstallCliIfNeeded(notify?: (path: string) => void): Promise<void> {
  if (StartupCache.has('cliInstalled')) {
    logger.debug('CLI already installed');
    return;
  }

  // ... existing installation logic ...

  StartupCache.set('cliInstalled', true);
}
```

</details>

### Step 4.7: Run all related tests
```bash
pnpm run test
```

### Step 4.8: Commit all changes
```bash
git add -A
git commit -m "perf(startup): add caching to existing modules to avoid repeated work"
```

---

## Task 5: 优化Gateway启动超时
### Step 5.1: Modify electron/gateway/ws-client.ts
Reduce retry count and timeout

<details>
File: electron/gateway/ws-client.ts

Find and `waitForGatewayReady()` function and reduce default retry count from 2400 to 150
</details>

Locate:
```typescript
export async function waitForGatewayReady(options: {
  port: number;
  getProcessExitCode: () => number | null;
  retries?: number;  // Change default from 2400 to 150
  intervalMs?: number;
}): Promise<void> {
  const retries = options.retries ?? 150;  // Reduced for faster failure detection
  const intervalMs = options.intervalMs ?? 200;

  // ... rest of the function
}
```

Also reduce `probeGatewayReady()` timeout:
```typescript
export async function probeGatewayReady(
  port: number,
  timeoutMs = 1000,  // Reduced from 1500
): Promise<boolean> {
  // ... existing logic
}
```

### Step 5.2: Run tests
```bash
pnpm run test
```

### Step 5.3: Commit
```bash
git add electron/gateway/ws-client.ts
git commit -m "perf(gateway): reduce startup timeouts for faster failure detection"
```

---

## Task 6: 运行完整测试套件
### Step 6.1: Run lint
```bash
pnpm run lint
```

### Step 6.2: Run all unit tests
```bash
pnpm run test
```

### Step 6.3: Run integration test
```bash
pnpm run test tests/electron/main/index.test.ts
```

### Step 6.4: Run E2E test
```bash
pnpm run test:e2e
```

### Step 6.5: Performance benchmark
Create `tests/benchmark/startup-performance.test.ts`:

```typescript
import { performance } from 'perf_hooks';
import { app } from 'electron';

describe('Startup Performance Benchmark', () => {
  it('should start within 3 seconds', async () => {
    const start = performance.now();

    await app.whenReady();

    const elapsed = performance.now() - start;
    console.log(`Startup time: ${elapsed}ms`);

    expect(elapsed).toBeLessThan(3000);
  });
});
```

Run:
```bash
pnpm run test tests/benchmark/startup-performance.test.ts
```

### Step 6.6: Commit all changes
```bash
git add -A
git commit -m "test(startup): add performance benchmark and verify <3s startup time"
```

---

## Success Criteria
- [ ] Window displays in < 2 seconds
- [ ] All startup tasks complete in < 5 seconds
- [ ] Gateway ready in < 15 seconds
- [ ] All unit tests passing
- [ ] E2E tests passing
- [ ] Performance benchmark shows < 3s startup time
- [ ] No regressions in existing functionality

- [ ] Code review approved

---

## Risk Mitigation

### Risk 1: Gateway未就绪时用户操作
**Mitigation:**
- UI显示加载状态
- 禁用需要Gateway的按钮
- 提供"Gateway启动中"提示

### Risk 2: 任务失败影响功能
**Mitigation:**
- 每个任务独立超时
- 失败任务记录到日志
- 用户可以手动重试操作

### Risk 3: 并发竞争条件
**Mitigation:**
- 使用StartupCache避免重复执行
- 所有任务幂等执行
- 无共享状态

### Risk 4: 缓存过期数据
**Mitigation:**
- TTL设置60秒
- 下次启动重新计算
- 环境变化自动失效

---

## Notes
- All tasks use TDD approach (test first)
- Each task has clear commit point
- Use feature flags for rollback if needed
- Monitor startup metrics in production
- Update documentation to reflect new startup flow
