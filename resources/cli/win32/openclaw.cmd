@echo off
setlocal

if /i "%1"=="update" (
    echo openclaw is managed by ClawX ^(bundled version^).
    echo.
    echo To update openclaw, update ClawX:
    echo   Open ClawX ^> Settings ^> Check for Updates
    echo   Or download the latest version from https://claw-x.com
    exit /b 0
)

rem Switch console to UTF-8 so Unicode box-drawing and CJK text render correctly
rem on non-English Windows (e.g. Chinese CP936). Save the previous codepage to restore later.
for /f "tokens=2 delims=:." %%a in ('chcp') do set /a "_CP=%%a" 2>nul
chcp 65001 >nul 2>&1

rem For the TUI, pre-enable Virtual Terminal Processing on the console output
rem handle. This ensures ANSI escape sequences render correctly on the legacy
rem Windows console (conhost.exe). Windows Terminal (WT_SESSION set) already
rem supports VT natively, so this step is skipped there. The pi-tui library
rem also sets this via koffi from inside the process as a secondary safety net.
if /i "%1"=="tui" if not defined WT_SESSION (
    >nul 2>&1 powershell -NoProfile -NoLogo -NonInteractive -Command ^
      "Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class WinCon{[DllImport(\"kernel32.dll\")]public static extern IntPtr GetStdHandle(int h);[DllImport(\"kernel32.dll\")]public static extern bool GetConsoleMode(IntPtr h,out int m);[DllImport(\"kernel32.dll\")]public static extern bool SetConsoleMode(IntPtr h,int m);}';$o=[WinCon]::GetStdHandle(-11);$m=0;if([WinCon]::GetConsoleMode($o,[ref]$m)){[void][WinCon]::SetConsoleMode($o,$m -bor 0x000C)}"
)

set ELECTRON_RUN_AS_NODE=1
set OPENCLAW_EMBEDDED_IN=ClawX
"%~dp0..\..\ClawX.exe" "%~dp0..\openclaw\openclaw.mjs" %*
set _EXIT=%ERRORLEVEL%

if defined _CP chcp %_CP% >nul 2>&1

endlocal & exit /b %_EXIT%
