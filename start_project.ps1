# =============================================================================
#  One-click launcher for the Mental Screening System (local dev)
#  - Main backend : stdlib HTTP server   on :8000  (backend\venv python)
#  - Agent backend: FastAPI + uvicorn    on :8001  (personal-backend\venv)
#  - Neo4j (KG)   : Docker container     on :7687/:7474 (personal-kg-neo4j)
#  - Frontend     : Vite dev server      on :5173  (frontend\npm)
#  Boots everything in its own window/container, waits for ports, opens browser.
#
#  Usage:
#    .\start_project.ps1             launch full stack + open browser
#    .\start_project.ps1 -NoBrowser  launch full stack, no browser
#    .\start_project.ps1 -SkipAgent  only the original backend(:8000)+frontend
# =============================================================================
param([switch]$NoBrowser, [switch]$SkipAgent)

$ErrorActionPreference = "Stop"
$root        = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendDir  = Join-Path $root "backend"
$frontendDir = Join-Path $root "frontend"
$agentDir    = Join-Path $root "personal-backend"
$backendPy   = Join-Path $backendDir "venv\Scripts\python.exe"

$portBack       = 8000
$portFront      = 5173
$portAgent      = 8001
$portNeo4j      = 7687
$portNeoBrowser = 7474
$neo4jContainer = "personal-kg-neo4j"
# 首次由本脚本创建容器时使用的本地开发密码（并写入 personal-backend\.env）
$neo4jPassword  = "personal_dev_pwd"
$kgMarker       = Join-Path $agentDir ".kg_seeded"

Write-Host "== Mental Screening System : one-click start =="
if ($SkipAgent) { Write-Host "[mode ] -SkipAgent : 仅启动原后端(:8000)+前端" }

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

# --- 2b. Ensure backend runtime deps (numpy + Pillow) -------------------------
# 真实三模态检索（图像 192 维 / 语音 64 维特征与结果页缩略图）依赖 numpy + Pillow。
# 缺失时引擎会静默退回文本特征，跨模态检索名存实亡，故启动前探测并按需补齐。
$depsOk = $false
try {
    & $backendPython -c "import numpy, PIL" 2>$null
    $depsOk = ($LASTEXITCODE -eq 0)
} catch {
    $depsOk = $false
}
if (-not $depsOk) {
    Write-Host "[setup] backend deps missing (numpy/pillow); installing ..."
    & $backendPython -m pip install --quiet "numpy>=2.0" "pillow>=10.0"
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[ok   ] backend deps installed (numpy, pillow)"
    } else {
        Write-Host "[warn ] failed to install numpy/pillow; cross-modal retrieval will fall back to text features."
    }
} else {
    Write-Host "[ok   ] backend deps present (numpy, pillow)"
}

