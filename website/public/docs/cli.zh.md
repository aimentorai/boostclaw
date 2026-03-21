# CLI

`copaw` 是 boostclaw 的命令行工具。本页按「上手 → 配置 → 日常管理」的顺序组织——
新用户从头读，老用户直接跳到需要的章节。

> 还不清楚「频道」「心跳」「定时任务」是什么？先看 [项目介绍](./intro)。

---

## 快速上手

第一次用 boostclaw，只需要这两条命令。

### boostclaw init

首次初始化，交互式引导你完成所有配置。

```bash
boostclaw init              # 交互式初始化（推荐新用户）
boostclaw init --defaults   # 不交互，用默认值（适合脚本）
boostclaw init --force      # 覆盖已有配置文件
```

**交互流程（按顺序）：**

1. **心跳** —— 间隔（如 `30m`）、目标（`main` / `last`）、可选活跃时间段。
2. **工具详情** —— 是否在频道消息中显示工具调用细节。
3. **语言** —— Agent 人设文件（SOUL.md 等）使用 `zh` / `en` / `ru`。
4. **频道** —— 可选配置 iMessage / Discord / DingTalk / Feishu / QQ / Console。
5. **LLM 提供商** —— 选择提供商、输入 API Key、选择模型（**必选**）。
6. **技能** —— 全部启用 / 不启用 / 自定义选择。
7. **环境变量** —— 可选添加工具所需的键值对。
8. **HEARTBEAT.md** —— 在默认编辑器中编辑心跳检查清单。

### boostclaw app

启动 boostclaw 服务。频道、定时任务、控制台等所有运行时功能都依赖此服务。

```bash
boostclaw app                             # 默认 127.0.0.1:8088
boostclaw app --host 0.0.0.0 --port 9090 # 自定义地址
boostclaw app --reload                    # 代码改动自动重载（开发用）
boostclaw app --workers 4                 # 多 worker 模式
boostclaw app --log-level debug           # 详细日志
```

| 选项          | 默认值      | 说明                                                          |
| ------------- | ----------- | ------------------------------------------------------------- |
| `--host`      | `127.0.0.1` | 绑定地址                                                      |
| `--port`      | `8088`      | 绑定端口                                                      |
| `--reload`    | 关闭        | 文件变动时自动重载（仅开发用）                                |
| `--workers`   | `1`         | Worker 进程数                                                 |
| `--log-level` | `info`      | `critical` / `error` / `warning` / `info` / `debug` / `trace` |

### 控制台

`boostclaw app` 启动后，在浏览器打开 `http://127.0.0.1:8088/` 即可进入 **控制台** ——
一个用于对话、频道、定时任务、技能、模型等的 Web 管理界面。详见 [控制台](./console)。

若未构建前端，根路径会返回类似 `{"message": "boostclaw Web Console is not available."}` 的提示信息（实际文案可能调整），API 仍可正常使用。

### boostclaw daemon

查看运行状态、版本、最近日志等，无需启动对话。与在对话中发送 `/daemon status` 等效果一致（CLI 无进程时可查看本地信息）。

| 命令                         | 说明                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------ |
| `boostclaw daemon status`        | 状态（配置、工作目录、记忆服务）                                               |
| `boostclaw daemon restart`       | 打印说明（在对话中用 /daemon restart 可进程内重载）                            |
| `boostclaw daemon reload-config` | 重新读取并校验配置（频道/MCP 变更需在对话中 /daemon restart 或重启进程后生效） |
| `boostclaw daemon version`       | 版本与路径                                                                     |
| `boostclaw daemon logs [-n N]`   | 最近 N 行日志（默认 100，来自工作目录 `boostclaw.log`）                            |

**多智能体支持：** 所有命令都支持 `--agent-id` 参数（默认为 `default`）。

```bash
boostclaw daemon status                     # 默认智能体状态
boostclaw daemon status --agent-id abc123   # 特定智能体状态
boostclaw daemon version
boostclaw daemon logs -n 50
```

---

## 模型与环境变量

使用 boostclaw 前至少需要配置一个 LLM 提供商。环境变量为内置工具（如网页搜索）提供凭据。

### boostclaw models

管理 LLM 提供商和活跃模型。

