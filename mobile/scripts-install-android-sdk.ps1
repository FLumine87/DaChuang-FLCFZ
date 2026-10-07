# 便携安装 Android SDK（无需管理员）
# 注意：sdkmanager 的参数里带分号（platforms;android-35），必须经 cmd.exe 原样传递，
#       直接用 PowerShell 调用 .bat 会被吞掉分号 → 报 "Package platforms not found"。
$ErrorActionPreference = 'Stop'
$sdk = "$env:LOCALAPPDATA\Android\Sdk"
$clt = "$sdk\cmdline-tools\latest"
$sdkman = "$clt\bin\sdkmanager.bat"
$env:JAVA_HOME = 'C:\aaa\JAVA\jdk-17.0.2'

if (-not (Test-Path $sdkman)) { throw "sdkmanager 不存在：$sdkman" }

Write-Host "=== 安装 platform-tools / platforms;android-35 / build-tools;35.0.0 ==="
$cmdLine = '--sdk_root="' + $sdk + '" "platform-tools" "platforms;android-35" "build-tools;35.0.0"'
cmd.exe /c "`"$sdkman`" $cmdLine"
if ($LASTEXITCODE -ne 0) { throw "sdkmanager 失败，退出码 $LASTEXITCODE" }

Write-Host "=== 接受许可协议 ==="
cmd.exe /c "echo y| `"$sdkman`" --sdk_root=`"$sdk`" --licenses"

Write-Host "=== 安装结果 ==="
foreach ($d in @('platforms', 'build-tools', 'platform-tools')) {
  $p = Join-Path $sdk $d
  if (Test-Path $p) {
    Get-ChildItem $p | ForEach-Object { Write-Host ("  " + $d + " -> " + $_.Name) }
  }
}
Write-Host "ANDROID SDK 就绪: $sdk"
