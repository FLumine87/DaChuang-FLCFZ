# Isolated development launcher. Each checkout owns its ports, processes and graph.
param([switch]$NoBrowser, [switch]$SkipAgent, [switch]$AllowMock, [switch]$Stop, [switch]$Status)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$candidates = @(
    (Join-Path $root 'backend\venv\Scripts\python.exe'),
    (Join-Path $root 'personal-backend\venv\Scripts\python.exe')
)
$systemPython = Get-Command python -ErrorAction SilentlyContinue
if ($systemPython) { $candidates += $systemPython.Source }
$launcherPython = $null
foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate) {
        try {
            & $candidate -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' 2>$null
            if ($LASTEXITCODE -eq 0) { $launcherPython = $candidate; break }
        } catch { }
    }
}
if (-not $launcherPython) {
    Write-Host '[FAIL] Python 3.10+ is required. Install Python, then retry.'
    exit 1
}
$launchArgs = @((Join-Path $root 'scripts\start_local.py'))
if ($NoBrowser) { $launchArgs += '--no-browser' }
if ($SkipAgent) { $launchArgs += '--skip-agent' }
if ($AllowMock) { $launchArgs += '--allow-mock' }
if ($Stop) { $launchArgs += '--stop' }
if ($Status) { $launchArgs += '--status' }
$env:PYTHONUTF8 = '1'
& $launcherPython @launchArgs
exit $LASTEXITCODE
