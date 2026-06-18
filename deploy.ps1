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
        "D:\Git\cmd\git.exe",
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

function Resolve-SshKeyPath([object]$cfg) {
    if ($cfg.sshKeyPath -and (Test-Path $cfg.sshKeyPath)) {
        return $cfg.sshKeyPath
    }
    $candidates = @(
        "$env:USERPROFILE\.ssh\id_ed25519",
        "$env:USERPROFILE\.ssh\id_rsa",
        "$env:USERPROFILE\.ssh\id_ed25519_phyfog"
    )
    foreach ($p in $candidates) {
        if (Test-Path $p) { return $p }
    }
    return $null
}

function Get-DefaultUploadItems() {
    return @(
        "public",
        "server.js",
        "serverGame.mjs",
        "package.json",
        "package-lock.json",
        "map-editor.html"
    )
}

function Get-SshScpArgs([object]$cfg) {
    $port = [int]$cfg.sshPort
    if ($port -le 0) { $port = 22 }
    $controlPath = Join-Path $env:TEMP "phyfog-ssh-$($cfg.sshHost)-$port"
    $commonOpts = @(
        "-o", "StrictHostKeyChecking=accept-new",
        "-o", "ConnectTimeout=30",
        "-o", "ControlMaster=auto",
        "-o", "ControlPath=$controlPath",
        "-o", "ControlPersist=120"
    )
    $sshArgs = @("-p", "$port") + $commonOpts
    $scpArgs = @("-P", "$port") + $commonOpts
    $keyPath = Resolve-SshKeyPath $cfg
    if ($keyPath) {
        $sshArgs += @("-i", $keyPath)
        $scpArgs += @("-i", $keyPath)
    }
    $user = $cfg.sshUser
    if (-not $user) { $user = "root" }
    $target = "$user@$($cfg.sshHost)"
    return @{ Ssh = $sshArgs; Scp = $scpArgs; Target = $target; KeyPath = $keyPath; ControlPath = $controlPath }
}

function Invoke-NativeCmd([string]$Exe, [string[]]$CommandArgs) {
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $lines = & $Exe @CommandArgs 2>&1 | ForEach-Object {
            if ($_ -is [System.Management.Automation.ErrorRecord]) {
                if ($_.Exception.Message) { $_.Exception.Message } else { $_.ToString() }
            } else {
                "$_"
            }
        }
        return @{ Output = $lines; ExitCode = $LASTEXITCODE }
    } finally {
        $ErrorActionPreference = $prevEap
    }
}

function Invoke-RemoteCmd([object]$cfg, [string]$remoteCmd) {
    $conn = Get-SshScpArgs $cfg
    Write-Ok "Connecting $($conn.Target) ..."
    $sshArgs = $conn.Ssh
    $result = Invoke-NativeCmd -Exe "ssh" -CommandArgs ($sshArgs + @($conn.Target, $remoteCmd))
    $result.Output | ForEach-Object { Write-Host "   $_" }
    if ($result.ExitCode -ne 0) {
        throw "Remote command failed (exit $($result.ExitCode))"
    }
    return ($result.Output | Out-String)
}

function Deploy-ServerGitPull([object]$cfg) {
    $remotePath = $cfg.remotePath
    if (-not $remotePath) { $remotePath = "/var/www/phyfog" }
    $pm2Name = $cfg.pm2AppName
    if (-not $pm2Name) { $pm2Name = "phyfog" }
    $branch = $cfg.gitBranch
    if (-not $branch) { $branch = "master" }
    $conn = Get-SshScpArgs $cfg
    if ($conn.KeyPath) {
        Write-Ok "SSH key: $($conn.KeyPath)"
    } else {
        Write-Warn "No SSH key configured. Password may be required."
    }

    $remoteCmd = "set -e; cd '$remotePath'; " +
        "if [ ! -d .git ]; then echo 'ERROR: run server-init.sh on server first'; exit 1; fi; " +
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

    if ($conn.KeyPath) {
        Write-Ok "SSH key: $($conn.KeyPath)"
    } else {
        Write-Warn "No SSH key found. You may need to enter the server password 1-2 times."
        Write-Warn "Tip: run ssh-keygen and set sshKeyPath in deploy.config.json"
    }

    $uploadItems = Get-DefaultUploadItems
    if ($cfg.extraUploadItems) {
        $uploadItems += @($cfg.extraUploadItems)
    }

    $localPaths = @()
    foreach ($item in $uploadItems) {
        $local = Join-Path $Root $item
        if (Test-Path $local) { $localPaths += $local }
    }
    if ($localPaths.Count -eq 0) {
        throw "No files to upload"
    }

    Write-Ok "Uploading $($localPaths.Count) item(s) in one SCP batch ..."
    $scpArgs = $conn.Scp + @("-r") + $localPaths + @("$($conn.Target):$remotePath/")
    $result = Invoke-NativeCmd -Exe "scp" -CommandArgs $scpArgs
    $result.Output | ForEach-Object { Write-Host "   $_" }
    if ($result.ExitCode -ne 0) {
        throw "scp batch upload failed"
    }
    foreach ($item in $uploadItems) {
        if (Test-Path (Join-Path $Root $item)) {
            Write-Ok "  included: $item"
        }
    }

    $remoteCmd = "set -e; mkdir -p '$remotePath'; cd '$remotePath'; npm install --production; " +
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
Write-Host "  PhyFog Deploy" -ForegroundColor Magenta
Write-Host "========================================" -ForegroundColor Magenta

$cfg = Load-Config
$gitExe = Find-Git

$deployMode = $cfg.deployMode
if (-not $deployMode) { $deployMode = "direct" }
if ($Direct) { $deployMode = "direct" }

$gitPushOk = $true

# --- 1. Git push ---
if (-not $ServerOnly -and -not $cfg.skipGitPush) {
    Write-Step "Push to GitHub"
    if (-not $gitExe) {
        Write-Err "Git not found."
        $gitPushOk = $false
        if ($deployMode -eq "git" -and -not $cfg.fallbackDirectDeploy) { exit 1 }
    } else {
        try {
            $gitPushOk = Push-GitRepo $cfg $gitExe $Message
        } catch {
            $gitPushOk = $false
            Write-Warn $_.Exception.Message
        }
    }
    if (-not $gitPushOk) {
        Write-Warn "GitHub push failed. Server will use direct SCP upload if enabled."
        if (-not $cfg.fallbackDirectDeploy -and $deployMode -eq "git") {
            if ($cfg.skipServerDeploy) { exit 1 }
        }
    }
}

# --- 2. Server deploy ---
if (-not $GitOnly -and -not $cfg.skipServerDeploy) {
    Write-Step "Deploy to server $($cfg.sshHost)"

    if ($deployMode -eq "direct" -or -not $gitPushOk) {
        Deploy-ServerDirectUpload $cfg
    } else {
        try {
            Deploy-ServerGitPull $cfg
        } catch {
            if ($cfg.fallbackDirectDeploy) {
                Write-Warn "Server git pull failed, falling back to SCP upload"
                Deploy-ServerDirectUpload $cfg
            } else {
                throw
            }
        }
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Magenta
Write-Host "  Done: https://$($cfg.sshHost)" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Magenta
Write-Host ""
