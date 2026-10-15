# =============================================================================
#  One-click LLM API setup for the Mental Screening System
#  一键配置项目所需的大模型 API —— 只需一个 Key，覆盖全部用到 LLM 的模块：
#    · 主后端  backend/.env          : DEEPSEEK_*（RAG 报告生成；OpenAI 兼容调用）
#    · 个人端  personal-backend/.env : LLM_*（陪伴对话 / 推荐语 / 问询等 Agent）
#  两个 .env 均已在 .gitignore 中（第 56-58 行），Key 不会被提交到 GitHub。
#
#  Usage:
#    .\configure_api.ps1                     交互式配置（推荐）
#    .\configure_api.ps1 -ApiKey sk-xxx      非交互（可配合 -Provider/-BaseUrl/-Model）
#    .\configure_api.ps1 -SkipVerify         跳过连通性验证
#    .\configure_api.ps1 -RestoreOffline     还原为离线 Mock（清除 Key，无需任何外部服务）
# =============================================================================
param(
    [string]$ApiKey,
    [ValidateSet("deepseek", "qwen", "zhipu", "openai", "custom")]
    [string]$Provider,
    [string]$BaseUrl,
    [string]$Model,
    [switch]$SkipVerify,
    [switch]$RestoreOffline
)

$ErrorActionPreference = "Stop"
$root       = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendEnv = Join-Path $root "backend\.env"
$agentEnv   = Join-Path $root "personal-backend\.env"
$utf8NoBom  = New-Object System.Text.UTF8Encoding($false)
# 传入 -ApiKey 即视为全静默模式：缺省项用预设值填充，不再弹出交互提示
$nonInteractive = [bool]$ApiKey

# ---- Provider 预设（均为 OpenAI 兼容接口）-----------------------------------
$presets = [ordered]@{
    deepseek = @{ Name = "DeepSeek";  Base = "https://api.deepseek.com/v1";                       Model = "deepseek-chat" }
    qwen     = @{ Name = "通义千问";   Base = "https://dashscope.aliyuncs.com/compatible-mode/v1"; Model = "qwen-plus" }
    zhipu    = @{ Name = "智谱 GLM";  Base = "https://open.bigmodel.cn/api/paas/v4";              Model = "glm-4-plus" }
    openai   = @{ Name = "OpenAI";    Base = "https://api.openai.com/v1";                         Model = "gpt-4o-mini" }
}

function Read-EnvLines([string]$Path) {
    if (Test-Path $Path) {
        return @([System.IO.File]::ReadAllText($Path) -split "\r?\n")
    }
    return @()
}

function New-EnvList([string]$Path) {
    # New-Object List[string](<长数组>) 会被当成"逐参构造"报错，统一用 AddRange 构建。
    # 返回时必须加逗号：否则 List 会被 PowerShell 枚举展开成普通数组，
    # 调用方拿到的是展开结果，后续 Set-EnvValue 的类型转换会作用在副本上、修改丢失。
    $list = [System.Collections.Generic.List[string]]::new()
    $raw = Read-EnvLines $Path
    if ($raw.Count -gt 0) { $list.AddRange([string[]]$raw) }
    return ,$list
}

function Set-EnvValue {
    # 合并语义：命中 KEY= 行则替换，否则追加；注释行与其余键原样保留
    param([System.Collections.Generic.List[string]]$Lines, [string]$Key, [string]$Value)
    $pattern = "^" + [regex]::Escape($Key) + "="
    for ($i = 0; $i -lt $Lines.Count; $i++) {
        if ($Lines[$i] -match $pattern) {
            $Lines[$i] = "$Key=$Value"
            return
        }
    }
    $Lines.Add("$Key=$Value")
}

function Write-EnvFile([string]$Path, [System.Collections.Generic.List[string]]$Lines) {
    $dir = Split-Path -Parent $Path
    if (-not (Test-Path $dir)) {
        Write-Host "[warn ] 目录不存在，跳过：$Path"
        return $false
    }
    # 去掉尾部空行后写回（UTF-8 无 BOM；带 BOM 会让后端解析丢掉第一个键）
    while ($Lines.Count -gt 0 -and $Lines[$Lines.Count - 1].Trim() -eq "") {
        $Lines.RemoveAt($Lines.Count - 1)
    }
    [System.IO.File]::WriteAllLines($Path, $Lines.ToArray(), $utf8NoBom)
    return $true
}

