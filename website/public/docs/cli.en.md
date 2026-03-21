# CLI

`boostclaw` is the command-line tool for boostclaw. This page is organized from
"get-up-and-running" to "advanced management" — read from top to bottom if
you're new, or jump to the section you need.

> Not sure what "channels", "heartbeat", or "cron" mean? See
> [Introduction](./intro) first.

---

## Getting started

These are the commands you'll use on day one.

### boostclaw init

First-time setup. Walks you through configuration interactively.

```bash
boostclaw init              # Interactive setup (recommended for first time)
boostclaw init --defaults   # Non-interactive, use all defaults (good for scripts)
boostclaw init --force      # Overwrite existing config files
```

**What the interactive flow covers (in order):**

1. **Heartbeat** — interval (e.g. `30m`), target (`main` / `last`), optional
   active hours.
2. **Show tool details** — whether tool call details appear in channel messages.
3. **Language** — `zh` / `en` / `ru` for agent persona files (SOUL.md, etc.).
4. **Channels** — optionally configure iMessage / Discord / DingTalk / Feishu /
   QQ / Console.
5. **LLM provider** — select provider, enter API key, choose model (**required**).
6. **Skills** — enable all / none / custom selection.
7. **Environment variables** — optionally add key-value pairs for tools.
8. **HEARTBEAT.md** — edit the heartbeat checklist in your default editor.

### boostclaw app

Start the boostclaw server. Everything else — channels, cron jobs, the Console
UI — depends on this.

```bash
boostclaw app                             # Start on 127.0.0.1:8088
boostclaw app --host 0.0.0.0 --port 9090 # Custom address
boostclaw app --reload                    # Auto-reload on code change (dev)
boostclaw app --workers 4                 # Multi-worker mode
boostclaw app --log-level debug           # Verbose logging
```

| Option        | Default     | Description                                                   |
| ------------- | ----------- | ------------------------------------------------------------- |
| `--host`      | `127.0.0.1` | Bind host                                                     |
| `--port`      | `8088`      | Bind port                                                     |
| `--reload`    | off         | Auto-reload on file changes (dev only)                        |
| `--workers`   | `1`         | Number of worker processes                                    |
| `--log-level` | `info`      | `critical` / `error` / `warning` / `info` / `debug` / `trace` |

### Console

Once `boostclaw app` is running, open `http://127.0.0.1:8088/` in your browser to
access the **Console** — a web UI for chat, channels, cron, skills, models,
and more. See [Console](./console) for a full walkthrough.

### boostclaw daemon

Inspect status, version, and recent logs without starting a conversation. Same
behavior as sending `/daemon status` etc. in chat (CLI can show local info when
the app is not running).

| Command                      | Description                                                                               |
| ---------------------------- | ----------------------------------------------------------------------------------------- |
| `boostclaw daemon status`        | Status (config, working dir, memory manager)                                              |
| `boostclaw daemon restart`       | Print instructions (in-chat /daemon restart does in-process reload)                       |
| `boostclaw daemon reload-config` | Re-read and validate config (channel/MCP changes need /daemon restart or process restart) |
| `boostclaw daemon version`       | Version and paths                                                                         |
| `boostclaw daemon logs [-n N]`   | Last N lines of log (default 100; from `boostclaw.log` in working dir)                        |

**Multi-Agent Support:** All commands support the `--agent-id` parameter (defaults to `default`).

```bash
boostclaw daemon status                     # Default agent status
boostclaw daemon status --agent-id abc123   # Specific agent status
boostclaw daemon version
boostclaw daemon logs -n 50
```

---

## Models & environment variables

Before using boostclaw you need at least one LLM provider configured. Environment
variables power many built-in tools (e.g. web search).

### boostclaw models

Manage LLM providers and the active model.

| Command                                | What it does                                         |
| -------------------------------------- | ---------------------------------------------------- |
| `boostclaw models list`                    | Show all providers, API key status, and active model |
| `boostclaw models config`                  | Full interactive setup: API keys → active model      |
| `boostclaw models config-key [provider]`   | Configure a single provider's API key                |
| `boostclaw models set-llm`                 | Switch the active model (API keys unchanged)         |

