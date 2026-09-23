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
if (-not (Test-Path $backendPy)) {
    $backendPython = Get-Command python -ErrorAction SilentlyContinue
    if (-not $backendPython) {
        Write-Host "[error] Neither backend\venv nor a system 'python' was found."
        Write-Host "        Please create the venv first:  cd backend && start.bat"
        exit 1
    }
    $backendPython = $backendPython.Source
    Write-Host "[warn ] backend\venv missing; using system python: $backendPython"
} else {
    $backendPython = $backendPy
    Write-Host "[ok   ] backend venv found: $backendPython"
}

# --- 3. Skip any component already running (avoids port conflicts) -----------
$backBusy  = Get-NetTCPConnection -LocalPort $portBack  -State Listen -ErrorAction SilentlyContinue
$frontBusy = Get-NetTCPConnection -LocalPort $portFront -State Listen -ErrorAction SilentlyContinue

# --- 4. Boot backend / frontend in their own (minimized) windows -------------
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
    param($Port, $Name, $Tries = 60)
    for ($i = 0; $i -lt $Tries; $i++) {
        if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
            Write-Host "[ok   ] $Name is up on :$Port"
            return $true
        }
        Start-Sleep -Milliseconds 500
    }
    Write-Host "[warn ] $Name did not come up in time on :$Port"
    return $false
}

Wait-Port $portBack  "backend"  -Tries 120 | Out-Null
Wait-Port $portFront "frontend" | Out-Null

# --- 6. Open the browser -------------------------------------------------------
if (-not $NoBrowser) {
    Write-Host "[open ] launching browser ..."
    Start-Process "http://localhost:$portFront"
}

Write-Host ""
Write-Host "Backend  : http://localhost:$portBack   (health: /health)"
Write-Host "Frontend : http://localhost:$portFront"
Write-Host "Logs are in the two minimized console windows. Close them to stop."