function Test-Ignored([string]$RelPath) {
    # 先问 git；没有 git 时退化为检查 .gitignore 是否含 ".env" 规则
    $git = Get-Command git -ErrorAction SilentlyContinue
    if ($git) {
        Push-Location $root
        try {
            & git check-ignore -q -- $RelPath 2>$null
            return ($LASTEXITCODE -eq 0)
        } finally { Pop-Location }
    }
    $gi = Join-Path $root ".gitignore"
    if (Test-Path $gi) { return [bool](Select-String -Path $gi -Pattern '^\.env$' -Quiet) }
    return $false
}

function Assert-NotTracked([string]$RelPath) {
    # 安全底线：写 Key 前确认该文件不会被 git 跟踪，否则补 .gitignore
    if (Test-Ignored $RelPath) { return $true }
    Write-Host "[warn ] $RelPath 未被 .gitignore 忽略，正在补规则…"
    $gi = Join-Path $root ".gitignore"
    Add-Content -Path $gi -Value "`n# 大模型 API 密钥等本地配置，禁止入库`n.env" -Encoding ASCII
    if (Test-Ignored $RelPath) {
        Write-Host "[ok   ] 已加入 .gitignore"
        return $true
    }
    Write-Host "[error] 无法确认 $RelPath 已被忽略，请手动检查 .gitignore 后再配置 Key！"
    return $false
}

function Show-MaskedKey([string]$Key) {
    if ($Key.Length -le 10) { return "****" }
    return $Key.Substring(0, 6) + "****" + $Key.Substring($Key.Length - 4)
}

function Test-LlmEndpoint([string]$Base, [string]$Key, [string]$ModelName) {
    # 用 1 次最小对话验证 Key 与 BaseUrl 是否可用（与后端同为 HTTPS JSON 调用）
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    } catch {}
    $uri = $Base.TrimEnd("/") + "/chat/completions"
    $body = @{
        model      = $ModelName
        messages   = @(@{ role = "user"; content = "ping" })
        max_tokens = 2
    } | ConvertTo-Json -Depth 5 -Compress
    try {
        $null = Invoke-RestMethod -Uri $uri -Method Post -TimeoutSec 30 `
            -Headers @{ Authorization = "Bearer $Key" } `
            -ContentType "application/json; charset=utf-8" -Body $body
        return @{ Ok = $true; Message = "接口连通、Key 有效" }
    } catch {
        $detail = ""
        if ($_.ErrorDetails -and $_.ErrorDetails.Message) { $detail = $_.ErrorDetails.Message }
        if ($detail.Length -gt 200) { $detail = $detail.Substring(0, 200) }
        $status = ""
        try { $status = [int]$_.Exception.Response.StatusCode } catch {}
        if ($status -eq 401 -or $status -eq 403) {
            return @{ Ok = $false; Message = "鉴权失败（HTTP $status）：Key 无效或无权限。$detail" }
        }
        if ($status -eq 404) {
            return @{ Ok = $false; Message = "接口 404：BaseUrl 或模型名可能不对。请确认 BaseUrl 填到 /v1 为止（不要带 /chat/completions，脚本会自行拼接）；火山方舟等平台需用 ep- 接入点 ID。$detail" }
        }
        if ($status) {
            return @{ Ok = $false; Message = "HTTP $status：$detail" }
        }
        return @{ Ok = $false; Message = "网络/证书异常：$($_.Exception.Message)。校园网代理环境可在 .env 里设 LLM_VERIFY_SSL=False 后重试。" }
    }
}

Write-Host "======================================================"
Write-Host "  心理筛查预警系统 : 大模型 API 一键配置"
Write-Host "  一个 Key 同时供 主后端(:8000) 与 个人端 Agent(:8001) 使用"
Write-Host "======================================================"
Write-Host ""

# ---- 0. 安全底线：两个 .env 必须已忽略 --------------------------------------
$ignored = (Assert-NotTracked "backend/.env") -and (Assert-NotTracked "personal-backend/.env")
if (-not $ignored) { exit 1 }

