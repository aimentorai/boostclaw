# Branding: BoostClaw (Breaking Change v1.0+)

BoostClaw is a fork of [CoPaw](https://github.com/agentscope-ai/CoPaw). Starting from v1.0, all legacy `COPAW_*` compatibility has been removed.

## Breaking Change: Environment Variables

**Starting from v1.0, only `BOOSTCLAW_*` prefix is supported.** The `COPAW_*` prefix is no longer recognized.

### Migration Guide (v0.x → v1.0+)

If you have existing deployments using `COPAW_*` environment variables, you **must** rename them:

| Old (v0.x)                       | New (v1.0+)                      |
| -------------------------------- | -------------------------------- |
| `COPAW_WORKING_DIR`              | `BOOSTCLAW_WORKING_DIR`          |
| `COPAW_SECRET_DIR`               | `BOOSTCLAW_SECRET_DIR`           |
| `COPAW_LOG_LEVEL`                | `BOOSTCLAW_LOG_LEVEL`            |
| `COPAW_ENABLED_CHANNELS`         | `BOOSTCLAW_ENABLED_CHANNELS`     |
| `COPAW_CONSOLE_STATIC_DIR`       | `BOOSTCLAW_CONSOLE_STATIC_DIR`   |
| `COPAW_RELOAD_MODE`              | `BOOSTCLAW_RELOAD_MODE`          |
| `COPAW_RUNNING_IN_CONTAINER`     | `BOOSTCLAW_RUNNING_IN_CONTAINER` |
| `COPAW_DESKTOP_APP`              | `BOOSTCLAW_DESKTOP_APP`          |
| `COPAW_SKILL_SCAN_MODE`          | `BOOSTCLAW_SKILL_SCAN_MODE`      |
| `COPAW_TOOL_GUARD_*`             | `BOOSTCLAW_TOOL_GUARD_*`         |
| `COPAW_SKILLS_HUB_*`             | `BOOSTCLAW_SKILLS_HUB_*`         |
| `COPAW_HOME`                     | `BOOSTCLAW_HOME`                 |

## What is BoostClaw

- **Project name**: `boostclaw` in `pyproject.toml`
- **CLI entry point**: `boostclaw` (e.g. `boostclaw app`, `boostclaw init`)
- **Default working directory**: `~/.boostclaw`
- **Default install directory**: `~/.boostclaw`
- **Environment variable prefix**: `BOOSTCLAW_*` (only)

## Installation

All install scripts (`install.sh`, `install.ps1`, `install.bat`) use `BOOSTCLAW_HOME` exclusively. There is no `COPAW_HOME` fallback.

Example:
```bash
export BOOSTCLAW_HOME=$HOME/my-boostclaw
bash scripts/install.sh
```

## Summary

- **Package name**: Unchanged; remains `copaw` (internal; use `boostclaw` CLI).
- **Install / default paths**: `BOOSTCLAW_HOME`, `~/.boostclaw` (only; no legacy aliases).
- **App env vars**: `BOOSTCLAW_*` prefix **only** (breaking change).
- **User-facing branding**: "BoostClaw" and the `boostclaw` CLI everywhere.

