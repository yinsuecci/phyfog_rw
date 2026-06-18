# 将 deploy.ps1 打包为 Deploy.exe（需联网安装 ps2exe）
# 用法: .\build-deploy-exe.ps1

$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot

Write-Host "安装 ps2exe-module..." -ForegroundColor Cyan
Install-Module ps2exe -Scope CurrentUser -Force -AllowClobber

$out = Join-Path $Root "Deploy.exe"
if (Test-Path $out) { Remove-Item $out -Force }

Invoke-ps2exe `
  -inputFile (Join-Path $Root "deploy.ps1") `
  -outputFile $out `
  -title "PhyFog Deploy" `
  -description "同步 GitHub 并部署到 rw.udclass.top" `
  -company "PhyFog" `
  -product "PhyFog Deploy" `
  -requireAdmin:$false `
  -noConsole:$false

Write-Host "Generated: $out" -ForegroundColor Green
Write-Host "Run Deploy.exe after configuring deploy.config.json"
