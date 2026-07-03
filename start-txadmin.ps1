$ErrorActionPreference = 'Stop'

# txAdmin for Rust - one-click launcher
# First run: guided setup (server folder, admin account, port), saved to txadmin.config.json
# After that: just starts.

$Root = $PSScriptRoot
$ConfigFile = Join-Path $Root 'txadmin.config.json'
$Entry = Join-Path $Root 'dist\core\index.js'

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host 'Node.js 22+ is required but was not found. Install it from https://nodejs.org' -ForegroundColor Red
    Read-Host 'Press Enter to exit'
    exit 1
}
if (-not (Test-Path -LiteralPath $Entry)) {
    Write-Host "Build not found at $Entry" -ForegroundColor Red
    Write-Host 'If you cloned the repo, run: npm install; npm run build' -ForegroundColor Yellow
    Read-Host 'Press Enter to exit'
    exit 1
}

if (-not (Test-Path -LiteralPath $ConfigFile)) {
    Write-Host ''
    Write-Host '=== txAdmin for Rust - first time setup ===' -ForegroundColor Cyan
    Write-Host ''

    # 1) Rust server folder (auto-detect common locations first)
    $candidates = @(
        (Join-Path $Root 'server'),
        (Join-Path (Split-Path $Root -Parent) 'server'),
        'C:\rustserver\server',
        'C:\rustserver',
        'C:\rust\server',
        'D:\RustServer\server',
        'C:\steamcmd\steamapps\common\rust_dedicated'
    )
    $serverPath = $null
    foreach ($c in $candidates) {
        if (Test-Path -LiteralPath (Join-Path $c 'RustDedicated.exe')) {
            $serverPath = (Resolve-Path -LiteralPath $c).Path
            break
        }
    }
    if ($serverPath) {
        Write-Host "Found a Rust server at: $serverPath" -ForegroundColor Green
        $answer = Read-Host 'Use this folder? (Y/n)'
        if ($answer -match '^[nN]') { $serverPath = $null }
    }
    while (-not $serverPath) {
        $inputPath = Read-Host 'Path to your Rust server folder (the one containing RustDedicated.exe)'
        if ($inputPath -and (Test-Path -LiteralPath (Join-Path $inputPath 'RustDedicated.exe'))) {
            $serverPath = (Resolve-Path -LiteralPath $inputPath).Path
        } else {
            Write-Host 'RustDedicated.exe not found there, try again.' -ForegroundColor Yellow
        }
    }

    # 2) Admin account
    $user = Read-Host 'Admin username [admin]'
    if (-not $user) { $user = 'admin' }
    $pass = Read-Host 'Admin password [leave empty to auto-generate]'
    if (-not $pass) {
        $pass = -join ((48..57) + (97..122) | Get-Random -Count 14 | ForEach-Object { [char]$_ })
        Write-Host ''
        Write-Host "  Generated password: $pass" -ForegroundColor Yellow
        Write-Host '  SAVE IT - you need it to log in to the panel!' -ForegroundColor Yellow
        Write-Host ''
    } elseif ($pass -match ':') {
        Write-Host 'Password cannot contain ":" - please rerun setup.' -ForegroundColor Red
        Read-Host 'Press Enter to exit'
        exit 1
    }

    # 3) Panel port
    $port = Read-Host 'Web panel port [40120]'
    if (-not $port) { $port = '40120' }

    @{
        serverPath = $serverPath
        dataPath = (Join-Path $Root 'txData')
        port = "$port"
        adminUser = $user
        adminPass = $pass
    } | ConvertTo-Json | Set-Content -LiteralPath $ConfigFile -Encoding utf8
    Write-Host "Setup saved to $ConfigFile (delete it to run setup again)" -ForegroundColor Green
    Write-Host ''
}

$cfg = Get-Content -LiteralPath $ConfigFile -Raw | ConvertFrom-Json
$env:TXHOST_DATA_PATH = $cfg.dataPath
$env:TXHOST_SERVER_PATH = $cfg.serverPath
$env:TXHOST_TXA_PORT = "$($cfg.port)"
$env:TXHOST_DEFAULT_ACCOUNT = "$($cfg.adminUser)::$($cfg.adminPass)"

Write-Host "Panel:  http://127.0.0.1:$($cfg.port)   (login: $($cfg.adminUser))" -ForegroundColor Green
node $Entry
exit $LASTEXITCODE