# --- 2c. Agent stack: personal-backend venv + .env ----------------------------
$agentPython = $null
if (-not $SkipAgent) {
    if (-not (Test-Path $agentDir)) {
        Write-Host "[warn ] personal-backend\ 不存在，跳过个人端 Agent 栈"
        $SkipAgent = $true
    } else {
        # .env 首次生成：与本脚本创建的 Neo4j 容器密码对齐，并默认离线 Mock
        # （无 LLM Key 也能完整演示；之后用户自行填 Key 并改回 False）
        $agentEnv    = Join-Path $agentDir ".env"
        $agentEnvEx  = Join-Path $agentDir ".env.example"
        if (-not (Test-Path $agentEnv) -and (Test-Path $agentEnvEx)) {
            # 读/写都走 .NET UTF-8：PS5 的 Get-Content + Set-Content -Encoding ASCII
            # 会把 .env.example 里的中文注释转成 ????（2026-10-14 修复）
            $txt = [System.IO.File]::ReadAllText($agentEnvEx, [System.Text.Encoding]::UTF8)
            $txt = $txt -replace 'NEO4J_PASSWORD=your_password', "NEO4J_PASSWORD=$neo4jPassword"
            $txt = $txt -replace 'ENABLE_MOCK_ENGINES=False', 'ENABLE_MOCK_ENGINES=True'
            [System.IO.File]::WriteAllText($agentEnv, $txt, (New-Object System.Text.UTF8Encoding($false)))
            Write-Host "[setup] Created $agentEnv （Neo4j 密码已对齐，默认 ENABLE_MOCK_ENGINES=True）"
        }

        $agentPyExe = Join-Path $agentDir "venv\Scripts\python.exe"
        if (Test-Python $agentPyExe) {
            $agentPython = $agentPyExe
            Write-Host "[ok   ] personal-backend venv found"
        } else {
            Write-Host "[setup] creating personal-backend venv ..."
            & $backendPython -m venv (Join-Path $agentDir "venv")
            if (Test-Python $agentPyExe) {
                $agentPython = $agentPyExe
            } else {
                Write-Host "[warn ] personal-backend venv 创建失败，Agent 栈将跳过"
            }
        }

        if ($agentPython) {
            $agentDepsOk = $false
            try {
                & $agentPython -c "import fastapi, uvicorn, neo4j, apscheduler, sqlalchemy, pydantic_settings, httpx" 2>$null
                $agentDepsOk = ($LASTEXITCODE -eq 0)
            } catch { $agentDepsOk = $false }
            if (-not $agentDepsOk) {
                Write-Host "[setup] installing personal-backend deps (fastapi/uvicorn/neo4j/...) ..."
                & $agentPython -m pip install --quiet -r (Join-Path $agentDir "requirements.txt") `
                    -i https://mirrors.aliyun.com/pypi/simple/
                if ($LASTEXITCODE -eq 0) {
                    Write-Host "[ok   ] personal-backend deps installed"
                } else {
                    Write-Host "[warn ] personal-backend 依赖安装失败，Agent 栈将跳过"
                    $agentPython = $null
                }
            } else {
                Write-Host "[ok   ] personal-backend deps present"
            }
        }
    }
}

# --- 2d. Neo4j (Agent knowledge graph) ----------------------------------------
# 两种来源，优先用已经在跑的：
#   external : 7687 已在监听（本机 Neo4j Desktop / 独立安装的 Neo4j）→ 完全不碰 Docker
#   docker   : 否则尝试用 Docker 拉起 personal-kg-neo4j 容器
$neo4jReady  = $false
$neo4jSource = "none"
if (-not $SkipAgent -and $agentPython) {
    if (Get-NetTCPConnection -LocalPort $portNeo4j -State Listen -ErrorAction SilentlyContinue) {
        $neo4jSource = "external"
        Write-Host "[ok   ] 检测到 :$portNeo4j 已在监听，视为本机 Neo4j（Desktop/独立安装），跳过 Docker"
    } else {
        # 注意：本脚本 $ErrorActionPreference="Stop"，而 docker 出错时走 stderr，
        # PS5 下对原生命令做 2>$null 重定向会把 stderr 包装成终止错误。
        # 统一经此封装调用：合并 stderr、临时放宽 EAP，仅以退出码判定结果。
        function Invoke-Docker {
            param([Parameter(ValueFromRemainingArguments = $true)][string[]]$DockerArgs)
            $prevEap = $ErrorActionPreference
            $ErrorActionPreference = "Continue"
            try {
                & docker @DockerArgs 2>&1 | Out-Null
                return $LASTEXITCODE
            } finally {
                $ErrorActionPreference = $prevEap
            }
        }

        function Test-DockerDaemon {
            $cli = Get-Command docker -ErrorAction SilentlyContinue
            if (-not $cli) { return "no-cli" }
            $code = Invoke-Docker info --format "{{.ServerVersion}}"
            if ($code -eq 0) { return "up" } else { return "down" }
        }

        $dockerState = Test-DockerDaemon
        if ($dockerState -eq "down") {
            # 尝试拉起 Docker Desktop（守护进程没启动时）
            $candidates = @(
                "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe",
                "${env:ProgramFiles(x86)}\Docker\Docker\Docker Desktop.exe",
                "$env:LOCALAPPDATA\Programs\DockerDesktop\Docker Desktop.exe"
            )
            $dd = $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
            if ($dd) {
                Write-Host "[setup] Docker 守护进程未运行，正在启动 Docker Desktop（首次可能需要 1-2 分钟）..."
                Start-Process -FilePath $dd | Out-Null
                for ($i = 0; $i -lt 40; $i++) {
                    Start-Sleep -Seconds 3
                    if ((Test-DockerDaemon) -eq "up") { $dockerState = "up"; break }
                }
            }
        }

        if ($dockerState -eq "no-cli") {
            Write-Host "[warn ] 未检测到 docker 且 7687 无 Neo4j：Agent 后端(:8001)仍会启动，但知识图谱功能不可用"
        } elseif ($dockerState -ne "up") {
            Write-Host "[warn ] Docker 守护进程未能就绪：Agent 后端(:8001)仍会启动，但知识图谱功能不可用"
            Write-Host "        可先在 Neo4j Desktop 中启动数据库，或手动打开 Docker Desktop 后重跑本脚本"
        } else {
            $neo4jSource = "docker"
            $exists = (Invoke-Docker container inspect $neo4jContainer) -eq 0

            if (-not $exists) {
                Write-Host "[boot ] 首次创建 Neo4j 容器（需拉取 neo4j:5-community 镜像，请耐心等待）..."
                $runCode = Invoke-Docker run -d --name $neo4jContainer `
                    -p "${portNeoBrowser}:7474" -p "${portNeo4j}:7687" `
                    -e "NEO4J_AUTH=neo4j/$neo4jPassword" `
                    neo4j:5-community
                if ($runCode -ne 0) {
                    Write-Host "[warn ] Neo4j 容器创建失败，知识图谱功能本次不可用"
                    $neo4jSource = "none"
                }
            } else {
                $prevEap = $ErrorActionPreference
                $ErrorActionPreference = "Continue"
                try {
                    $running = (& docker inspect -f "{{.State.Running}}" $neo4jContainer 2>&1 | Out-String).Trim()
                } finally {
                    $ErrorActionPreference = $prevEap
                }
                if ($running -ne "true") {
                    Write-Host "[boot ] 启动已有 Neo4j 容器 $neo4jContainer ..."
                    $null = Invoke-Docker start $neo4jContainer
                } else {
                    Write-Host "[ok   ] Neo4j 容器已在运行"
                }
            }
        }
    }
}