| 命令                                   | 说明                                   |
| -------------------------------------- | -------------------------------------- |
| `boostclaw models list`                    | 查看所有提供商、API Key 状态和当前模型 |
| `boostclaw models config`                  | 完整交互式配置：API Key → 选择模型     |
| `boostclaw models config-key [provider]`   | 单独配置某个提供商的 API Key           |
| `boostclaw models set-llm`                 | 只切换活跃模型（不改 API Key）         |

```bash
boostclaw models list                    # 看当前状态
boostclaw models config                  # 完整交互式配置
boostclaw models config-key modelscope   # 只配 ModelScope 的 API Key
boostclaw models config-key dashscope    # 只配 DashScope 的 API Key
boostclaw models config-key custom       # 配置自定义提供商（Base URL + Key）
boostclaw models set-llm                 # 只切换模型
```

### boostclaw env

管理工具和技能在运行时使用的环境变量。

| 命令                      | 说明                 |
| ------------------------- | -------------------- |
| `boostclaw env list`          | 列出所有已配置的变量 |
| `boostclaw env set KEY VALUE` | 设置或更新变量       |
| `boostclaw env delete KEY`    | 删除变量             |

```bash
boostclaw env list
boostclaw env set TAVILY_API_KEY "tvly-xxxxxxxx"
boostclaw env set GITHUB_TOKEN "ghp_xxxxxxxx"
boostclaw env delete TAVILY_API_KEY
```

