# PhyFog — 启动游戏服务器 + ngrok 内网穿透
# 用法：在 PowerShell 中运行 .\start-ngrok.ps1

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

if (-not $env:NGROK_AUTHTOKEN) {
  Write-Host "请先设置 ngrok 令牌：" -ForegroundColor Yellow
  Write-Host '  $env:NGROK_AUTHTOKEN = "你的authtoken"' -ForegroundColor Cyan
  Write-Host "获取地址: https://dashboard.ngrok.com/get-started/your-authtoken" -ForegroundColor Gray
  exit 1
}

if (-not (Get-Command ngrok -ErrorAction SilentlyContinue)) {
  Write-Host "未找到 ngrok。请安装: https://ngrok.com/download 或 choco install ngrok" -ForegroundColor Red
  exit 1
}

Write-Host "启动 PhyFog 服务器 (端口 3000)..." -ForegroundColor Green
$serverJob = Start-Job -ScriptBlock {
  Set-Location $using:root
  node server.js
}

Start-Sleep -Seconds 2

Write-Host "启动 ngrok 隧道..." -ForegroundColor Green
Write-Host "将下方 Forwarding 地址发给其他玩家（服务器地址栏填写该 https 地址）" -ForegroundColor Yellow
Write-Host ""

Push-Location $root
try {
  ngrok start phyfog --config ngrok.yml
} finally {
  Pop-Location
  Stop-Job $serverJob -ErrorAction SilentlyContinue
  Remove-Job $serverJob -ErrorAction SilentlyContinue
}
