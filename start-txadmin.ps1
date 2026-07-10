$ErrorActionPreference = 'Stop'

# txAdmin for Rust - one-click launcher, no prompts.
# Rust server folder / admin account / port are configured in-browser
# via the first-run Setup Wizard - this script just starts the app.

$Root = $PSScriptRoot
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

$env:TXHOST_DATA_PATH = Join-Path $Root 'txData'
if (-not $env:TXHOST_TXA_PORT) { $env:TXHOST_TXA_PORT = '38015' }

Write-Host "Panel: http://127.0.0.1:$($env:TXHOST_TXA_PORT)   (first run opens the Setup Wizard)" -ForegroundColor Green
node $Entry
exit $LASTEXITCODE
