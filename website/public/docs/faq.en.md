# FAQ

This page collects the most frequently asked questions from the community.
Click a question to expand the answer.

---

### How to install boostclaw

boostclaw supports three installation methods. See
[Quick Start](https://boostclaw.com/docs/quickstart) for details:

1. Script install (no Python required)

```bash
# macOS / Linux:
curl -fsSL https://boostclaw.com/install.sh | bash
# Windows (CMD):
curl -fsSL https://boostclaw.com/install.bat -o install.bat && install.bat
# Windows (PowerShell):
irm https://boostclaw.com/install.ps1 | iex
```

2. Install with pip (requires Python >= 3.10, < 3.14)

```bash
pip install boostclaw
```

3. Desktop Application (Beta): no command-line needed, download and run. See [Desktop Application Guide](https://boostclaw.com/docs/desktop).

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

### How to update boostclaw

To update boostclaw, use the method matching your installation type:

1. If installed via one-line script, re-run the installer to upgrade.

2. If installed via pip, run:

```bash
pip install --upgrade boostclaw
```

3. If you use the Desktop Application, download the latest installer/archive from [Releases](https://github.com/aimentorai/boostclaw/releases) and install it over your existing copy.

If you use the CLI/server install, restart the service with `boostclaw app` after upgrading.

### How to initialize and start boostclaw service

Recommended quick initialization:

```bash
boostclaw init --defaults
```

Start service:

```bash
boostclaw app
```

The default Console URL is `http://127.0.0.1:8088/`. After quick init, you can
open Console and customize settings. See
[Quick Start](https://boostclaw.com/docs/quickstart).

### Open-source repository

boostclaw is open source. Official repository:
`https://github.com/aimentorai/boostclaw`

### Where to check latest version upgrade details

You can check version changes in boostclaw GitHub
[Releases](https://github.com/aimentorai/boostclaw/releases).

### How to configure models

In Console, go to **Settings -> Models** to configure. See the
[Models](https://boostclaw.com/docs/models) doc for details:

- Cloud models: fill provider API key (e.g. ModelScope, DashScope, or custom),
  then select the active model.

You can also use `boostclaw models` CLI commands for configuration, download, and
switching. See
[CLI -> Models and environment variables -> boostclaw models](https://boostclaw.com/docs/cli#boostclaw-models).


### Troubleshooting scheduled (cron) tasks

In Console, go to **Control -> Cron Jobs** to create and manage scheduled tasks.

![cron](https://img.alicdn.com/imgextra/i2/O1CN01sL8ZYj1QJtpXs9iKE_!!6000000001956-2-tps-3814-1954.png)

The easiest way to create a cron job is to talk to boostclaw in the channel where you want the results. For example, say: “Create a scheduled task that reminds me to drink water every five minutes.” You can then see the enabled job in Console.

If a scheduled task does not run as expected, try the following:

1. Confirm that the boostclaw service is running.

2. Check that the task **Status** is **Enabled**.

   ![enable](https://img.alicdn.com/imgextra/i4/O1CN01oggNyG1yQwrWKCnN7_!!6000000006574-2-tps-3020-762.png)

3. Check that **Dispatch Channel** is set to the channel where you want the result (e.g. console, dingtalk, feishu, discord, imessage).

   ![channel](https://img.alicdn.com/imgextra/i1/O1CN01RnjX7z1MHpZvVpjJq_!!6000000001410-2-tps-3020-762.png)

4. Check that **Dispatch Target User ID** and **Dispatch Target Session ID** are correct.

   ![id](https://img.alicdn.com/imgextra/i4/O1CN01QgvEDv290o1p3oaTv_!!6000000008006-2-tps-3020-762.png)

   In Console, go to **Control -> Sessions** and find the session you used when creating the task. To have the task reply in that session, the **User ID** and **Session ID** there must match the task’s **Dispatch Target User ID** and **Dispatch Target Session ID**.

   ![id](https://img.alicdn.com/imgextra/i3/O1CN01aqsLLR1eRb6m6WaGl_!!6000000003868-2-tps-3020-928.png)

5. If the task runs at the wrong time, check the **Schedule (Cron)** for the task.

   ![cron](https://img.alicdn.com/imgextra/i2/O1CN01iNoLp229bRiIdvJKK_!!6000000008086-2-tps-3020-778.png)

6. To verify that the task was created and can run, click **Execute Now**. If it works, you should see the reply in the target channel. You can also ask boostclaw: “Trigger the ‘drink water reminder’ task I just created.”

   ![exec](https://img.alicdn.com/imgextra/i3/O1CN01nGtc3p1o5kN0d01mf_!!6000000005174-2-tps-3020-778.png)

### How to manage Skills

Go to **Agent -> Skills** in Console. You can enable/disable Skills, create
custom Skills, and import Skills from Skills Hub. See
[Skills](https://boostclaw.com/docs/skills).

### How to configure MCP

Go to **Agent -> MCP** in Console. You can enable/disable/delete/create MCP
clients there. See [MCP](https://boostclaw.com/docs/mcp).

### Common error

1. Error pattern: `You didn't provide an API key`

Error detail:

```
Error: Unknown agent error: AuthenticationError: Error code: 401 - {'error': {'message': "You didn't provide an API key. You need to provide your API key in an Authorization header using Bearer auth (i.e. Authorization: Bearer YOUR_KEY). ", 'type': 'invalid_request_error', 'param': None, 'code': None}, 'request_id': 'xxx'}
```

Cause 1: model API key is not configured. Get an API key and configure it in
**Console -> Settings -> Models**.

Cause 2: key is configured but still fails. In most cases, one of the
configuration fields is incorrect (for example `base_url`, `api key`, or model
name).

boostclaw supports API keys obtained via DashScope Coding Plan. If it still fails,
please check:

- whether `base_url` is correct;
- whether the API key is copied completely (no extra spaces);
- whether the model name exactly matches the provider value (case-sensitive).

Reference for the correct key acquisition flow:
https://help.aliyun.com/zh/model-studio/coding-plan-quickstart#2531c37fd64f9

---

### How to get support when errors occur

To speed up troubleshooting and fixes, please open an
[issue](https://github.com/aimentorai/boostclaw/issues) in the boostclaw GitHub
repository and attach the full error message and any error detail file.

Console errors often include a path to an error detail file. For example:

Error: Unknown agent error: AuthenticationError: Error code: 401 - {'error': {'message': "You didn't provide an API key. You need to provide your API key in an Authorization header using Bearer auth (i.e. Authorization: Bearer YOUR_KEY). ", 'type': 'invalid_request_error', 'param': None, 'code': None}, 'request_id': 'xxx'}(Details: /var/folders/.../copaw_query_error_qzbx1mv1.json)

Please upload that file (e.g. `/var/folders/.../copaw_query_error_qzbx1mv1.json`)
and also provide your current model provider, model name, and boostclaw version.