# --- 3. Skip any component already listening (avoids port conflicts) --------
$backBusy  = Get-NetTCPConnection -LocalPort $portBack  -State Listen -ErrorAction SilentlyContinue
$frontBusy = Get-NetTCPConnection -LocalPort $portFront -State Listen -ErrorAction SilentlyContinue
$agentBusy = $null
if (-not $SkipAgent -and $agentPython) {
    $agentBusy = Get-NetTCPConnection -LocalPort $portAgent -State Listen -ErrorAction SilentlyContinue
}

# --- 4. Wait for Neo4j bolt, then seed the knowledge graph --------------------
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

if (-not $SkipAgent -and $agentPython -and $neo4jSource -ne "none" -and -not $agentBusy) {
    $neo4jReady = Wait-Port $portNeo4j "Neo4j bolt" -Tries 180
    if ($neo4jReady -and -not (Test-Path $kgMarker)) {
        Write-Host "[setup] 初始化个人 KG 约束 + 导入领域种子（仅首次）..."
        Push-Location $agentDir
        try {
            & $agentPython scripts\init_kg.py
            $rc1 = $LASTEXITCODE
            & $agentPython scripts\seed_domain_kg.py
            $rc2 = $LASTEXITCODE
            if ($rc1 -eq 0 -and $rc2 -eq 0) {
                Set-Content -Path $kgMarker -Value "seeded" -Encoding ASCII
                Write-Host "[ok   ] 知识图谱初始化完成"
            } else {
                Write-Host "[warn ] KG 初始化脚本返回非 0（多为密码不匹配）；请让 personal-backend\.env 的 NEO4J_PASSWORD 与你在 Neo4j Desktop/容器中设置的密码一致"
            }
        } finally {
            Pop-Location
        }
    } elseif ($neo4jReady -and (Test-Path $kgMarker)) {
        Write-Host "[ok   ] 知识图谱已初始化过（跳过种子；如换了空库请删除 personal-backend\.kg_seeded 重跑）"
    }
}

