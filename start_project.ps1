# =============================================================================
#  One-click launcher for the Mental Screening System (local dev)
#  - Backend : standard-library HTTP server on :8000  (backend\venv python)
#  - Frontend: Vite dev server              on :5173  (frontend\npm)
#  It ensures the frontend dev proxy points at the local backend, boots both
#  processes in their own windows, waits until they respond, then opens the
#  browser.
#
#  Usage:
#    .\start_project.ps1            launch + open browser
#    .\start_project.ps1 -NoBrowser launch only
# =============================================================================
param([switch]$NoBrowser)

$ErrorActionPreference = "Stop"
$root       = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendDir = Join-Path $root "backend"
$frontendDir = Join-Path $root "frontend"
$backendPy  = Join-Path $backendDir "venv\Scripts\python.exe"

$portBack  = 8000
$portFront = 5173

Write-Host "== Mental Screening System : one-click start =="

# --- 1. Ensure the frontend dev proxy points at the local backend -----------
$envLocal = Join-Path $frontendDir ".env.local"
if (-not (Test-Path $envLocal)) {
    @("VITE_DEV_PROXY_TARGET=http://localhost:$portBack", "VITE_USE_MOCK=false") |
        Set-Content -Path $envLocal -Encoding ASCII
    Write-Host "[setup] Created $envLocal"
} else {
    Write-Host "[setup] Reusing $envLocal"
}

# --- 2. Decide the Python interpreter ----------------------------------------
# A venv copied from another machine keeps a hard-coded path to its base
# interpreter in pyvenv.cfg, so venv\Scripts\python.exe can exist and still be
# unusable. Probe the interpreter by running it instead of trusting Test-Path.
function Test-Python {
    param([string]$Exe)
    if (-not $Exe -or -not (Test-Path $Exe)) { return $false }
    try {
        & $Exe -c "import sys" 2>$null
        return ($LASTEXITCODE -eq 0)
    } catch {
        return $false
    }
}

if (Test-Python $backendPy) {
    $backendPython = $backendPy
    Write-Host "[ok   ] backend venv found: $backendPython"
} else {
    if (Test-Path $backendPy) {
        Write-Host "[warn ] backend\venv exists but is not runnable (broken base interpreter)."
    } else {
        Write-Host "[warn ] backend\venv missing."
    }
    $systemPython = Get-Command python -ErrorAction SilentlyContinue
    if ($systemPython -and (Test-Python $systemPython.Source)) {
        $backendPython = $systemPython.Source
        Write-Host "[warn ] falling back to system python: $backendPython"
    } else {
        Write-Host "[error] No usable Python interpreter (backend\venv and system 'python' both failed)."
        Write-Host "        Recreate the venv:  python -m venv backend\venv"
        exit 1
    }
}

# --- 3. Skip any component already running (avoids port conflicts) -----------
$backBusy  = Get-NetTCPConnection -LocalPort $portBack  -State Listen -ErrorAction SilentlyContinue
$frontBusy = Get-NetTCPConnection -LocalPort $portFront -State Listen -ErrorAction SilentlyContinue

# --- 4. Boot backend / frontend in their own (minimized) windows -------------
$backendProc = $null
$frontProc   = $null

if ($backBusy) {
    Write-Host "[skip ] backend already listening on :$portBack"
} else {
    Write-Host "[boot ] starting backend on :$portBack ..."
    $backendProc = Start-Process -FilePath $backendPython -ArgumentList @("-m", "app.main") `
        -WorkingDirectory $backendDir -WindowStyle Minimized -PassThru
}

if ($frontBusy) {
    Write-Host "[skip ] frontend already listening on :$portFront"
} else {
    Write-Host "[boot ] starting frontend on :$portFront ..."
    $frontProc = Start-Process -FilePath "npm.cmd" -ArgumentList @("run", "dev") `
        -WorkingDirectory $frontendDir -WindowStyle Minimized -PassThru
}

# --- 5. Wait until each port is listening -------------------------------------
function Wait-Port {
    param($Port, $Name, $Tries = 60, $Proc)
    for ($i = 0; $i -lt $Tries; $i++) {
        if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
            Write-Host "[ok   ] $Name is up on :$Port"
            return $true
        }
        if ($Proc -and $Proc.HasExited) {
            Write-Host "[error] $Name exited before listening on :$Port (exit code $($Proc.ExitCode))."
            Write-Host "        Check the minimized console window / logs for the traceback."
            return $false
        }
        Start-Sleep -Milliseconds 500
    }
    Write-Host "[warn ] $Name did not come up in time on :$Port"
    return $false
}

$backOk  = Wait-Port $portBack  "backend"  -Tries 120 -Proc $backendProc
$frontOk = Wait-Port $portFront "frontend" -Proc $frontProc

if (-not ($backOk -and $frontOk)) {
    Write-Host ""
    Write-Host "[fail ] one or more services did not start; not opening the browser."
    exit 1
}

# --- 6. Open the browser -------------------------------------------------------
if (-not $NoBrowser) {
    Write-Host "[open ] launching browser ..."
    Start-Process "http://localhost:$portFront"
}

Write-Host ""
Write-Host "Backend  : http://localhost:$portBack   (health: /health)"
Write-Host "Frontend : http://localhost:$portFront"
Write-Host "Logs are in the two minimized console windows. Close them to stop."