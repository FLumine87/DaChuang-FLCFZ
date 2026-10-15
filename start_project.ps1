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
# 注：不再用 .kg_seeded 文件判断"是否已播种"（2026-10-15）——文件标记不区分
# 连的是本机 Neo4j 还是 Docker 容器，换库后会误判为已播种导致图谱是空的。
# 现在改为直接查库里的节点数（见 Test-KgHasData）。

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
        # 2026-10-15 修复：docker 调用**不要封装成 PowerShell 函数**。
        # 有两个坑，都会让"首次建容器"这条分支永远走不通：
        #   ① 写成 Invoke-Docker run -d -e "..." 时，`-e` 会被当成函数自身的参数名
        #      参与绑定，PowerShell 发现有多个以 e 开头的通用参数（-ErrorAction /
        #      -ErrorVariable），抛 AmbiguousParameter 终止错误；
        #   ② 即便改成数组传参，$LASTEXITCODE 在函数作用域里也会被 docker 写到
        #      stderr 的告警干扰（实测同样命令直接调用 exit 0、套一层函数就变 1），
        #      于是守护进程被误判为 down。
        # 因此这里统一：直接调用原生命令 + 临时放宽 EAP，并用**输出内容**判定结果。
        function Test-DockerDaemon {
            $cli = Get-Command docker -ErrorAction SilentlyContinue
            if (-not $cli) { return "no-cli" }
            $prevEap = $ErrorActionPreference
            $ErrorActionPreference = "Continue"
            # docker info 成功会打印服务端版本号（如 29.8.2），据此判定比退出码可靠
            $out = (& docker info --format '{{.ServerVersion}}' 2>$null | Out-String).Trim()
            $ErrorActionPreference = $prevEap
            if ($out -match '\d+\.\d+') { return "up" } else { return "down" }
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
            # 内联调用原生命令：参数不会参与函数绑定，$LASTEXITCODE 在本作用域也可靠
            $prevEap = $ErrorActionPreference
            $ErrorActionPreference = "Continue"
            & docker container inspect $neo4jContainer 2>&1 | Out-Null
            $exists = ($LASTEXITCODE -eq 0)
            $ErrorActionPreference = $prevEap

            if (-not $exists) {
                Write-Host "[boot ] 首次创建 Neo4j 容器（需拉取 neo4j:5-community 镜像，请耐心等待）..."
                $prevEap = $ErrorActionPreference
                $ErrorActionPreference = "Continue"
                & docker run -d --name $neo4jContainer `
                    -p "${portNeoBrowser}:7474" -p "${portNeo4j}:7687" `
                    -e "NEO4J_AUTH=neo4j/$neo4jPassword" `
                    neo4j:5-community 2>&1 | Out-Null
                $runCode = $LASTEXITCODE
                $ErrorActionPreference = $prevEap
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
                    $prevEap = $ErrorActionPreference
                    $ErrorActionPreference = "Continue"
                    & docker start $neo4jContainer 2>&1 | Out-Null
                    $ErrorActionPreference = $prevEap
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

# 从 personal-backend\.env 取 Neo4j 密码（本机 Neo4j Desktop 的密码是用户自己设的，
# 不一定等于脚本建容器用的 $neo4jPassword，所以以 .env 为准）
function Get-Neo4jPassword {
    $envFile = Join-Path $agentDir ".env"
    if (Test-Path $envFile) {
        $line = Get-Content $envFile -Encoding UTF8 | Where-Object { $_ -match '^\s*NEO4J_PASSWORD=' } | Select-Object -First 1
        if ($line) { return ($line -split '=', 2)[1].Trim() }
    }
    return $neo4jPassword
}
$neo4jPwd = Get-Neo4jPassword

# bolt 端口开了 ≠ 可以认证：容器首次启动内部还要初始化几十秒，
# 此时启动 agent 会拿到 neo4j_connected=False（2026-10-15 修复）。
# 这里用真实连接探测，确认能认证再往下走。
function Wait-Neo4jAuth {
    param($Tries = 90)
    $probe = @'
import sys
from neo4j import GraphDatabase
try:
    d = GraphDatabase.driver("bolt://localhost:" + sys.argv[1], auth=("neo4j", sys.argv[2]))
    d.verify_connectivity()
    d.close()
    print("ok")
except Exception:
    pass
'@
    $probeFile = Join-Path $env:TEMP "kg_probe_connect.py"
    [System.IO.File]::WriteAllText($probeFile, $probe, (New-Object System.Text.UTF8Encoding($false)))
    for ($i = 0; $i -lt $Tries; $i++) {
        $prevEap = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        $out = (& $agentPython $probeFile "$portNeo4j" $neo4jPwd 2>$null | Out-String).Trim()
        $ErrorActionPreference = $prevEap
        if ($out -eq "ok") { return $true }
        Start-Sleep -Seconds 2
    }
    return $false
}

# 库里有没有数据：直接查节点数，不靠 .kg_seeded 这类文件标记。
# 这样"本机 Neo4j"和"Docker 容器"是两个独立的库，各自判断该不该播种，
# 换库（比如删掉容器重建）也不会因为旧标记而漏掉种子导入（2026-10-15）。
function Test-KgHasData {
    $probe = @'
import sys
from neo4j import GraphDatabase
try:
    d = GraphDatabase.driver("bolt://localhost:" + sys.argv[1], auth=("neo4j", sys.argv[2]))
    with d.session() as s:
        n = s.run("MATCH (n) RETURN count(n) AS c").single()["c"]
    d.close()
    print(int(n))
except Exception:
    print(-1)
'@
    $probeFile = Join-Path $env:TEMP "kg_probe_count.py"
    [System.IO.File]::WriteAllText($probeFile, $probe, (New-Object System.Text.UTF8Encoding($false)))
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $out = (& $agentPython $probeFile "$portNeo4j" $neo4jPwd 2>$null | Out-String).Trim()
    $ErrorActionPreference = $prevEap
    $count = 0
    if (-not [int]::TryParse($out, [ref]$count)) { return $false }
    return ($count -gt 0)
}

if (-not $SkipAgent -and $agentPython -and $neo4jSource -ne "none" -and -not $agentBusy) {
    $neo4jReady = Wait-Port $portNeo4j "Neo4j bolt" -Tries 180
    if ($neo4jReady) {
        # 端口就绪后再等认证可用，否则 agent 起早了会连不上
        $authOk = Wait-Neo4jAuth
        if (-not $authOk) {
            Write-Host "[warn ] Neo4j 端口已开但认证未就绪（多为 .env 的 NEO4J_PASSWORD 与实际密码不一致）"
            Write-Host "        已跳过种子导入；请核对 personal-backend\.env 的 NEO4J_PASSWORD"
        } else {
            Write-Host "[ok   ] Neo4j 认证可用（来源：$neo4jSource）"
            if (Test-KgHasData) {
                Write-Host "[ok   ] 该 Neo4j 库已有数据，跳过种子导入"
            } else {
                Write-Host "[setup] 该 Neo4j 库为空，初始化约束 + 导入领域种子 ..."
                Push-Location $agentDir
                try {
                    & $agentPython scripts\init_kg.py
                    $rc1 = $LASTEXITCODE
                    & $agentPython scripts\seed_domain_kg.py
                    $rc2 = $LASTEXITCODE
                    if ($rc1 -eq 0 -and $rc2 -eq 0) {
                        Write-Host "[ok   ] 知识图谱初始化完成"
                    } else {
                        Write-Host "[warn ] KG 初始化脚本返回非 0（多为密码不匹配）；请让 personal-backend\.env 的 NEO4J_PASSWORD 与你在 Neo4j Desktop/容器中设置的密码一致"
                    }
                } finally {
                    Pop-Location
                }
            }
        }
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
