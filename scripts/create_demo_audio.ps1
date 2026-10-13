$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
    $voice = $synth.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -eq 'zh-CN' } | Select-Object -First 1
    if ($voice) { $synth.SelectVoice($voice.VoiceInfo.Name) }
    $output = Join-Path $PSScriptRoot '..\frontend\public\agent-demo\diary.wav'
    $synth.SetOutputToWaveFile([IO.Path]::GetFullPath($output))
    $synth.Speak('这周课程比较多，我想整理一下学习计划，周末和同学一起散步。这是一段项目演示的合成语音。')
    $synth.SetOutputToNull()
} finally {
    $synth.Dispose()
}
