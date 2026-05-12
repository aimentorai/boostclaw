# AGENTS.md

## Overview

BoostClaw is a cross-platform **Electron desktop app** (React 19 + Vite + TypeScript) providing a GUI for the OpenClaw AI agent runtime. Single-package pnpm workspace (no monorepo). Pinned pnpm version in `packageManager` field — use `corepack enable && corepack prepare` to activate it.

## Quick reference

| Task | Command |
|------|---------|
| Install + download uv | `pnpm run init` |
| Dev server (Vite + Electron) | `pnpm dev` |
| Lint (ESLint, auto-fix) | `pnpm run lint` |
| Type check | `pnpm run typecheck` |
| Unit tests (Vitest) | `pnpm test` |
| E2E tests (Playwright, headless) | `pnpm run test:e2e` |
| E2E tests (headed) | `pnpm run test:e2e:headed` |
| Build frontend + main only | `pnpm run build:vite` |
| Full release build | `pnpm run build` |
| Secrets scan | `pnpm run secrets:scan` |
| Comms replay | `pnpm run comms:replay` |
| Comms baseline | `pnpm run comms:baseline` |
| Comms regression compare | `pnpm run comms:compare` |

**Required order**: `e2e` depends on `build:vite` (auto-runs it). `dev` auto-runs `pnpm install` + predev scripts.

## Architecture

Single Electron app with **contextIsolation: true, nodeIntegration: false**.

```
Renderer (src/)    ←→  Preload (electron/preload/)  ←→  Main (electron/)
React + Zustand         contextBridge expose          API server + Gateway manager
```

- **Renderer**: Pages (`src/pages/`), components (`src/components/`), Zustand stores (`src/stores/`), library (`src/lib/`), i18n (`src/i18n/`). HashRouter for `file://` compat.
- **Preload** (`electron/preload/index.ts`): Whitelists IPC channels. All `invoke`, `on`, `once` calls are channel-whitelisted — add new channels here.
- **Main** (`electron/main/index.ts`): Window creation, IPC handler registration, Gateway lifecycle, Host API server on `127.0.0.1:19880`.
- **Shared**: `shared/language.ts` (supported language codes: en/zh/ja).
- **Host API**: Sessions use per-session crypto auth token; mutation requests must be `Content-Type: application/json`.

## Renderer → backend data flow (critical)

Renderer code must route ALL backend calls through the lib layer. Three transport paths exist, all Main-owned:

1. **IPC** (primary): `hostApiFetch()` → `invokeApi()` → `invokeIpc()` → preload bridge → `ipcMain.handle('hostapi:fetch')`
2. **WS** (fallback): Direct WebSocket to Gateway, used when IPC is unavailable
3. **HTTP proxy** (fallback): `hostapi:fetch` → main process proxy → Gateway

**Rules enforced by ESLint** (`eslint.config.mjs`):
- Renderer files (`src/**/*.{ts,tsx}`) **cannot** call `window.electron.ipcRenderer.invoke()` directly — must use `invokeIpc` from `@/lib/api-client`.
- Renderer files **cannot** call `fetch('http://127.0.0.1:...')` or `fetch('http://localhost:...')` — must proxy through host-api.
- Exception: `src/lib/api-client.ts` itself.

## Preload IPC whitelist

The preload script (`electron/preload/index.ts`) whitelists all IPC channels for `invoke`, `on`, and `once`. When adding new IPC channels in `electron/main/ipc-handlers.ts`, remember to add them to the preload whitelist or renderer calls will be silently blocked.

## Build pipeline (non-obvious)

- **`bundle-openclaw.mjs`**: Copies openclaw from pnpm virtual store, BFS-walks store to collect all transitive deps into a flat `node_modules/`. Resolves pnpm symlinks for macOS codesign. Patches broken modules (lru-cache ESM interop, https-proxy-agent CJS, windowsHide for child_process).
- **`after-pack.cjs`** (electron-builder hook): Copies `openclaw/node_modules/` into packaged app (electron-builder respects `.gitignore` which excludes it). Bundles plugins from `node_modules/`. Validates Mach-O `.node` binaries, auto-re-downloads corrupted ones. Patches NSIS `extractAppPackage.nsh` to speed up Windows install.
- **`.npmrc`**: `shamefully-hoist=true` and `package-import-method=copy` are required for Electron packaging. Do not remove.
- **Build output**: Vite → `dist/` (renderer) + `dist-electron/` (main/preload). electron-builder reads from these.

## E2E mode (`BoostClaw_E2E=1`)

E2E tests launch **dist-electron + node_modules electron**, not a packaged app (`app.isPackaged` is always `false`). The E2E flag skips: gateway auto-start, system tray, telemetry, proxy settings, launch-at-startup, config migration, skill/plugin installation, expert init, CLI install, workspace setup.

- `BoostClaw_E2E_SKIP_SETUP=1` — skips onboarding setup flow.
- E2E tests use isolated temp `userData` dirs per test run.

## Testing scope and gaps

| Layer | What it covers | What it does NOT cover |
|-------|---------------|----------------------|
| `pnpm test` (Vitest) | Pure logic, React components, stores, API client. jsdom env, mocked `window.electron`. | Electron main process, Gateway, real IPC. |
| `pnpm run test:e2e` (Playwright) | Full renderer UI against dev Electron. Uses `data-testid` locators. | Packaged code paths (`app.isPackaged` — 30+ conditionals). No Gateway runtime. |

**Testing the packaged app** (not covered by CI):
```bash
# Fast: unpacked production build (app.isPackaged = true)
npx electron-builder --dir
# Slow: full installer
pnpm run build
```
Neither is currently automated in CI. When changing code branched on `app.isPackaged`, manually test with `--dir`.

## Non-obvious caveats

- **pnpm version**: Use `corepack enable && corepack prepare` before `pnpm install`. Pinned via `packageManager` in `package.json`.
- **Lint race condition**: After `uv:download`, ESLint may fail with `ENOENT` for `temp_uv_extract`. Re-run lint.
- **Build scripts warning**: Ignored build scripts for `@discordjs/opus` and `koffi` are safe — they're optional messaging-channel deps.
- **Gateway startup latency**: Gateway takes 10–30s to become ready on `pnpm dev`. UI works without it (shows "connecting").
- **No database**: Uses `electron-store` (JSON files) and OS keychain.
- **AI Provider keys**: Required for actual AI chat only. UI fully navigable without keys.
- **OpenClaw Doctor**: In Settings > Advanced > Developer. Must call host-api route — never spawn CLI processes from renderer.
- **Token usage history**: Reads `.jsonl` transcript files from OpenClaw config dir, not from console logs or database.
- **Models page filters**: 7-day/30-day are relative rolling windows, not calendar months.
- **Build paths**: `pnpm dev` writes to `dist-electron/` and serves renderer from dev server. `pnpm run build:vite` writes to `dist/` + `dist-electron/` for production.

## Conventions

- **UI changes**: Include/update an E2E spec for any user-visible change.
- **Comms changes**: Run `pnpm run comms:replay && pnpm run comms:compare` before pushing.
- **Doc sync**: After functional/architecture changes, review `README.md`, `README.zh-CN.md`, `README.ja-JP.md`.
- **Code style**: Prettier (2-space, single quotes, trailing commas es5, 100 print width). ESLint flat config with TS + React hooks + renderer boundary rules.
