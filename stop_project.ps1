# =============================================================================
#  One-click stop for the Mental Screening System
#  Terminates whatever is listening on :8000 (backend) and :5173 (frontend),
#  i.e. the two processes that start_project.ps1 launches.
# =============================================================================
$ErrorActionPreference = "SilentlyContinue"

Write-Host "== Mental Screening System : stop =="

$stopped = $false
foreach ($p in @(8000, 5173)) {
    $conns = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue
    if ($conns) {
        foreach ($c in $conns) {
            Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
            Write-Host "[ok  ] port $p : stopped PID $($c.OwningProcess)"
            $stopped = $true
        }
    } else {
        Write-Host "[--- ] port $p : already free"
    }
}

Start-Sleep -Milliseconds 800
Write-Host ""
if ($stopped) {
    Write-Host "Services stopped. Ports 8000 and 5173 are free."
} else {
    Write-Host "Nothing seemed to be running on 8000/5173."
}