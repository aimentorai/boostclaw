# Slow Startup Optimization 设计文档 v2

> **For agentic workers:** use superpowers:subagent-driven-development (recommended) or or or superpowers:executing-plans to implement this plan task-by-task, steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 优化 ClawX 应用启动时间，使窗口显示时间从 30+ 秒缩短到 1-2 秒

**Architecture:** 采用并行化启动和懒加载策略, 将耗时的组件延迟到首次使用时加载, 同时引入超时机制确保稳定性

**Tech Stack: 
- Electron (主进程)
- TypeScript
- Vite + React
- WebSocket (ws)

---

## 栩心改动概览

### 猛烈优化

**目标窗口显示时间** < 2s

**改动文件**: `electron/main/index.ts`

**改动点**:
1. 移除 `createMainWindow()` 尴 `initialize()` 函数中串行阻塞
2. 在 `initialize()` 开头立即创建并显示窗口
3. 将所有后台任务改为并行执行（带超时）
4. 移除 await 阣塞

**代码位置**: Line 277-497 (initialize 函数)

**改动前**:
```typescript
// 当前: 串行阻塞
await initTelemetry();          // 阻塞
await applyProxySettings();     // 阻塞  
await syncLaunchAtStartupSettingFromStore(); // 阻塞
const window = createMainWindow(); // 窗口在所有阻塞任务后才创建
```

**改动后**:
```typescript
// 优化后: 立即创建窗口，const window = createMainWindow(); // ✅ 立即创建
createMenu();                  // ✅ 緻加到并行队列
createTray(window);              // ✅ 添加到并行队列

// 所有后台任务并行执行
runStartupTasks([
  { name: 'telemetry', execute: initTelemetry, timeout: 2000 },
  { name: 'proxy', execute: applyProxySettings, timeout: 1000 },
  { name: 'syncLaunch', execute: syncLaunchAtStartupSettingFromStore, timeout: 500 },
  { name: 'providerAuth', execute: syncAllProviderAuthToRuntime, timeout: 3000 },
  { name: 'gateway', execute: startGateway, timeout: 30000 },
  { name: 'skills', execute: ensureBuiltinSkillsInstalled, timeout: 5000 },
  { name: 'plugins', execute: ensureAllBundledPluginsInstalled, timeout: 5000 },
  { name: 'cli', execute: autoInstallCli, timeout: 5000 },
]);
```

---

## 宋持优化

**目标**: 避免重复计算, 减少网络请求

**改动文件**: `electron/utils/startup-cache.ts` (新建)

**功能**:
- 内存缓存 (Map 结构)
- TTL 支持 (60秒自动过期)
- 快速失败/重试机制

**代码位置**: `electron/utils/startup-cache.ts`

```typescript
export class StartupCache {
  private cache = new Map<string, CacheEntry>();
  
  get<T>(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (entry.expires && Date.now() > entry.expires) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.value as T;
  }
  
  set<T>(key: string, value: T, ttlMs?: number): void {
    this.cache.set(key, {
      value,
      expires: ttlMs ? Date.now() + ttlMs : undefined,
    });
  }
  
  has(key: string): boolean {
    return this.cache.has(key);
  }
  
  delete(key: string): void {
    this.cache.delete(key);
  }
  
  clear(): void {
    this.cache.clear();
  }
}

export const startupCache = new StartupCache();
```

---

## 缓存优化

### 网络检测优化

**目标**: 避免重复的网络探测

**改动文件**: `electron/utils/uv-env.ts`

**改动**:
- 使用 StartupCache 缓存结果
- TTL: 60秒

```typescript
// 改动前: 每次都探测网络
export async function shouldOptimizeNetwork(): Promise<boolean> {
  const locale = app.getLocale();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const isOptimized = isRegionOptimized(locale, timezone);
  
  const reachable = await probeGoogle204(2000);
  return isOptimized || !reachable;
}

```

