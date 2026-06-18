# PhyFog deploy: GitHub + rw.udclass.top
# Usage: .\deploy.ps1  OR double-click deploy.bat

param(
    [string]$Message = "",
    [switch]$GitOnly,
    [switch]$ServerOnly,
    [switch]$Direct
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

function Get-GitProxyArgs([object]$cfg) {
    if (-not $cfg.gitHttpProxy) { return @() }
    return @("-c", "http.proxy=$($cfg.gitHttpProxy)", "-c", "https.proxy=$($cfg.gitHttpProxy)")
}

function Invoke-GitExe([string]$GitExe, [string[]]$GitArgs, [switch]$AllowFail, [string[]]$ExtraArgs) {
    $all = @()
    if ($ExtraArgs) { $all += $ExtraArgs }
    $all += $GitArgs
    & $GitExe @all
    if ($LASTEXITCODE -ne 0) {
        if ($AllowFail) { return $false }
        throw "git failed: git $($GitArgs -join ' ')"
    }
    return $true
}

function Load-Config {
    $path = Join-Path $Root "deploy.config.json"
    $example = Join-Path $Root "deploy.config.example.json"
    if (-not (Test-Path $path)) {
        if (Test-Path $example) {
            Copy-Item $example $path
            Write-Warn "Created deploy.config.json - edit sshKeyPath then run again."
            exit 1
        }
        throw "Missing deploy.config.json"
    }
    return Get-Content $path -Raw -Encoding UTF8 | ConvertFrom-Json
}

function Get-SshScpArgs([object]$cfg) {
    $port = [int]$cfg.sshPort
    if ($port -le 0) { $port = 22 }
    $sshArgs = @("-p", "$port", "-o", "StrictHostKeyChecking=accept-new", "-o", "ConnectTimeout=30")
    $scpArgs = @("-P", "$port", "-o", "StrictHostKeyChecking=accept-new", "-o", "ConnectTimeout=30")
    if ($cfg.sshKeyPath -and (Test-Path $cfg.sshKeyPath)) {
        $sshArgs += @("-i", $cfg.sshKeyPath)
        $scpArgs += @("-i", $cfg.sshKeyPath)
    }
    $user = $cfg.sshUser
    if (-not $user) { $user = "root" }
    $target = "$user@$($cfg.sshHost)"
    return @{ Ssh = $sshArgs; Scp = $scpArgs; Target = $target }
}

function Invoke-RemoteCmd([object]$cfg, [string]$remoteCmd) {
    $conn = Get-SshScpArgs $cfg
    Write-Ok "Connecting $($conn.Target) ..."
    $sshArgs = $conn.Ssh
    $output = & ssh @sshArgs $conn.Target $remoteCmd 2>&1
    $output | ForEach-Object { Write-Host "   $_" }
    if ($LASTEXITCODE -ne 0) {
        throw "Remote command failed (exit $LASTEXITCODE)"
    }
    return ($output | Out-String)
}

function Deploy-ServerGitPull([object]$cfg) {
    $remotePath = $cfg.remotePath
    if (-not $remotePath) { $remotePath = "/var/www/phyfog" }
    $pm2Name = $cfg.pm2AppName
    if (-not $pm2Name) { $pm2Name = "phyfog" }
    $branch = $cfg.gitBranch
    if (-not $branch) { $branch = "master" }

    $remoteCmd = "set -e; cd '$remotePath'; " +
        "if [ ! -d .git ]; then echo 'ERROR: run server-init.sh first'; exit 1; fi; " +
        "git fetch origin; git reset --hard origin/$branch; " +
        "npm install --production; " +
        "if pm2 describe $pm2Name >/dev/null 2>&1; then pm2 restart $pm2Name; " +
        "else pm2 start server.js --name $pm2Name; fi; " +
        "pm2 save; echo DEPLOY_OK"

    $out = Invoke-RemoteCmd $cfg $remoteCmd
    if ($out -notmatch "DEPLOY_OK") {
        Write-Warn "Deploy may be incomplete, check output above"
    } else {
        Write-Ok "Server updated via git pull, pm2: $pm2Name"
    }
}

function Deploy-ServerDirectUpload([object]$cfg) {
    $scp = Get-Command scp -ErrorAction SilentlyContinue
    if (-not $scp) {
        throw "scp not found. Install OpenSSH Client in Windows Optional Features"
    }

    $remotePath = $cfg.remotePath
    if (-not $remotePath) { $remotePath = "/var/www/phyfog" }
    $pm2Name = $cfg.pm2AppName
    if (-not $pm2Name) { $pm2Name = "phyfog" }
    $conn = Get-SshScpArgs $cfg

    Invoke-RemoteCmd $cfg "mkdir -p '$remotePath'"

    $uploadItems = @(
        "public",
        "server.js",
        "package.json",
        "package-lock.json",
        "map-editor.html"
    )
    if ($cfg.extraUploadItems) {
        $uploadItems += @($cfg.extraUploadItems)
    }

    Write-Ok "Uploading files via SCP (no GitHub needed) ..."
    foreach ($item in $uploadItems) {
        $local = Join-Path $Root $item
        if (-not (Test-Path $local)) { continue }
        $scpArgs = $conn.Scp
        & scp @scpArgs -r $local "$($conn.Target):$remotePath/"
        if ($LASTEXITCODE -ne 0) {
            throw "scp failed for $item"
        }
        Write-Ok "  uploaded: $item"
    }

    $remoteCmd = "set -e; cd '$remotePath'; npm install --production; " +
        "if pm2 describe $pm2Name >/dev/null 2>&1; then pm2 restart $pm2Name; " +
        "else pm2 start server.js --name $pm2Name; fi; " +
        "pm2 save; echo DEPLOY_OK"

    $out = Invoke-RemoteCmd $cfg $remoteCmd
    if ($out -notmatch "DEPLOY_OK") {
        Write-Warn "Deploy may be incomplete, check output above"
    } else {
        Write-Ok "Server updated via direct upload, pm2: $pm2Name"
    }
}

function Push-GitRepo([object]$cfg, [string]$GitExe, [string]$Message) {
    $branch = $cfg.gitBranch
    if (-not $branch) { $branch = "master" }
    $remote = $cfg.gitRemote
    if (-not $remote) { $remote = "origin" }
    $proxyArgs = Get-GitProxyArgs $cfg

    if ($cfg.gitPushUrl) {
        Write-Ok "Using git push url: $($cfg.gitPushUrl)"
        Invoke-GitExe $GitExe @("remote", "set-url", $remote, $cfg.gitPushUrl) -ExtraArgs $proxyArgs | Out-Null
    }

    if ($cfg.gitHttpProxy) {
        $env:HTTP_PROXY = $cfg.gitHttpProxy
        $env:HTTPS_PROXY = $cfg.gitHttpProxy
        Write-Ok "Git proxy: $($cfg.gitHttpProxy)"
    }

    Invoke-GitExe $GitExe @("add", "-A") -ExtraArgs $proxyArgs | Out-Null
    $status = & $GitExe @($proxyArgs + @("status", "--porcelain"))
    if ($status) {
        $prefix = $cfg.commitMessagePrefix
        if (-not $prefix) { $prefix = "deploy" }
        if ($Message) { $msg = $Message } else { $msg = "$prefix $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" }
        Invoke-GitExe $GitExe @("commit", "-m", $msg) -ExtraArgs $proxyArgs | Out-Null
        Write-Ok "Committed: $msg"
    } else {
        Write-Warn "No local changes, skip commit"
    }

    $pushed = Invoke-GitExe $GitExe @("push", $remote, $branch) -AllowFail -ExtraArgs $proxyArgs
    if (-not $pushed) {
        return $false
    }
    Write-Ok "Pushed to $remote/$branch"
    return $true
}

Write-Host "========================================" -ForegroundColor Magenta
Write-Host "  PhyFog Deploy -> rw.udclass.top" -ForegroundColor Magenta
Write-Host "========================================" -ForegroundColor Magenta

$cfg = Load-Config
$gitExe = Find-Git

$deployMode = $cfg.deployMode
if (-not $deployMode) { $deployMode = "direct" }
if ($Direct) { $deployMode = "direct" }

$gitPushOk = $true

# --- 1. Git push (optional) ---
if (-not $ServerOnly -and -not $cfg.skipGitPush -and $deployMode -ne "direct") {
    Write-Step "Push to Git repository"
    if (-not $gitExe) {
        Write-Err "Git not found."
        exit 1
    }
    try {
        $gitPushOk = Push-GitRepo $cfg $gitExe $Message
    } catch {
        $gitPushOk = $false
        Write-Warn $_.Exception.Message
    }
    if (-not $gitPushOk) {
        Write-Warn "GitHub unreachable (common in CN). Will use direct upload to server."
        if (-not $cfg.fallbackDirectDeploy -and $deployMode -eq "git") {
            if ($cfg.skipServerDeploy) { exit 1 }
        }
    }
} elseif (-not $ServerOnly -and -not $cfg.skipGitPush -and $deployMode -eq "direct") {
    Write-Step "Git commit only (direct deploy mode, skip push)"
    if ($gitExe) {
        try {
            Invoke-GitExe $gitExe @("add", "-A") | Out-Null
            $status = & $gitExe status --porcelain
            if ($status) {
                $prefix = $cfg.commitMessagePrefix
                if (-not $prefix) { $prefix = "deploy" }
                if ($Message) { $msg = $Message } else { $msg = "$prefix $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" }
                Invoke-GitExe $gitExe @("commit", "-m", $msg) | Out-Null
                Write-Ok "Local commit: $msg (not pushed)"
            }
        } catch {
            Write-Warn "Local git commit skipped: $($_.Exception.Message)"
        }
    }
}

# --- 2. Server deploy ---
if (-not $GitOnly -and -not $cfg.skipServerDeploy) {
    Write-Step "Deploy to server $($cfg.sshHost)"

    if ($deployMode -eq "direct" -or -not $gitPushOk) {
        Deploy-ServerDirectUpload $cfg
    } else {
        Deploy-ServerGitPull $cfg
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Magenta
Write-Host "  Done: https://$($cfg.sshHost)" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Magenta
Write-Host ""
