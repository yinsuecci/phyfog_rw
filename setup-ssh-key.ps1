# One-time: generate SSH key and copy to server (run once, then deploy needs no password)
param(
    [string]$ServerHost = "",
    [string]$ServerUser = "root"
)

$Root = $PSScriptRoot
$configPath = Join-Path $Root "deploy.config.json"
if (-not $ServerHost -and (Test-Path $configPath)) {
    $cfg = Get-Content $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $ServerHost = $cfg.sshHost
    if ($cfg.sshUser) { $ServerUser = $cfg.sshUser }
}
if (-not $ServerHost) {
    Write-Host "Usage: .\setup-ssh-key.ps1 -ServerHost 64.90.1.57"
    exit 1
}

$keyPath = Join-Path $env:USERPROFILE ".ssh\id_ed25519_phyfog"
$keyPub = "$keyPath.pub"
$sshDir = Split-Path $keyPath -Parent
if (-not (Test-Path $sshDir)) { New-Item -ItemType Directory -Path $sshDir | Out-Null }

if (-not (Test-Path $keyPath)) {
    Write-Host ">> Generating key: $keyPath"
    ssh-keygen -t ed25519 -f $keyPath -N '""' -C "phyfog-deploy"
} else {
    Write-Host ">> Key already exists: $keyPath"
}

Write-Host ">> Copy public key to ${ServerUser}@${ServerHost} (enter server password once)"
$pub = Get-Content $keyPub -Raw
ssh -o StrictHostKeyChecking=accept-new "${ServerUser}@${ServerHost}" "mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo '$($pub.Trim())' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && echo KEY_OK"
if ($LASTEXITCODE -ne 0) {
    Write-Host "[FAILED] Could not install key on server" -ForegroundColor Red
    exit 1
}

if (Test-Path $configPath) {
    $json = Get-Content $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $json.sshKeyPath = $keyPath
    $json | ConvertTo-Json -Depth 5 | Set-Content $configPath -Encoding UTF8
    Write-Host ">> Updated deploy.config.json sshKeyPath"
}

Write-Host "[OK] SSH key ready. Run deploy.bat — no password needed." -ForegroundColor Green