# --- 5. Boot backend / agent / frontend in minimized windows ----------------
$backendProc = $null
$frontProc   = $null
$agentProc   = $null

if ($backBusy) {
    Write-Host "[skip ] backend already listening on :$portBack"
} else {
    Write-Host "[boot ] starting backend on :$portBack ..."
    $backendProc = Start-Process -FilePath $backendPython -ArgumentList @("-m", "app.main") `
        -WorkingDirectory $backendDir -WindowStyle Minimized -PassThru
}

if (-not $SkipAgent -and $agentPython) {
    if ($agentBusy) {
        Write-Host "[skip ] agent backend already listening on :$portAgent"
    } else {
        Write-Host "[boot ] starting personal-agent backend on :$portAgent ..."
        $agentProc = Start-Process -FilePath $agentPython `
            -ArgumentList @("-m", "uvicorn", "app.main:app", "--port", "$portAgent", "--host", "127.0.0.1") `
            -WorkingDirectory $agentDir -WindowStyle Minimized -PassThru
    }
}

if ($frontBusy) {
    Write-Host "[skip ] frontend already listening on :$portFront"
} else {
    Write-Host "[boot ] starting frontend on :$portFront ..."
    $frontProc = Start-Process -FilePath "npm.cmd" -ArgumentList @("run", "dev") `
        -WorkingDirectory $frontendDir -WindowStyle Minimized -PassThru
}

# --- 6. Wait until each port is listening ------------------------------------
$backOk  = Wait-Port $portBack  "backend"  -Tries 120 -Proc $backendProc
$agentOk = $true
if (-not $SkipAgent -and $agentPython -and -not $agentBusy) {
    $agentOk = Wait-Port $portAgent "agent backend" -Tries 60 -Proc $agentProc
    if ($agentOk) {
        try {
            $h = Invoke-RestMethod -Uri "http://127.0.0.1:$portAgent/api/v1/health" -TimeoutSec 5
            Write-Host "[ok   ] agent health -> neo4j_connected=$($h.neo4j_connected) mock_mode=$($h.mock_mode)"
        } catch {
            Write-Host "[warn ] agent 健康检查接口无响应"
        }
    }
}
$frontOk = Wait-Port $portFront "frontend" -Proc $frontProc

# Agent 栈失败不阻塞主系统（原平台功能独立于 :8001）
if (-not ($backOk -and $frontOk)) {
    Write-Host ""
    Write-Host "[fail ] backend/frontend did not start; not opening the browser."
    exit 1
}
if (-not $agentOk) {
    Write-Host "[warn ] 个人端 Agent(:8001) 未就绪，主系统照常使用；详见最小化的 agent 控制台窗口"
}

# --- 7. Open the browser ------------------------------------------------------
if (-not $NoBrowser) {
    Write-Host "[open ] launching browser ..."
    Start-Process "http://localhost:$portFront"
}

Write-Host ""
Write-Host "Backend       : http://localhost:$portBack   (health: /health)"
if (-not $SkipAgent -and $agentPython) {
    Write-Host "Agent backend : http://localhost:$portAgent/docs   (health: /api/v1/health)"
    if ($neo4jReady) {
        Write-Host "Neo4j Browser : http://localhost:$portNeoBrowser   (neo4j / $neo4jPassword 或你 .env 中的密码)"
    }
}
Write-Host "Frontend      : http://localhost:$portFront"
Write-Host "Logs are in the minimized console windows. Close them to stop."
Write-Host "停止 Neo4j : docker stop $neo4jContainer"