> **注意：** boostclaw 只负责存储和加载，值的有效性需要用户自行保证。
> 详见 [配置 — 环境变量](./config#环境变量)。

---

## 频道

将 boostclaw 连接到消息平台。

### boostclaw channels

管理频道配置（iMessage / Discord / DingTalk / Feishu / QQ / Console 等）。
**说明**：交互式配置用 `config`（无 `configure` 子命令）；卸载自定义频道用 `remove`（无 `uninstall`）。

| 命令                           | 说明                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------- |
| `boostclaw channels list`          | 查看所有频道的状态（密钥脱敏）                                                  |
| `boostclaw channels install <key>` | 在 `custom_channels/` 安装频道：创建模板，或用 `--path` / `--url` 安装          |
| `boostclaw channels add <key>`     | 安装并加入 config；内置频道只写 config；支持 `--path` / `--url`                 |
| `boostclaw channels remove <key>`  | 从 `custom_channels/` 删除自定义频道（内置不可删）；`--keep-config` 保留 config |
| `boostclaw channels config`        | 交互式启用/禁用频道并填写凭据                                                   |

**多智能体支持：** 所有命令都支持 `--agent-id` 参数（默认为 `default`）。

```bash
boostclaw channels list                    # 看默认智能体的频道状态
boostclaw channels list --agent-id abc123  # 看特定智能体的频道状态
boostclaw channels install my_channel      # 创建自定义频道模板
boostclaw channels install my_channel --path ./my_channel.py
boostclaw channels add dingtalk            # 把钉钉加入 config
boostclaw channels remove my_channel       # 删除自定义频道（并默认从 config 移除）
boostclaw channels remove my_channel --keep-config   # 只删模块，保留 config 条目
boostclaw channels config                  # 交互式配置默认智能体
boostclaw channels config --agent-id abc123 # 交互式配置特定智能体
```

交互式 `config` 流程：依次选择频道、启用/禁用、填写凭据，循环直到选择「保存退出」。

| 频道         | 需要填写的字段                           |
| ------------ | ---------------------------------------- |
| **iMessage** | Bot 前缀、数据库路径、轮询间隔           |
| **Discord**  | Bot 前缀、Bot Token、HTTP 代理、代理认证 |
| **DingTalk** | Bot 前缀、Client ID、Client Secret       |
| **Feishu**   | Bot 前缀、App ID、App Secret             |
| **QQ**       | Bot 前缀、App ID、Client Secret          |
| **Console**  | Bot 前缀                                 |

> 各平台凭据的获取步骤，请看 [频道配置](./channels)。

---

## 定时任务

让 boostclaw 按时间自动执行任务——「每天 9 点发消息」「每 2 小时提问并转发回复」。
**需要 `boostclaw app` 正在运行。**

### boostclaw cron

| 命令                         | 说明                           |
| ---------------------------- | ------------------------------ |
| `boostclaw cron list`            | 列出所有任务                   |
| `boostclaw cron get <job_id>`    | 查看任务配置                   |
| `boostclaw cron state <job_id>`  | 查看运行状态（下次运行时间等） |
| `boostclaw cron create ...`      | 创建任务                       |
| `boostclaw cron delete <job_id>` | 删除任务                       |
| `boostclaw cron pause <job_id>`  | 暂停任务                       |
| `boostclaw cron resume <job_id>` | 恢复暂停的任务                 |
| `boostclaw cron run <job_id>`    | 立刻执行一次                   |

**多智能体支持：** 所有命令都支持 `--agent-id` 参数（默认为 `default`）。

### 创建任务

**方式一——命令行参数（适合简单任务）**

任务分两种类型：

- **text** —— 到点向频道发一段固定文案。
- **agent** —— 到点向 boostclaw 提问，把回复发到频道。

```bash
# text：每天 9 点发「早上好！」到钉钉（默认智能体）
boostclaw cron create \
  --type text \
  --name "每日早安" \
  --cron "0 9 * * *" \
  --channel dingtalk \
  --target-user "你的用户ID" \
  --target-session "会话ID" \
  --text "早上好！"

# agent：为特定智能体创建任务
boostclaw cron create \
  --agent-id abc123 \
  --type agent \
  --name "检查待办" \
  --cron "0 */2 * * *" \
  --channel dingtalk \
  --target-user "你的用户ID" \
  --target-session "会话ID" \
  --text "我有什么待办事项？"
```

必填：`--type`、`--name`、`--cron`、`--channel`、`--target-user`、
`--target-session`、`--text`。

**方式二——JSON 文件（适合复杂或批量）**

```bash
boostclaw cron create -f job_spec.json
```

JSON 结构见 `boostclaw cron get <job_id>` 的返回。

### 额外选项

| 选项                         | 默认值   | 说明                                                  |
| ---------------------------- | -------- | ----------------------------------------------------- |
| `--timezone`                 | 用户时区 | Cron 调度时区（默认使用 config 中的 `user_timezone`） |
| `--enabled` / `--no-enabled` | 启用     | 创建时启用或禁用                                      |
| `--mode`                     | `final`  | `stream`（逐步发送）或 `final`（完成后一次性发送）    |
| `--base-url`                 | 自动     | 覆盖 API 地址                                         |

### Cron 表达式速查

五段式：**分 时 日 月 周**（无秒）。

| 表达式         | 含义          |
| -------------- | ------------- |
| `0 9 * * *`    | 每天 9:00     |
| `0 */2 * * *`  | 每 2 小时整点 |
| `30 8 * * 1-5` | 工作日 8:30   |
| `0 0 * * 0`    | 每周日 0:00   |
| `*/15 * * * *` | 每 15 分钟    |

---

## 会话管理

通过 API 管理聊天会话。**需要 `boostclaw app` 正在运行。**

### boostclaw chats

| 命令                                   | 说明                                               |
| -------------------------------------- | -------------------------------------------------- |
| `boostclaw chats list`                     | 列出所有会话（支持 `--user-id`、`--channel` 筛选） |
| `boostclaw chats get <id>`                 | 查看会话详情和消息历史                             |
| `boostclaw chats create ...`               | 创建新会话                                         |
| `boostclaw chats update <id> --name "..."` | 重命名会话                                         |
| `boostclaw chats delete <id>`              | 删除会话                                           |

**多智能体支持：** 所有命令都支持 `--agent-id` 参数（默认为 `default`）。

```bash
boostclaw chats list                        # 默认智能体的会话
boostclaw chats list --agent-id abc123      # 特定智能体的会话
boostclaw chats list --user-id alice --channel dingtalk
boostclaw chats get 823845fe-dd13-43c2-ab8b-d05870602fd8
boostclaw chats create --session-id "discord:alice" --user-id alice --name "My Chat"
boostclaw chats create --agent-id abc123 -f chat.json
boostclaw chats update <chat_id> --name "新名称"
boostclaw chats delete <chat_id>
```

---

## 技能

扩展 boostclaw 的能力（PDF 阅读、网页搜索等）。

### boostclaw skills

| 命令                  | 说明                              |
| --------------------- | --------------------------------- |
| `boostclaw skills list`   | 列出所有技能及启用/禁用状态       |
| `boostclaw skills config` | 交互式启用/禁用技能（复选框界面） |

**多智能体支持：** 所有命令都支持 `--agent-id` 参数（默认为 `default`）。

```bash
boostclaw skills list                   # 看默认智能体的技能
boostclaw skills list --agent-id abc123 # 看特定智能体的技能
boostclaw skills config                 # 交互式配置默认智能体
boostclaw skills config --agent-id abc123 # 交互式配置特定智能体
```

交互界面中：↑/↓ 选择、空格 切换、回车 确认。确认前会预览变更。

> 内置技能说明和自定义技能编写方法，请看 [技能](./skills)。

---

## 维护

### boostclaw clean

清空工作目录（默认 `~/.boostclaw`）下的所有内容。

```bash
boostclaw clean             # 交互确认
boostclaw clean --yes       # 不确认直接清空
boostclaw clean --dry-run   # 只列出会被删的内容，不删
```

---

## 全局选项

所有子命令都继承以下选项：

| 选项            | 默认值      | 说明                                      |
| --------------- | ----------- | ----------------------------------------- |
| `--host`        | `127.0.0.1` | API 地址（自动检测上次 `boostclaw app` 的值） |
| `--port`        | `8088`      | API 端口（自动检测上次 `boostclaw app` 的值） |
| `-h` / `--help` |             | 显示帮助                                  |

如果服务运行在非默认地址，全局传入即可：

```bash
boostclaw --host 0.0.0.0 --port 9090 cron list
```

## 工作目录

配置和数据都在 `~/.boostclaw`（默认）：

- **全局配置**: `config.json`（提供商、环境变量、智能体列表）
- **智能体工作区**: `workspaces/{agent_id}/`（每个智能体独立的配置和数据）

```
~/.boostclaw/
├── config.json              # 全局配置
└── workspaces/
    ├── default/             # 默认智能体工作区
    │   ├── agent.json       # 智能体配置
    │   ├── chats.json       # 对话历史
    │   ├── jobs.json        # 定时任务
    │   ├── AGENTS.md        # 人设文件
    │   └── memory/          # 记忆文件
    └── abc123/              # 其他智能体工作区
        └── ...
```

| 变量                    | 说明             |
| ----------------------- | ---------------- |
| `BOOSTCLAW_WORKING_DIR` | 覆盖工作目录路径 |
| `BOOSTCLAW_CONFIG_FILE` | 覆盖配置文件路径 |

详见 [配置与工作目录](./config) 和 [多智能体工作区](./multi-agent)。

---

## 命令总览

| 命令             | 子命令                                                                                                                                 |  需要服务运行？   |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------- | :---------------: |
| `boostclaw init`     | —                                                                                                                                      |        否         |
| `boostclaw app`      | —                                                                                                                                      | —（启动服务本身） |
| `boostclaw models`   | `list` · `config` · `config-key` · `set-llm` · `download` · `local` · `remove-local` · `ollama-pull` · `ollama-list` · `ollama-remove` |        否         |
| `boostclaw env`      | `list` · `set` · `delete`                                                                                                              |        否         |
| `boostclaw channels` | `list` · `install` · `add` · `remove` · `config`                                                                                       |        否         |
| `boostclaw cron`     | `list` · `get` · `state` · `create` · `delete` · `pause` · `resume` · `run`                                                            |      **是**       |
| `boostclaw chats`    | `list` · `get` · `create` · `update` · `delete`                                                                                        |      **是**       |
| `boostclaw skills`   | `list` · `config`                                                                                                                      |        否         |
| `boostclaw clean`    | —                                                                                                                                      |        否         |

---

## 相关页面

- [项目介绍](./intro) —— boostclaw 可以做什么
- [控制台](./console) —— Web 管理界面
- [频道配置](./channels) —— 钉钉、飞书、iMessage、Discord、QQ 详细步骤
- [心跳](./heartbeat) —— 定时自检/摘要
- [技能](./skills) —— 内置技能与自定义技能
- [配置与工作目录](./config) —— 工作目录与 config.json
- [多智能体工作区](./multi-agent) —— 多智能体配置与管理