# ---- 1. 还原离线模式 ---------------------------------------------------------
if ($RestoreOffline) {
    $bLines = New-EnvList $backendEnv
    $aLines = New-EnvList $agentEnv
    Set-EnvValue $bLines "ENABLE_MOCK_ENGINES" "True"
    Set-EnvValue $bLines "DEEPSEEK_API_KEY" ""
    Set-EnvValue $aLines "ENABLE_MOCK_ENGINES" "True"
    Set-EnvValue $aLines "LLM_API_KEY" ""
    Write-EnvFile $backendEnv $bLines | Out-Null
    Write-EnvFile $agentEnv $aLines | Out-Null
    Write-Host "[ok   ] 已还原为离线 Mock 模式（Key 已清空，无需任何外部服务）"
    Write-Host "        重新启用真实大模型：再次运行本脚本并填入 Key 即可。"
    exit 0
}

# ---- 2. 选择服务商 -----------------------------------------------------------
if (-not $Provider) {
    if ($nonInteractive) {
        $Provider = "deepseek"
        Write-Host "[info ] 未指定 -Provider，默认使用 DeepSeek"
    } else {
        Write-Host "请选择大模型服务商（均为 OpenAI 兼容接口）："
        Write-Host "  1) DeepSeek         （推荐，中文效果好、价格低）"
        Write-Host "  2) 通义千问 DashScope"
        Write-Host "  3) 智谱 GLM"
        Write-Host "  4) OpenAI"
        Write-Host "  5) 自定义 OpenAI 兼容接口"
        $choice = Read-Host "输入序号 [1]"
        if (-not $choice) { $choice = "1" }
        $Provider = @{ "1" = "deepseek"; "2" = "qwen"; "3" = "zhipu"; "4" = "openai"; "5" = "custom" }[$choice]
        if (-not $Provider) { Write-Host "[error] 无效选择"; exit 1 }
    }
}

$presetName = "自定义"
$presetBase = ""
$presetModel = ""
if ($Provider -ne "custom") {
    $p = $presets[$Provider]
    $presetName = $p.Name
    $presetBase = $p.Base
    $presetModel = $p.Model
}

# ---- 3. 收集 Key / BaseUrl / Model ------------------------------------------
if (-not $ApiKey) {
    Write-Host ""
    Write-Host "服务商：$presetName"
    Write-Host "（在服务商控制台创建 API Key 后粘贴到这里；输入不回显，粘贴后回车即可）"
    $secure = Read-Host -Prompt "API Key" -AsSecureString
    $ApiKey = [System.Net.NetworkCredential]::new("", $secure).Password
}
$ApiKey = "$ApiKey".Trim()
if (-not $ApiKey) { Write-Host "[error] API Key 不能为空"; exit 1 }

if ($Provider -eq "custom" -and -not $BaseUrl) {
    if ($nonInteractive) { Write-Host "[error] 自定义服务商需同时指定 -BaseUrl 与 -Model"; exit 1 }
    Write-Host "示例：https://api.example.com/v1（填到 /v1 为止即可）"
    $BaseUrl = Read-Host "BaseUrl"
}
if (-not $BaseUrl) { $BaseUrl = $presetBase }
$BaseUrl = "$BaseUrl".Trim().TrimEnd("/")
# 部分服务商控制台展示的是完整端点（…/v1/chat/completions），
# 而脚本与后端都会在 BaseUrl 后再拼一次 /chat/completions ——
# 这里自动剥掉端点后缀，两种填法都能用（2026-10-14：移动云用户误填导致 404 后加）
if ($BaseUrl -match "/chat/completions$") {
    $BaseUrl = $BaseUrl.Substring(0, $BaseUrl.Length - "/chat/completions".Length).TrimEnd("/")
    Write-Host "[info ] BaseUrl 已自动去掉末尾的 /chat/completions（脚本会自行拼接）"
}
if ($BaseUrl -notmatch "^https?://") { Write-Host "[error] BaseUrl 必须是 http(s):// 开头的完整地址"; exit 1 }

