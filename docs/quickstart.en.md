# Quick start

---

This section describes three ways to run boostclaw:

- **Option A — Script install**: run on your machine with no Python setup required.
- **Option B — pip install**: if you prefer managing Python yourself.
- **Option C — Desktop Application (Beta)**: download and run desktop app with no command-line required, suitable for users unfamiliar with terminals. See [Desktop Application Guide](./desktop).

> 📖 Read [Introduction](./intro) first; after install see [Console](./console).

> 💡 **After install & start**: Before configuring channels, you can open the [Console](./console) (`http://127.0.0.1:8088/`) to chat with boostclaw and configure the agent. When you're ready to chat in DingTalk, Feishu, QQ, etc., head to [Channels](./channels) to add a channel.

## Option A: Script install

No Python required — the installer handles everything automatically using [uv](https://docs.astral.sh/uv/).

### Step 1: Install

**macOS / Linux:**

```bash
curl -fsSL https://boostclaw.com/install.sh | bash
```

Then open a new terminal (or `source ~/.zshrc` / `source ~/.bashrc`).

**Windows (CMD):**

```cmd
curl -fsSL https://boostclaw.com/install.bat -o install.bat && install.bat
```

**Windows (PowerShell):**

```powershell
irm https://boostclaw.com/install.ps1 | iex
```

Then open a new terminal (the installer adds boostclaw to your PATH automatically).

> **⚠️ Special Notice for Windows Enterprise LTSC Users**
>
> If you are using Windows LTSC or an enterprise environment governed by strict security policies, PowerShell may run in **Constrained Language Mode**, potentially causing the following issue:
>
> 1. **If using CMD (.bat): Script executes successfully but fails to write to `Path`**
>
>    The script completes file installation. Due to **Constrained Language Mode**, it cannot automatically update environment variables. Manually configure as follows:
>
>    - **Locate the installation directory**:
>      - Check if `uv` is available: Enter `uv --version` in CMD. If a version number appears, **only configure the boostclaw path**. If you receive the prompt `'uv' is not recognized as an internal or external command, operable program or batch file,` configure both paths.
>      - uv path (choose one based on installation location; use if step 1 fails): Typically `%USERPROFILE%\.local\bin`, `%USERPROFILE%\AppData\Local\uv`, or the `Scripts` folder within your Python installation directory
>      - boostclaw path: Typically located at `%USERPROFILE%\.boostclaw\bin`.
>    - **Manually add to the system's Path environment variable**:
>      - Press `Win + R`, type `sysdm.cpl` and press Enter to open System Properties.
>      - Click “Advanced” -> “Environment Variables”.
>      - Under “System variables”, locate and select `Path`, then click “Edit”.
>      - Click “New”, enter both directory paths sequentially, then click OK to save.
>
> 2. **If using PowerShell (.ps1): Script execution interrupted**
>
> Due to **Constrained Language Mode**, the script may fail to automatically download `uv`.
>
> - **Manually install uv**: Refer to the [GitHub Release](https://github.com/astral-sh/uv/releases) to download `uv.exe` and place it in `%USERPROFILE%\.local\bin` or `%USERPROFILE%\AppData\Local\uv`; or ensure Python is installed and run `python -m pip install -U uv`.
> - **Configure `uv` environment variables**: Add the `uv` directory and `%USERPROFILE%\.boostclaw\bin` to your system's `Path` variable.
> - **Re-run the installation**: Open a new terminal and execute the installation script again to complete the `boostclaw` installation.
> - **Configure the `boostclaw` environment variable**: Add `%USERPROFILE%\.boostclaw\bin` to your system's `Path` variable.

You can also pass options:

**macOS / Linux:**

```bash
# Install a specific version
curl -fsSL ... | bash -s -- --version 0.0.1

```

**Windows (PowerShell):**

```powershell
# Install a specific version
.\install.ps1 -Version 0.0.1
```

To upgrade, simply re-run the install command. To uninstall, run `boostclaw uninstall`.

### Step 2: Init

Generate `config.json` and `HEARTBEAT.md` in the working directory (default
`~/.boostclaw`). Two options:

- **Use defaults** (no prompts; good for getting running first, then editing
  config later):
  ```bash
  boostclaw init --defaults
  ```
- **Interactive** (prompts for heartbeat interval, target, active hours, and
  optional channel and Skills setup):
  ```bash
  boostclaw init
  ```
  See [CLI - Getting started](./cli#getting-started).

To overwrite existing config, use `boostclaw init --force` (you will be prompted).
After init, if no channel is enabled yet, follow [Channels](./channels) to add
DingTalk, Feishu, QQ, etc.

### Step 3: Start the server

```bash
boostclaw app
```

The server listens on `127.0.0.1:8088` by default. If you have already
configured a channel, boostclaw will reply there; otherwise you can add one after
this step via [Channels](./channels).

## Option B: pip install

If you prefer managing Python yourself (requires Python >= 3.12, < 3.14):

```bash
pip install boostclaw
```

Optional: create and activate a virtualenv first (`python -m venv .venv`, then
`source .venv/bin/activate` on Linux/macOS or `.venv\Scripts\Activate.ps1` on Windows). This installs the `boostclaw` command.

Then follow [Step 2: Init](#step-2-init) and [Step 3: Start the server](#step-3-start-the-server) above.

## Option C: Desktop Application (Beta)

If you're not comfortable with command-line tools, you can download and use boostclaw's desktop application without manually configuring Python environments or running commands.

### Features

- ✅ **Zero configuration**: Download and double-click to run, no need to install Python or configure environment variables
- ✅ **Cross-platform**: Supports Windows 11+ and macOS 14+ (Apple Silicon recommended)
- ✅ **Visual interface**: Automatically opens browser interface, no need to manually enter addresses
- ⚠️ **Beta stage**: Features are continuously being improved, feedback welcome

### Download and Usage

1. **Download the installer**
   Go to [GitHub Releases](https://github.com/aimentorai/boostclaw/releases) to download the version for your system:

   - Windows: `boostclaw-setup-<version>.exe`
   - macOS: `boostclaw-<version>-macOS.zip`

2. **Install and Launch**

   - **Windows**: Double-click the `.exe` file to install following the wizard, then double-click the desktop shortcut to launch
   - **macOS**: Extract the `.zip` to get `boostclaw.app`, first time requires right-click and select "Open" to bypass system security restrictions

3. **First Launch Note**
   The first launch may take 10-60 seconds (depending on your system configuration), as the application needs to initialize the Python environment and load dependencies. Please wait patiently for the browser window to open automatically.

### Complete Guide

Desktop applications involve system permissions, security prompts, debug mode, and other details. Please see the **[Complete Desktop Application Guide](./desktop)** to learn about:

- Windows two launch modes (Normal vs Debug)
- macOS how to bypass system security restrictions (3 methods)
- Common issues and solutions
- Log viewing and issue reporting

## Verify install (optional)

After the server is running, you can call the Agent API to confirm the setup.
Endpoint: **POST** `/api/agent/process`, JSON body, SSE streaming. Single-turn example:

```bash
curl -N -X POST "http://localhost:8088/api/agent/process" \
  -H "Content-Type: application/json" \
  -d '{"input":[{"role":"user","content":[{"type":"text","text":"Hello"}]}],"session_id":"session123"}'
```

Use the same `session_id` for multi-turn.

## What to do next

- **Chat with boostclaw** — [Channels](./channels): connect one channel
  (DingTalk or Feishu is a good first), create the app, fill config, then send a message
  in that app.
- **Run a scheduled "check-in" or digest** — [Heartbeat](./heartbeat): edit
  HEARTBEAT.md and set interval and target in config.
- **More commands** — [CLI](./cli) (interactive init, cron jobs, clean),
  [Skills](./skills).
- **Change working dir or config path** — [Config & working dir](./config).