```typescript
// 改动后: 使用缓存
export async function shouldOptimizeNetwork(): Promise<boolean> {
  const cached = startupCache.get<boolean>('networkOptimized');
  if (cached !== undefined) return cached;
  
  // ... 计算逻辑 ...
  startupCache.set('networkOptimized', result, 60000);
  return result;
}
```

### 遥测优化

**目标**: 避免重复的遥测初始化

**改动文件**: `electron/utils/telemetry.ts`

**改动**:
- 使用 StartupCache 缓存初始化状态
- 如果已初始化则跳过

```typescript
export async function initTelemetry(): Promise<void> {
  // 检查缓存
  if (startupCache.has('telemetryInitialized')) {
    return;
  }
  
  // ... 初始化逻辑 ...
  
  startupCache.set('telemetryInitialized', true);
}
```

### Provider Auth 同步优化

**目标**: 避免重复的同步

**改动文件**: `electron/services/providers/provider-runtime-sync.ts`

**改动**:
- 使用 StartupCache 缓存同步状态

```typescript
export async function syncAllProviderAuthToRuntime(): Promise<void> {
  // 检查缓存
  if (startupCache.has('providerAuthSynced')) {
    return;
  }
  
  // ... 同步逻辑 ...
  
  startupCache.set('providerAuthSynced', true);
}
```

### 技能安装优化

**目标**: 避免重复安装检查

**改动文件**: `electron/utils/skill-config.ts`

**改动**:
- 使用 StartupCache 缓存安装状态

```typescript
export async function ensureBuiltinSkillsInstalled(): Promise<void> {
  // 检查缓存
  if (startupCache.has('builtinSkillsInstalled')) {
    return;
  }
  
  // ... 安装逻辑 ...
  
  startupCache.set('builtinSkillsInstalled', true);
}
```

### Proxy 设置优化

**目标**: 避免重复应用

**改动文件**: `electron/utils/proxy.ts`

**改动**:
- 使用 StartupCache 缓存应用状态

```typescript
export async function applyProxySettings(): Promise<void> {
  // 检查缓存
  if (startupCache.has('proxySettingsApplied')) {
    return;
  }
  
  // ... 应用逻辑 ...
  
  startupCache.set('proxySettingsApplied', true);
}
```

### CLI 安装优化

**目标**: 避免重复安装检查

**改动文件**: `electron/utils/openclaw-cli.ts`

**改动**:
- 使用 StartupCache 缓存安装状态

```typescript
export async function autoInstallCliIfNeeded(): Promise<void> {
  // 检查缓存
  if (startupCache.has('cliInstalled')) {
    return;
  }
  
  // ... 安装逻辑 ...
  
  startupCache.set('cliInstalled', true);
}
```

---

## 超时优化

### Gateway 启动超时

**目标**: 减少最大等待时间, 更快失败

**改动文件**: `electron/gateway/ws-client.ts`

**改动**:
- 最大重试次数: 2400 → 150 (480s → 30s)
- 探测超时: 1500ms → 1000ms

```typescript
// 改动前
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

// 改动后
export async function waitForGatewayReady(options: {
  port: number;
  getProcessExitCode: () => number | null;
  retries?: number;  // default: 150 (reduced)
  intervalMs?: number; // default: 200
}): Promise<void> {
  const retries = options.retries ?? 150;
  const intervalMs = options.intervalMs ?? 200;
  // ...
}
```

---

## 错误处理策略

### 1. 任务失败处理

**策略**: 记录错误但不阻塞其他任务

```typescript
// 统一的错误处理包装器
async function executeTask(
  name: string,
  task: () => Promise<void>,
  timeout: number,
): Promise<void> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    await task();
    clearTimeout(timeoutId);
    logger.debug(`Task ${name} completed`);
  } catch (error) {
    clearTimeout(timeoutId);
    logger.warn(`Task ${name} failed:`, error);
    // 不抛出错误,继续其他任务
  }
}
```

### 2. 超时处理

**策略**: 超时后取消任务,不影响其他任务