if (-not $Model) {
    if ($Provider -eq "custom") {
        if ($nonInteractive) { Write-Host "[error] 自定义服务商需同时指定 -Model"; exit 1 }
        $Model = Read-Host "模型名（如 deepseek-chat）"
    } elseif ($nonInteractive) {
        $Model = $presetModel
        Write-Host "[info ] 未指定 -Model，使用默认：$Model"
    } else {
        $inputModel = Read-Host "模型名 [默认 $presetModel]"
        if ($inputModel) { $Model = $inputModel } else { $Model = $presetModel }
    }
}
$Model = "$Model".Trim()
if (-not $Model) { Write-Host "[error] 模型名不能为空"; exit 1 }

Write-Host ""
Write-Host "即将配置："
Write-Host "  BaseUrl : $BaseUrl"
Write-Host "  Model   : $Model"
Write-Host "  API Key : $(Show-MaskedKey $ApiKey)"
Write-Host ""

# ---- 4. 连通性验证 -----------------------------------------------------------
if (-not $SkipVerify) {
    Write-Host "[test ] 正在验证接口连通性…"
    $result = Test-LlmEndpoint $BaseUrl $ApiKey $Model
    if ($result.Ok) {
        Write-Host "[ok   ] $($result.Message)"
    } else {
        Write-Host "[warn ] 验证未通过：$($result.Message)"
        if ($nonInteractive) {
            Write-Host "[error] 未写入任何文件。确认配置无误后可加 -SkipVerify 强制写入。"
            exit 1
        }
        $go = Read-Host "仍要继续写入配置吗？(y/N)"
        if ($go -notmatch "^[Yy]") { Write-Host "已取消，未写入任何文件。"; exit 1 }
    }
} else {
    Write-Host "[skip ] 跳过连通性验证（-SkipVerify）"
}

# ---- 5. 写入两个 .env（合并写入，不动其他配置）-------------------------------
$bLines = New-EnvList $backendEnv
if ($bLines.Count -eq 0) {
    $bLines.Add("# 主后端本地配置（由 configure_api.ps1 生成；本文件已被 .gitignore 忽略，不会上传 GitHub）")
}
Set-EnvValue $bLines "RAG_PROVIDER" "deepseek"
Set-EnvValue $bLines "DEEPSEEK_BASE_URL" $BaseUrl
Set-EnvValue $bLines "DEEPSEEK_API_KEY" $ApiKey
Set-EnvValue $bLines "DEEPSEEK_MODEL" $Model
Set-EnvValue $bLines "ENABLE_MOCK_ENGINES" "False"
$okB = Write-EnvFile $backendEnv $bLines

$aLines = New-EnvList $agentEnv
if ($aLines.Count -eq 0) {
    $aLines.Add("# 个人端 Agent 本地配置（由 configure_api.ps1 生成；本文件已被 .gitignore 忽略，不会上传 GitHub）")
}
Set-EnvValue $aLines "LLM_BASE_URL" $BaseUrl
Set-EnvValue $aLines "LLM_API_KEY" $ApiKey
Set-EnvValue $aLines "LLM_MODEL" $Model
Set-EnvValue $aLines "ENABLE_MOCK_ENGINES" "False"
$okA = Write-EnvFile $agentEnv $aLines

Write-Host ""
Write-Host "======================================================"
if ($okB) { Write-Host "[ok   ] backend\.env          已写入（RAG 报告将使用真实大模型）" }
if ($okA) { Write-Host "[ok   ] personal-backend\.env 已写入（Agent 对话/推荐将使用真实大模型）" }
Write-Host "------------------------------------------------------"
Write-Host "下一步："
Write-Host "  1. 启动项目（双击 启动项目.bat，或运行 .\start_project.ps1）"
Write-Host "  2. 重新启动后新配置才会生效（服务已在运行的话先停再启）"
Write-Host ""
Write-Host "说明："
Write-Host "  · Key 只存在两个 .env 文件里，两者均已被 .gitignore 忽略，不会上传 GitHub"
Write-Host "  · 换 Key / 换服务商：重新运行本脚本即可（合并写入，不影响其他配置）"
Write-Host "  · 想回到无需 Key 的离线演示模式：.\configure_api.ps1 -RestoreOffline"
Write-Host "======================================================"
