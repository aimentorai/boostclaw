# Introduction

This page describes what boostclaw is, what it can do, and how to get started by
following the docs.

---

## What is boostclaw?

boostclaw is a **personal assistant** that runs in your own environment.

- **Multi-channel chat** — Talk to you via DingTalk, Feishu, QQ, Discord, iMessage, and more.
- **Scheduled execution** — Run tasks automatically on your configured schedule.
- **Driven by Skills — the possibilities are open-ended** — Built-in skills include cron (scheduled jobs), PDF and forms, Word/Excel/PPT handling, news digest, file reading, and more; add custom skills as described in [Skills](./skills).
- **All data stays local** — No third-party hosting.

---

## How do you use boostclaw?

You use boostclaw in two main ways:

1. **Chat in your messaging apps**
   Send messages in DingTalk, Feishu, QQ, Discord, or iMessage (Mac only); boostclaw replies
   in the same app and can look things up, manage todos, answer questions —
   whatever the enabled Skills support. One boostclaw instance can be connected to
   several apps; it replies in the channel where you last talked.

2. **Run on a schedule**
   Without sending a message each time, boostclaw can run at set times:
   - Send a fixed message to a channel (e.g. “Good morning” to DingTalk at 9am);
   - Ask boostclaw a question and send the answer to a channel (e.g. every 2 hours
     ask “What are my todos?” and post the reply to DingTalk);
   - Run a “check-in” or digest: ask boostclaw a block of questions you wrote and
     send the answer to the channel you last used.

After you install, connect at least one channel, and start the server, you can
chat with boostclaw in DingTalk, Feishu, QQ, etc. and use scheduled messages and check-ins;
what it actually does depends on which Skills you enable.

---

## Terms you’ll see in the docs

- **Channel** — Where you talk to boostclaw (DingTalk, Feishu, QQ, Discord, iMessage, etc.).
  Configure each in [Channels](./channels).
- **Heartbeat** — On a fixed interval, ask boostclaw a block of text you wrote and
  optionally send the answer to the channel you last used. See
  [Heartbeat](./heartbeat).
- **Cron jobs** — Scheduled tasks (send X at 9am, ask Y every 2h, etc.), managed
  via [CLI](./cli) or API.
- **Agent/Workspace** — boostclaw supports multi-agent workspace,
  allowing you to run multiple independent AI agents, each with its own configuration,
  memory, skills, and conversation history. See [Multi-Agent Workspace](./multi-agent).

Each term is explained in detail in its chapter.

---

## Suggested order

1. **[Quick start](./quickstart)** — Get the server running in three commands.
2. **[Console](./console)** — Once the server is running, **before configuring
   channels**, you can use the Console (open the root URL in your browser) to
   chat with boostclaw and configure the agent. This helps you see how boostclaw works.
3. **Configure and use as needed**:
   - [Channels](./channels) — Connect DingTalk / Feishu / QQ / Discord / iMessage to
     chat with boostclaw in those apps;
   - [Heartbeat](./heartbeat) — Set up scheduled check-in or digest (optional);
   - [CLI](./cli) — Init, cron jobs, clean working dir, etc.;
   - [Skills](./skills) — Understand and extend boostclaw’s capabilities;
   - [Config & working dir](./config) — Working directory and config file;
   - [Multi-Agent Workspace](./multi-agent) — Multi-agent setup and management.
