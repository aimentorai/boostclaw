# 快速开始

---

本节介绍三种方式运行 boostclaw：

- **方式一 - 脚本安装**：无需手动配置 Python，一行命令自动完成安装。
- **方式二 — pip 安装**：适合自行管理 Python 环境的用户。
- **方式三 — 桌面应用（Beta）**：下载即用的桌面应用，无需命令行操作，适合不熟悉终端的用户。详见 [桌面应用指南](./desktop)。

> 📖 阅读前请先了解 [项目介绍](./intro)，完成安装与启动后可查看 [控制台](./console)。

> 💡 **安装并启动后**：在配置频道之前，可先打开 [控制台](./console)（浏览器访问 `http://127.0.0.1:8088/`）与 boostclaw 对话、配置 Agent；要在钉钉、飞书、QQ 等 app 里对话时，再前往 [频道配置](./channels) 接入频道。

## 方式一：脚本安装

无需预装 Python — 安装脚本通过 [uv](https://docs.astral.sh/uv/) 自动管理一切。

### 步骤一：安装

**macOS / Linux：**

```bash
curl -fsSL https://boostclaw.com/install.sh | bash
```

然后打开新终端（或执行 `source ~/.zshrc` / `source ~/.bashrc`）。

**Windows (CMD):**

```cmd
curl -fsSL https://boostclaw.com/install.bat -o install.bat && install.bat
```

**Windows（PowerShell）：**

```powershell
irm https://boostclaw.com/install.ps1 | iex
```

然后打开新终端（安装脚本会自动将 boostclaw 加入 PATH）。

> **⚠️ Windows 企业版 LTSC 用户特别提示**
>
> 如果您使用的是 Windows LTSC 或受严格安全策略管控的企业环境，PowerShell 可能运行在 **受限语言模式** 下，可能会遇到以下问题：
>
> 1. **如果你使用的是 CMD（.bat）：脚本执行成功但无法写入`Path`**
>
>    脚本已完成文件安装，由于 **受限语言模式** ，脚本无法自动写入环境变量，此时只需手动配置：
>
>    - **找到安装目录**：
>      - 检查 `uv` 是否可用：在 CMD 中输入 `uv --version` ，如果显示版本号，则**只需配置 boostclaw 路径**；如果提示 `'uv' 不是内部或外部命令，也不是可运行的程序或批处理文件。`，则需同时配置两者。
>      - uv路径（任选其一，取决于安装位置，若`uv`不可用则填）：通常在`%USERPROFILE%\.local\bin`、`%USERPROFILE%\AppData\Local\uv`或 Python 安装目录下的 `Scripts` 文件夹
>      - boostclaw路径：通常在 `%USERPROFILE%\.boostclaw\bin` 。
>    - **手动添加到系统的 Path 环境变量**：
>      - 按 `Win + R`，输入 `sysdm.cpl` 并回车，打开“系统属性”。
>      - 点击 “高级” -> “环境变量”。
>      - 在 “系统变量” 中找到并选中 `Path`，点击 “编辑”。
>      - 点击 “新建”，依次填入上述两个目录路径，点击确定保存。
>
> 2. **如果你使用的是 PowerShell（.ps1）：脚本运行中断**
>
> 由于 **受限语言模式** ，脚本可能无法自动下载`uv`。
>
> - **手动安装uv**：参考 [GitHub Release](https://github.com/astral-sh/uv/releases)下载并将`uv.exe`放至`%USERPROFILE%\.local\bin`或`%USERPROFILE%\AppData\Local\uv`；或者确保已安装 Python ，然后运行`python -m pip install -U uv`
> - **配置`uv`环境变量**：将`uv`所在目录和 `%USERPROFILE%\.boostclaw\bin` 添加到系统的 `Path` 变量中。
> - **重新运行**：打开新终端，再次执行安装脚本以完成 `boostclaw` 安装。
> - **配置`boostclaw`环境变量**：将 `%USERPROFILE%\.boostclaw\bin` 添加到系统的 `Path` 变量中。

也可以指定选项：

**macOS / Linux：**

```bash
# 安装指定版本
curl -fsSL ... | bash -s -- --version 0.0.1

```

**Windows（PowerShell）：**

```powershell
# 安装指定版本
.\install.ps1 -Version 0.0.1
```

升级只需重新运行安装命令。卸载请运行 `boostclaw uninstall`。


### 步骤二：初始化

在工作目录（默认 `~/.boostclaw`）下生成 `config.json` 与 `HEARTBEAT.md`。两种方式：

- **快速用默认配置**（不交互，适合先跑起来再改配置）：
  ```bash
  boostclaw init --defaults
  ```
- **交互式初始化**（按提示填写心跳间隔、投递目标、活跃时段，并可顺带配置频道与 Skills）：
  ```bash
  boostclaw init
  ```
  详见 [CLI - 快速上手](./cli#快速上手)。

若已有配置想覆盖，可使用 `boostclaw init --force`（会提示确认）。
初始化后若尚未启用频道，接入钉钉、飞书、QQ 等需在 [频道配置](./channels) 中按文档填写。

### 步骤三：启动服务

```bash
boostclaw app
```

服务默认监听 `127.0.0.1:8088`。若已配置频道，boostclaw 会在对应 app 内回复；若尚未配置，也可先完成本节再前往频道配置。


## 方式二：pip 安装

如果你更习惯自行管理 Python 环境（需 Python >= 3.12, < 3.14）：

```bash
pip install boostclaw
```

可选：先创建并激活虚拟环境再安装（`python -m venv .venv`，Linux/macOS 下
`source .venv/bin/activate`，Windows 下 `.venv\Scripts\Activate.ps1`）。安装后会提供 `boostclaw` 命令。

然后按上方 [步骤二：初始化](#步骤二初始化) 和 [步骤三：启动服务](#步骤三启动服务) 操作。

## 方式三：桌面应用（Beta）

如果你不习惯使用命令行，可以下载并使用 boostclaw 的桌面应用版本，无需手动配置 Python 环境或执行命令。

### 特点

- ✅ **零配置**：下载后双击即可运行，无需安装 Python 或配置环境变量
- ✅ **跨平台**：支持 Windows 11+ 和 macOS 14+ (推荐 Apple Silicon)
- ✅ **可视化**：自动打开浏览器界面，无需手动输入地址
- ⚠️ **Beta 阶段**：功能持续完善中，欢迎反馈问题

### 下载与使用

1. **下载安装包**
   前往 [GitHub Releases](https://github.com/aimentorai/boostclaw/releases) 下载对应系统的版本：

   - Windows: `boostclaw-setup-<version>.exe`
   - macOS: `boostclaw-<version>-macOS.zip`

2. **安装并启动**

   - **Windows**: 双击 `.exe` 文件按向导安装，完成后双击桌面快捷方式启动
   - **macOS**: 解压 `.zip` 得到 `boostclaw.app`，首次需右键选择"打开"以绕过系统安全限制

3. **首次启动提示**
   首次启动可能需要 10-60 秒（取决于系统配置），应用需要初始化 Python 环境和加载依赖，请耐心等待浏览器窗口自动打开。

### 完整使用指南

桌面应用涉及系统权限、安全提示、调试模式等细节，请查看 **[桌面应用完整指南](./desktop)** 了解：

- Windows 两种启动模式（普通版 vs Debug 版）
- macOS 如何解除系统安全限制（3种方法）
- 常见问题与解决方案
- 日志查看与问题报告

## 验证安装（可选）

服务启动后,可通过 HTTP 调用 Agent 接口以确认环境正常。接口为 **POST** `/api/agent/process`,请求体为 JSON,支持 SSE 流式响应。单轮请求示例:

```bash
curl -N -X POST "http://localhost:8088/api/agent/process" \
  -H "Content-Type: application/json" \
  -d '{"input":[{"role":"user","content":[{"type":"text","text":"你好"}]}],"session_id":"session123"}'
```

同一 `session_id` 可进行多轮对话。

---

## 接下来做什么？

- **想和 boostclaw 对话** → 去 [频道配置](./channels) 接一个频道（推荐先接钉钉或飞书），按文档申请应用、填 config，保存后即可在对应 app 里发消息试。
- **想定时自动跑一套「自检/摘要」** → 看 [心跳](./heartbeat)，编辑 HEARTBEAT.md 并在 config 里设间隔和 target。
- **想用更多命令** → [CLI](./cli)（交互式 init、定时任务、清空工作目录）、[Skills](./skills)。
- **想改工作目录或配置文件路径** → [配置与工作目录](./config)。
