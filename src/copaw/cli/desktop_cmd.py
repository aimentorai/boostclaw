# -*- coding: utf-8 -*-
"""CLI command: run CoPaw app on a free port in a native webview window."""
from __future__ import annotations

import os
import socket
import subprocess
import sys
import threading
import time
import webbrowser
from pathlib import Path

import click

from ..constant import LOG_LEVEL_ENV

try:
    import webview
except ImportError:
    webview = None  # type: ignore[assignment]

# Must match create_window(title=...); used for Win32 icon lookup on Windows.
DESKTOP_WINDOW_TITLE = "BoostClaw"


class WebViewAPI:
    """API exposed to the webview for handling external links."""

    def open_external_link(self, url: str) -> None:
        """Open URL in system's default browser."""
        if not url.startswith(("http://", "https://")):
            return
        webbrowser.open(url)


def _find_free_port(host: str = "127.0.0.1") -> int:
    """Bind to port 0 and return the OS-assigned free port."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind((host, 0))
        sock.listen(1)
        return sock.getsockname()[1]


def _wait_for_http(host: str, port: int, timeout_sec: float = 300.0) -> bool:
    """Return True when something accepts TCP on host:port."""
    deadline = time.monotonic() + timeout_sec
    while time.monotonic() < deadline:
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.settimeout(2.0)
                s.connect((host, port))
                return True
        except (OSError, socket.error):
            time.sleep(1)
    return False


def _log_desktop(msg: str) -> None:
    """Print to stderr and flush (for desktop.log when launched from .app)."""
    print(msg, file=sys.stderr)
    sys.stderr.flush()


def _stream_reader(in_stream, out_stream) -> None:
    """Read from in_stream line by line and write to out_stream.

    Used on Windows to prevent subprocess buffer blocking. Runs in a
    background thread to continuously drain the subprocess output.
    """
    try:
        for line in iter(in_stream.readline, ""):
            if not line:
                break
            out_stream.write(line)
            out_stream.flush()
    except Exception:
        pass
    finally:
        try:
            in_stream.close()
        except Exception:
            pass


def _resolve_windows_desktop_icon_path() -> str | None:
    """Path to .ico next to packaged python.exe (NSIS layout) or from env override."""
    if sys.platform != "win32":
        return None
    env = (os.environ.get("BOOSTCLAW_DESKTOP_ICON") or "").strip()
    if env and os.path.isfile(env):
        return os.path.abspath(env)
    candidate = Path(sys.executable).resolve().parent / "icon.ico"
    if candidate.is_file():
        return str(candidate)
    return None


def _spawn_windows_taskbar_icon_thread(window_title: str, ico_path: str) -> None:
    """Set Win32 window/taskbar icon; pywebview WinForms still uses python.exe by default."""

    def worker() -> None:
        import ctypes
        from ctypes import wintypes

        user32 = ctypes.windll.user32
        WM_SETICON = 0x0080
        ICON_SMALL = 0
        ICON_BIG = 1
        IMAGE_ICON = 1
        LR_LOADFROMFILE = 0x0010
        abs_ico = os.path.abspath(ico_path)
        found: list[bool] = [False]

        @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
        def enum_cb(hwnd: int, _lparam: int) -> bool:
            if not user32.IsWindowVisible(hwnd):
                return True
            buf = ctypes.create_unicode_buffer(512)
            user32.GetWindowTextW(hwnd, buf, 512)
            if buf.value != window_title:
                return True
            h_icon = user32.LoadImageW(
                None,
                abs_ico,
                IMAGE_ICON,
                0,
                0,
                LR_LOADFROMFILE,
            )
            if not h_icon:
                return True
            user32.SendMessageW(hwnd, WM_SETICON, ICON_SMALL, h_icon)
            user32.SendMessageW(hwnd, WM_SETICON, ICON_BIG, h_icon)
            found[0] = True
            return False

        for _ in range(200):
            found[0] = False
            user32.EnumWindows(enum_cb, 0)
            if found[0]:
                _log_desktop("[desktop] Applied Windows window icon from .ico")
                return
            time.sleep(0.05)
        _log_desktop(
            "[desktop] WARN: Could not find webview HWND to set icon "
            f"(title={window_title!r})",
        )

    threading.Thread(target=worker, daemon=True).start()


@click.command("desktop")
@click.option(
    "--host",
    default="127.0.0.1",
    show_default=True,
    help="Bind host for the app server.",
)
@click.option(
    "--log-level",
    default="info",
    type=click.Choice(
        ["critical", "error", "warning", "info", "debug", "trace"],
        case_sensitive=False,
    ),
    show_default=True,
    help="Log level for the app process.",
)
def desktop_cmd(
    host: str,
    log_level: str,
) -> None:
    """Run CoPaw app on an auto-selected free port in a webview window.

    Starts the FastAPI app in a subprocess on a free port, then opens a
    native webview window loading that URL. Use for a dedicated desktop
    window without conflicting with an existing CoPaw app instance.
    """

    port = _find_free_port(host)
    url = f"http://{host}:{port}"
    click.echo(f"Starting CoPaw app on {url} (port {port})")
    _log_desktop("[desktop] Server subprocess starting...")

    env = os.environ.copy()
    env[LOG_LEVEL_ENV] = log_level

    if "SSL_CERT_FILE" in env:
        cert_file = env["SSL_CERT_FILE"]
        if os.path.exists(cert_file):
            _log_desktop(f"[desktop] SSL certificate: {cert_file}")
        else:
            _log_desktop(
                f"[desktop] WARNING: SSL_CERT_FILE set but not found: "
                f"{cert_file}",
            )
    else:
        _log_desktop("[desktop] WARNING: SSL_CERT_FILE not set")

    is_windows = sys.platform == "win32"
    try:
        with subprocess.Popen(
            [
                sys.executable,
                "-m",
                "copaw",
                "app",
                "--host",
                host,
                "--port",
                str(port),
                "--log-level",
                log_level,
            ],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE if is_windows else sys.stdout,
            stderr=subprocess.PIPE if is_windows else sys.stderr,
            env=env,
            bufsize=1,
            universal_newlines=True,
        ) as proc:
            if is_windows:
                stdout_thread = threading.Thread(
                    target=_stream_reader,
                    args=(proc.stdout, sys.stdout),
                    daemon=True,
                )
                stderr_thread = threading.Thread(
                    target=_stream_reader,
                    args=(proc.stderr, sys.stderr),
                    daemon=True,
                )
                stdout_thread.start()
                stderr_thread.start()
            _log_desktop("[desktop] Waiting for HTTP ready...")
            if _wait_for_http(host, port):
                _log_desktop(
                    "[desktop] HTTP ready, creating webview window...",
                )
                api = WebViewAPI()
                webview.create_window(
                    DESKTOP_WINDOW_TITLE,
                    url,
                    width=1280,
                    height=800,
                    text_select=True,
                    js_api=api,
                )
                win_icon = _resolve_windows_desktop_icon_path()
                if win_icon:
                    _spawn_windows_taskbar_icon_thread(
                        DESKTOP_WINDOW_TITLE,
                        win_icon,
                    )
                _log_desktop(
                    "[desktop] Calling webview.start() "
                    "(blocks until closed)...",
                )
                webview.start(
                    private_mode=False,
                )  # blocks until user closes the window
                _log_desktop(
                    "[desktop] webview.start() returned (window closed).",
                )
                proc.terminate()
                proc.wait()
                return  # normal exit after user closed window
            _log_desktop("[desktop] Server did not become ready in time.")
            click.echo(
                "Server did not become ready in time; open manually: " + url,
                err=True,
            )
            try:
                proc.wait()
            except KeyboardInterrupt:
                proc.terminate()
                proc.wait()

        if proc.returncode != 0:
            sys.exit(proc.returncode or 1)
    except Exception as e:
        _log_desktop(f"[desktop] Exception: {e!r}")
        import traceback

        traceback.print_exc(file=sys.stderr)
        sys.stderr.flush()
        raise
