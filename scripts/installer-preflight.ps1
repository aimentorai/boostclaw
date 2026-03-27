param(
    [Parameter(Mandatory = $true)]
    [string]$AppExecutableName,

    [int]$GatewayPort = 18789
)

$ErrorActionPreference = 'SilentlyContinue'

function Invoke-TaskKill {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments
    )

    $taskkill = Join-Path $env:SystemRoot 'System32\taskkill.exe'
    if (-not (Test-Path $taskkill)) {
        return
    }

    $proc = Start-Process -FilePath $taskkill -ArgumentList $Arguments -WindowStyle Hidden -Wait -PassThru
    if ($proc.ExitCode -notin 0, 128, 255) {
        Write-Output "taskkill exit code $($proc.ExitCode) for: $($Arguments -join ' ')"
    }
}

function Get-ListeningPids {
    param(
        [int]$Port
    )

    $netstat = Join-Path $env:SystemRoot 'System32\netstat.exe'
    if (-not (Test-Path $netstat)) {
        return @()
    }

    $matches = @()
    $output = & $netstat -ano -p tcp
    foreach ($line in $output) {
        if ($line -match "^\s*TCP\s+\S+:$Port\s+\S+\s+LISTENING\s+(\d+)\s*$") {
            $matches += $Matches[1]
        }
    }
    return $matches | Sort-Object -Unique
}

function Remove-StaleLockFiles {
    $paths = @(
        (Join-Path $env:APPDATA 'ClawX\clawx.instance.lock'),
        (Join-Path $env:APPDATA 'clawx\clawx.instance.lock')
    ) | Sort-Object -Unique

    foreach ($path in $paths) {
        if (Test-Path $path) {
            Remove-Item $path -Force -ErrorAction SilentlyContinue
            if (-not (Test-Path $path)) {
                Write-Output "Removed stale lock: $path"
            }
        }
    }
}

$normalizedExe = [System.IO.Path]::GetFileName($AppExecutableName)
$lockPaths = @(
    (Join-Path $env:APPDATA 'ClawX\clawx.instance.lock'),
    (Join-Path $env:APPDATA 'clawx\clawx.instance.lock')
) | Sort-Object -Unique
$hadLockFile = $lockPaths | Where-Object { Test-Path $_ } | Select-Object -First 1
$appWasRunning = Get-Process -Name ([System.IO.Path]::GetFileNameWithoutExtension($normalizedExe)) -ErrorAction SilentlyContinue

Write-Output "Stopping $normalizedExe process tree (best effort)..."
Invoke-TaskKill -Arguments @('/F', '/T', '/IM', $normalizedExe)

if ($appWasRunning -or $hadLockFile) {
    $portPids = Get-ListeningPids -Port $GatewayPort
    foreach ($pid in $portPids) {
        Write-Output "Stopping listener on port $GatewayPort (pid=$pid)..."
        Invoke-TaskKill -Arguments @('/F', '/T', '/PID', $pid)
    }
}

Start-Sleep -Milliseconds 800
Remove-StaleLockFiles
