$ErrorActionPreference = 'Stop'
$env:DEMAND_CODEX_BIN = (Get-Command codex -ErrorAction Stop).Source
Write-Host '本机助手运行期间，请保持此窗口开启。关闭窗口即停止。'
node (Join-Path $PSScriptRoot 'server.cjs')