```typescript
// 在 runStartupTasks 中
const taskPromise = executeTask(
  task.name,
  task.execute,
  task.timeout
);

// 使用 Promise.allSettled 确保一个任务失败不影响其他任务
const results = await Promise.allSettled(taskPromises);

results.forEach((result, index) => {
  if (result.status === 'rejected') {
    logger.warn(`Startup task ${tasks[index].name} failed:`, result.reason);
  }
});
```

---

## 测试策略

### 单元测试

**目标**: 验证缓存模块和各个优化点

**测试文件**: `tests/electron/utils/startup-cache.test.ts`

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { startupCache } from '../electron/utils/startup-cache';

describe('StartupCache', () => {
  beforeEach(() => {
    startupCache.clear();
  });

  it('should set and get value', () => {
    startupCache.set('test', { data: 'value' });
    expect(startupCache.get('test')).toEqual({ data: 'value' });
  });

  it('should handle TTL expiration', async () => {
    startupCache.set('expiring', 'value', 50);
    expect(startupCache.has('expiring')).toBe(true);
    
    await new Promise(resolve => setTimeout(resolve, 100));
    
    expect(startupCache.has('expiring')).toBe(false);
  });

  it('should return undefined for missing key', () => {
    expect(startupCache.get('missing')).toBeUndefined();
  });
});
```

### 集成测试

**目标**: 验证并行启动流程

**测试文件**: `tests/electron/main/index.test.ts`

```typescript
describe('Startup Parallelization', () => {
  it('should create window immediately', async () => {
    const { window } = await initialize();
    expect(window).toBeDefined();
    expect(window.isVisible()).toBe(true);
  });

  it('should run background tasks in parallel', async () => {
    const start = Date.now();
    await initialize();
    const elapsed = Date.now() - start;
    
    // 所有任务并行,应该在3秒内完成
    expect(elapsed).toBeLessThan(3000);
  });
});
```

### E2E 测试

**目标**: 验证真实启动性能

**测试文件**: `tests/e2e/startup.spec.ts`

```typescript
import { test, expect } from '@playwright/test';

test('startup time should be under 3 seconds', async ({ page }) => {
  const start = Date.now();
  await page.goto('app://clawx');
  await page.waitForSelector('[data-testid="app-ready"]');
  const elapsed = Date.now() - start;
  
  expect(elapsed).toBeLessThan(3000);
});
```

---

## 实现步骤

### 阶段1: 基础设施 (1天)
- [ ] 创建 `startup-cache.ts` 模块
- [ ] 添加单元测试

### 阶段2: 添加缓存 (1天)
- [ ] 优化 uv-env.ts
- [ ] 优化 telemetry.ts
- [ ] 优化 provider-runtime-sync.ts
- [ ] 优化 skill-config.ts
- [ ] 优化 proxy.ts
- [ ] 优化 openclaw-cli.ts

### 阶段3: 并行化启动 (1天)
- [ ] 重构 `initialize()` 函数
- [ ] 添加任务执行器
- [ ] 添加超时保护

### 阶段4: Gateway 优化 (0.5天)
- [ ] 优化 ws-client.ts 超时
- [ ] 添加启动超时机制

### 阶段5: 测试和验证 (0.5天)
- [ ] 运行所有单元测试
- [ ] 运行集成测试
- [ ] 运行 E2E 测试
- [ ] 性能基准测试

---

## 风险评估

| 风险 | 影响 | 缓解策略 |
|------|------|---------|
| Gateway未就绪时用户操作 | 中 | UI显示加载状态,禁用相关按钮 |
| 任务失败影响功能 | 低 | 错误记录,用户可重试操作 |
| 并发竞争条件 | 低 | 使用缓存避免重复执行 |
| 缓存过期数据 | 低 | TTL 60秒,下次启动重新计算 |

---

## 成功指标

- ✅ 窗口显示时间 < 2秒
- ✅ 完全就绪时间 < 3秒
- ✅ 所有单元测试通过
- ✅ E2E 测试通过
- ✅ 无功能回归

---

这个设计方案是否符合您的期望？我可以开始实现吗？还是需要调整哪些部分?
