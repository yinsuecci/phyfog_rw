# PhyFog deploy: GitHub + rw.udclass.top
# Usage: .\deploy.ps1  OR double-click deploy.bat

param(
    [string]$Message = "",
    [switch]$GitOnly,
    [switch]$ServerOnly
)

$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
Set-Location $Root

function Write-Step([string]$text) {
    Write-Host ""
    Write-Host ">> $text" -ForegroundColor Cyan
}

function Write-Ok([string]$text) {
    Write-Host "   $text" -ForegroundColor Green
}

function Write-Warn([string]$text) {
    Write-Host "   $text" -ForegroundColor Yellow
}

function Write-Err([string]$text) {
    Write-Host "   $text" -ForegroundColor Red
}

function Find-Git {
    $cmd = Get-Command git -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $candidates = @(
        "$env:ProgramFiles\Git\cmd\git.exe",
        "${env:ProgramFiles(x86)}\Git\cmd\git.exe",
        "$env:LOCALAPPDATA\Programs\Git\cmd\git.exe"
    )
    foreach ($p in $candidates) {
        if (Test-Path $p) { return $p }
    }
    return $null
}

function Invoke-GitExe([string]$GitExe, [string[]]$GitArgs) {
    & $GitExe @GitArgs
    if ($LASTEXITCODE -ne 0) {
        throw "git failed: git $($GitArgs -join ' ')"
    }
}

function Load-Config {
    $path = Join-Path $Root "deploy.config.json"
    $example = Join-Path $Root "deploy.config.example.json"
    if (-not (Test-Path $path)) {
        if (Test-Path $example) {
            Copy-Item $example $path
            Write-Warn "Created deploy.config.json - edit SSH key path then run again."
            exit 1
        }
        throw "Missing deploy.config.json"
    }
    return Get-Content $path -Raw -Encoding UTF8 | ConvertFrom-Json
}

Write-Host "========================================" -ForegroundColor Magenta
Write-Host "  PhyFog Deploy -> GitHub + rw.udclass.top" -ForegroundColor Magenta
Write-Host "========================================" -ForegroundColor Magenta

$cfg = Load-Config
$gitExe = Find-Git

# --- 1. Git push ---
if (-not $ServerOnly -and -not $cfg.skipGitPush) {
    Write-Step "Push to Git repository"
    if (-not $gitExe) {
        Write-Err "Git not found. Install from https://git-scm.com/download/win"
        exit 1
    }

    $branch = $cfg.gitBranch
    if (-not $branch) { $branch = "master" }
    $remote = $cfg.gitRemote
    if (-not $remote) { $remote = "origin" }

    Invoke-GitExe $gitExe @("add", "-A")
    $status = & $gitExe status --porcelain
    if ($status) {
        $prefix = $cfg.commitMessagePrefix
        if (-not $prefix) { $prefix = "deploy" }
        if ($Message) {
            $msg = $Message
        } else {
            $msg = "$prefix $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
        }
        Invoke-GitExe $gitExe @("commit", "-m", $msg)
        Write-Ok "Committed: $msg"
    } else {
        Write-Warn "No local changes, skip commit"
    }

    Invoke-GitExe $gitExe @("push", $remote, $branch)
    Write-Ok "Pushed to $remote/$branch"
}

# --- 2. SSH deploy ---
if (-not $GitOnly -and -not $cfg.skipServerDeploy) {
    Write-Step "Deploy to server $($cfg.sshHost)"

    $ssh = Get-Command ssh -ErrorAction SilentlyContinue
    if (-not $ssh) {
        Write-Err "ssh not found. Install OpenSSH Client in Windows Optional Features"
        exit 1
    }

    $hostName = $cfg.sshHost
    $user = $cfg.sshUser
    if (-not $user) { $user = "root" }
    $port = [int]$cfg.sshPort
    if ($port -le 0) { $port = 22 }
    $remotePath = $cfg.remotePath
    if (-not $remotePath) { $remotePath = "/var/www/phyfog" }
    $pm2Name = $cfg.pm2AppName
    if (-not $pm2Name) { $pm2Name = "phyfog" }
    $branch = $cfg.gitBranch
    if (-not $branch) { $branch = "master" }

    $sshArgs = @("-p", "$port", "-o", "StrictHostKeyChecking=accept-new")
    if ($cfg.sshKeyPath -and (Test-Path $cfg.sshKeyPath)) {
        $sshArgs += @("-i", $cfg.sshKeyPath)
    }

    $remoteCmd = "set -e; cd '$remotePath'; " +
        "if [ ! -d .git ]; then echo 'ERROR: run server-init.sh first'; exit 1; fi; " +
        "git fetch origin; git reset --hard origin/$branch; " +
        "npm install --production; " +
        "if pm2 describe $pm2Name >/dev/null 2>&1; then pm2 restart $pm2Name; " +
        "else pm2 start server.js --name $pm2Name; fi; " +
        "pm2 save; echo DEPLOY_OK"

    $target = "${user}@${hostName}"
    Write-Ok "Connecting $target ..."

    $output = & ssh @sshArgs $target $remoteCmd 2>&1
    $output | ForEach-Object { Write-Host "   $_" }
    if ($LASTEXITCODE -ne 0) {
        Write-Err "Server deploy failed (exit $LASTEXITCODE)"
        exit 1
    }
    $outText = $output | Out-String
    if ($outText -notmatch "DEPLOY_OK") {
        Write-Warn "Deploy may be incomplete, check output above"
    } else {
        Write-Ok "Server updated, pm2 restarted: $pm2Name"
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Magenta
Write-Host "  Done: https://$($cfg.sshHost)" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Magenta
Write-Host ""