```bash
boostclaw models list                    # See what's configured
boostclaw models config                  # Full interactive setup
boostclaw models config-key modelscope   # Just set ModelScope's API key
boostclaw models config-key dashscope    # Just set DashScope's API key
boostclaw models config-key custom       # Set custom provider (Base URL + key)
boostclaw models set-llm                 # Change active model only
```


> **Note:** You are responsible for ensuring the API key is valid. boostclaw does
> not verify key correctness. See [Config — LLM Providers](./config#llm-providers).

### boostclaw env

Manage environment variables used by tools and skills at runtime.

| Command                   | What it does                  |
| ------------------------- | ----------------------------- |
| `boostclaw env list`          | List all configured variables |
| `boostclaw env set KEY VALUE` | Set or update a variable      |
| `boostclaw env delete KEY`    | Delete a variable             |

```bash
boostclaw env list
boostclaw env set TAVILY_API_KEY "tvly-xxxxxxxx"
boostclaw env set GITHUB_TOKEN "ghp_xxxxxxxx"
boostclaw env delete TAVILY_API_KEY
```

> **Note:** boostclaw only stores and loads these values; you are responsible for
> ensuring they are correct. See
> [Config — Environment Variables](./config#environment-variables).

---

## Channels

Connect boostclaw to messaging platforms.

### boostclaw channels

Manage channel configuration (iMessage, Discord, DingTalk, Feishu, QQ,
Console, etc.). **Note:** Use `config` for interactive setup (no `configure`
subcommand); use `remove` to uninstall custom channels (no `uninstall`).

| Command                        | What it does                                                                                                      |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `boostclaw channels list`          | Show all channels and their status (secrets masked)                                                               |
| `boostclaw channels install <key>` | Install a channel into `custom_channels/`: create stub or use `--path`/`--url`                                    |
| `boostclaw channels add <key>`     | Install and add to config; built-in channels only get config entry; supports `--path`/`--url`                     |
| `boostclaw channels remove <key>`  | Remove a custom channel from `custom_channels/` (built-ins cannot be removed); `--keep-config` keeps config entry |
| `boostclaw channels config`        | Interactively enable/disable channels and fill in credentials                                                     |

**Multi-Agent Support:** All commands support the `--agent-id` parameter (defaults to `default`).

```bash
boostclaw channels list                    # See default agent's channels
boostclaw channels list --agent-id abc123  # See specific agent's channels
boostclaw channels install my_channel      # Create custom channel stub
boostclaw channels install my_channel --path ./my_channel.py
boostclaw channels add dingtalk            # Add DingTalk to config
boostclaw channels remove my_channel       # Remove custom channel (and from config by default)
boostclaw channels remove my_channel --keep-config   # Remove module only, keep config entry
boostclaw channels config                  # Configure default agent
boostclaw channels config --agent-id abc123 # Configure specific agent
```

The interactive `config` flow lets you pick a channel, enable/disable it, and enter credentials. It loops until you choose "Save and exit".

| Channel      | Fields to fill in                             |
| ------------ | --------------------------------------------- |
| **iMessage** | Bot prefix, database path, poll interval      |
| **Discord**  | Bot prefix, Bot Token, HTTP proxy, proxy auth |
| **DingTalk** | Bot prefix, Client ID, Client Secret          |
| **Feishu**   | Bot prefix, App ID, App Secret                |
| **QQ**       | Bot prefix, App ID, Client Secret             |
| **Console**  | Bot prefix                                    |

> For platform-specific credential setup, see [Channels](./channels).

---

## Cron (scheduled tasks)

Create jobs that run on a timed schedule — "every day at 9am", "every 2 hours
ask boostclaw and send the reply". **Requires `boostclaw app` to be running.**

### boostclaw cron

| Command                      | What it does                                  |
| ---------------------------- | --------------------------------------------- |
| `boostclaw cron list`            | List all jobs                                 |
| `boostclaw cron get <job_id>`    | Show a job's spec                             |
| `boostclaw cron state <job_id>`  | Show runtime state (next run, last run, etc.) |
| `boostclaw cron create ...`      | Create a job                                  |
| `boostclaw cron delete <job_id>` | Delete a job                                  |
| `boostclaw cron pause <job_id>`  | Pause a job                                   |
| `boostclaw cron resume <job_id>` | Resume a paused job                           |
| `boostclaw cron run <job_id>`    | Run once immediately                          |

**Multi-Agent Support:** All commands support the `--agent-id` parameter (defaults to `default`).

### Creating jobs

**Option 1 — CLI arguments (simple jobs)**

Two task types:

- **text** — send a fixed message to a channel on schedule.
- **agent** — ask boostclaw a question on schedule and deliver the reply.

```bash
# Text: send "Good morning!" to DingTalk every day at 9:00 (default agent)
boostclaw cron create \
  --type text \
  --name "Daily 9am" \
  --cron "0 9 * * *" \
  --channel dingtalk \
  --target-user "your_user_id" \
  --target-session "session_id" \
  --text "Good morning!"

# Agent: create task for specific agent
boostclaw cron create \
  --agent-id abc123 \
  --type agent \
  --name "Check todos" \
  --cron "0 */2 * * *" \
  --channel dingtalk \
  --target-user "your_user_id" \
  --target-session "session_id" \
  --text "What are my todo items?"
```

Required: `--type`, `--name`, `--cron`, `--channel`, `--target-user`,
`--target-session`, `--text`.

**Option 2 — JSON file (complex or batch)**

```bash
boostclaw cron create -f job_spec.json
```

JSON structure matches the output of `boostclaw cron get <job_id>`.

### Additional options

| Option                       | Default       | Description                                                              |
| ---------------------------- | ------------- | ------------------------------------------------------------------------ |
| `--timezone`                 | user timezone | Timezone for the cron schedule (defaults to `user_timezone` from config) |
| `--enabled` / `--no-enabled` | enabled       | Create enabled or disabled                                               |
| `--mode`                     | `final`       | `stream` (incremental) or `final` (complete response)                    |
| `--base-url`                 | auto          | Override the API base URL                                                |

### Cron expression cheat sheet

Five fields: **minute hour day month weekday** (no seconds).

| Expression     | Meaning                   |
| -------------- | ------------------------- |
| `0 9 * * *`    | Every day at 9:00         |
| `0 */2 * * *`  | Every 2 hours on the hour |
| `30 8 * * 1-5` | Weekdays at 8:30          |
| `0 0 * * 0`    | Sunday at midnight        |
| `*/15 * * * *` | Every 15 minutes          |

---

## Chats (sessions)

Manage chat sessions via the API. **Requires `boostclaw app` to be running.**

### boostclaw chats

| Command                                | What it does                                                  |
| -------------------------------------- | ------------------------------------------------------------- |
| `boostclaw chats list`                     | List all sessions (supports `--user-id`, `--channel` filters) |
| `boostclaw chats get <id>`                 | View a session's details and message history                  |
| `boostclaw chats create ...`               | Create a new session                                          |
| `boostclaw chats update <id> --name "..."` | Rename a session                                              |
| `boostclaw chats delete <id>`              | Delete a session                                              |

**Multi-Agent Support:** All commands support the `--agent-id` parameter (defaults to `default`).

```bash
boostclaw chats list                        # Default agent's chats
boostclaw chats list --agent-id abc123      # Specific agent's chats
boostclaw chats list --user-id alice --channel dingtalk
boostclaw chats get 823845fe-dd13-43c2-ab8b-d05870602fd8
boostclaw chats create --session-id "discord:alice" --user-id alice --name "My Chat"
boostclaw chats create --agent-id abc123 -f chat.json
boostclaw chats update <chat_id> --name "Renamed"
boostclaw chats delete <chat_id>
```

---

## Skills

Extend boostclaw's capabilities with skills (PDF reading, web search, etc.).

### boostclaw skills

| Command               | What it does                                      |
| --------------------- | ------------------------------------------------- |
| `boostclaw skills list`   | Show all skills and their enabled/disabled status |
| `boostclaw skills config` | Interactively enable/disable skills (checkbox UI) |

**Multi-Agent Support:** All commands support the `--agent-id` parameter (defaults to `default`).

```bash
boostclaw skills list                   # See default agent's skills
boostclaw skills list --agent-id abc123 # See specific agent's skills
boostclaw skills config                 # Configure default agent
boostclaw skills config --agent-id abc123 # Configure specific agent
```

In the interactive UI: ↑/↓ to navigate, Space to toggle, Enter to confirm.
A preview of changes is shown before applying.

> For built-in skill details and custom skill authoring, see [Skills](./skills).

---

## Maintenance

### boostclaw clean

Remove everything under the working directory (default `~/.boostclaw`).

```bash
boostclaw clean             # Interactive confirmation
boostclaw clean --yes       # No confirmation
boostclaw clean --dry-run   # Only list what would be removed
```

---

## Global options

Every `boostclaw` subcommand inherits:

| Option          | Default     | Description                                    |
| --------------- | ----------- | ---------------------------------------------- |
| `--host`        | `127.0.0.1` | API host (auto-detected from last `boostclaw app`) |
| `--port`        | `8088`      | API port (auto-detected from last `boostclaw app`) |
| `-h` / `--help` |             | Show help message                              |

If the server runs on a non-default address, pass these globally:

```bash
boostclaw --host 0.0.0.0 --port 9090 cron list
```

## Working directory

All config and data live in `~/.boostclaw` by default:

- **Global config**: `config.json` (providers, environment variables, agent list)
- **Agent workspaces**: `workspaces/{agent_id}/` (each agent's independent config and data)

```
~/.boostclaw/
├── config.json              # Global config
└── workspaces/
    ├── default/             # Default agent workspace
    │   ├── agent.json       # Agent config
    │   ├── chats.json       # Conversation history
    │   ├── jobs.json        # Cron jobs
    │   ├── AGENTS.md        # Persona files
    │   └── memory/          # Memory files
    └── abc123/              # Other agent workspace
        └── ...
```

| Variable                 | Description                         |
| ------------------------ | ----------------------------------- |
| `BOOSTCLAW_WORKING_DIR`  | Override the working directory path |
| `BOOSTCLAW_CONFIG_FILE`  | Override the config file path       |

See [Config & Working Directory](./config) and [Multi-Agent Workspace](./multi-agent) for full details.

---

## Command overview

| Command          | Subcommands                                                                                                                            | Requires server? |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------- | :--------------: |
| `boostclaw init`     | —                                                                                                                                      |        No        |
| `boostclaw app`      | —                                                                                                                                      |  — (starts it)   |
| `boostclaw models`   | `list` · `config` · `config-key` · `set-llm` · `download` · `local` · `remove-local` · `ollama-pull` · `ollama-list` · `ollama-remove` |        No        |
| `boostclaw env`      | `list` · `set` · `delete`                                                                                                              |        No        |
| `boostclaw channels` | `list` · `install` · `add` · `remove` · `config`                                                                                       |        No        |
| `boostclaw cron`     | `list` · `get` · `state` · `create` · `delete` · `pause` · `resume` · `run`                                                            |     **Yes**      |
| `boostclaw chats`    | `list` · `get` · `create` · `update` · `delete`                                                                                        |     **Yes**      |
| `boostclaw skills`   | `list` · `config`                                                                                                                      |        No        |
| `boostclaw clean`    | —                                                                                                                                      |        No        |

---

## Related pages

- [Introduction](./intro) — What boostclaw can do
- [Console](./console) — Web-based management UI
- [Channels](./channels) — DingTalk, Feishu, iMessage, Discord, QQ setup
- [Heartbeat](./heartbeat) — Scheduled check-in / digest
- [Skills](./skills) — Built-in and custom skills
- [Config & Working Directory](./config) — Working directory and config.json
- [Multi-Agent Workspace](./multi-agent) — Multi-agent setup and management
