# Slow Startup Optimization 设计文档

> **For agentic workers:** use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans ( implement this plan task-by-task, steps with checkbox (`- [ ]`) syntax for tracking

**Goal:** 优化 ClawX 应用启动时间,使窗口显示时间从 30-5 秒缩短到 1-2 秒

**Architecture:** 采用并行化启动和 懒加载策略, 将耗时的组件延迟到首次使用时加载, 同时引入超时机制确保稳定性
**Tech Stack:** 
- Electron (主进程)
- TypeScript
- Vite + React
- WebSocket (ws)

---
```

## Task Structure

### Task 1: 创建启动缓存模块
**Files:**
- create: `electron/utils/startup-cache.ts`
- test: `tests/electron/utils/startup-cache.test.ts`

### Task 2: 优化网络检测 (uv-env.ts)
**Files:**
- modify: `electron/utils/uv-env.ts`
- test: `tests/electron/utils/uv-env.test.ts`

### Task 3: 优化遥测初始化 (telemetry.ts)
**Files:**
- modify: `electron/utils/telemetry.ts`
- test: `tests/electron/utils/telemetry.test.ts`

### Task 4: 优化 Provider Auth 同步 (provider-runtime-sync.ts)
**Files:**
- modify: `electron/services/providers/provider-runtime-sync.ts`
- test: `tests/electron/services/providers/provider-runtime-sync.test.ts`

### Task 5: 优化技能安装 (skill-config.ts)
**Files:**
- modify: `electron/utils/skill-config.ts`
- test: `tests/electron/utils/skill-config.test.ts`

### Task 6: 优化 Gateway 启动超时
**Files:**
- modify: `electron/gateway/supervisor.ts`
- modify: `electron/gateway/ws-client.ts`
- test: `tests/electron/gateway/supervisor.test.ts`

### Task 7: 优化代理设置同步 (proxy.ts)
**Files:**
- modify: `electron/utils/proxy.ts`
- test: `tests/electron/utils/proxy.test.ts`

### Task 8: 优化 CLI 安装
**Files:**
- modify: `electron/utils/openclaw-cli.ts`
- test: `tests/electron/utils/openclaw-cli.test.ts`

### Task 9: 修改主进程启动顺序
**Files:**
- modify: `electron/main/index.ts`

### Task 10: 緻加超时机制到 Gateway Manager
**Files:**
- modify: `electron/gateway/manager.ts`

### Task 11: 运行 lint 和测试
**Files:**
- `tests/electron/utils/startup-cache.test.ts`
- `tests/electron/utils/uv-env.test.ts`
- `tests/electron/utils/telemetry.test.ts`
- `tests/electron/services/providers/provider-runtime-sync.test.ts`
- `tests/electron/utils/skill-config.test.ts`
- `tests/electron/gateway/supervisor.test.ts`
- `tests/electron/gateway/ws-client.test.ts`
- `tests/electron/utils/proxy.test.ts`
- `tests/electron/utils/openclaw-cli.test.ts`
- `tests/electron/gateway/manager.test.ts`

- Run: `pnpm run lint`
- run E2e tests
- run full build test