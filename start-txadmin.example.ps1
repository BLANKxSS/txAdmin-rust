$ErrorActionPreference = 'Stop'

# txAdmin for Rust - launcher (edit the paths/values below, then rename to start-txadmin.ps1)

$env:TXHOST_DATA_PATH = 'C:\rust\txData'        # where txAdmin stores its profile/database
$env:TXHOST_SERVER_PATH = 'C:\rust\server'      # folder containing RustDedicated.exe
$env:TXHOST_TXA_PORT = '40120'                  # web panel port

# Master admin account, format:  username::bcrypt-hash
# Generate a hash with:  node -e "console.log(require('bcryptjs').hashSync('YOUR_PASSWORD', 10))"
$env:TXHOST_DEFAULT_ACCOUNT = 'admin::$2b$10$REPLACE_WITH_YOUR_BCRYPT_HASH'

"Starting txAdmin for Rust on http://127.0.0.1:$($env:TXHOST_TXA_PORT)"
node "$PSScriptRoot\dist\core\index.js"
exit $LASTEXITCODE
