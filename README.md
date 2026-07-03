<div align="center">

# txAdmin for Rust

**A full-featured web panel to manage & monitor your Rust (the game) dedicated server**

Fork of [tabarra/txAdmin](https://github.com/tabarra/txAdmin) (the FiveM server manager),
converted to run as a **standalone Node.js app** managing **RustDedicated** via WebRCON —
no FXServer, no FiveM.

</div>

## Features

- 🖥️ **Server control** — start/stop/restart RustDedicated, crash detection & auto-restart
- ⏰ **Restart scheduler** — scheduled restarts with chat warnings and an **in-game HUD countdown**
- 📟 **Live Console** — real-time colored console (SERVER / PLUGIN / CHAT / WARN / ERROR badges) with command input
- 👥 **Players** — live playerlist, player history, warns/kicks/bans (persisted to Rust's own banlist too), play time, notes
- 📉 **Player Drops** — drop analytics with real disconnect reasons (player quit / timeout / kicked)
- 📜 **Server Log** — joins, disconnects, chat messages, and deaths, streamed live
- 🧩 **Plugins** — manage installed Oxide/uMod plugins + **Browse Plugins** catalog with the uMod API (search, sort, one-click install, hot-reload) and install-from-URL for other sources
- 🛡️ **Groups & Permissions** — Discord-roles-style manager for Oxide groups: create groups, toggle any plugin permission, manage members; permissions auto-track loaded plugins
- 📊 **Dashboard** — server tick performance charts, player count history, memory, host CPU/RAM
- 🎮 **In-game admin menu** — `/admin` opens a CUI menu (kick/ban) via the bundled `TxAdminMenu.cs` plugin
- 📢 **Announcements** — broadcast to chat + on-screen banner via the bundled `TxAdminPanel.cs` (Magic Panel integration)
- 🤖 **Discord bot**, admin management with granular permissions, action history, and more from upstream txAdmin

## Requirements

- Windows (tested on Windows Server 2022)
- [Node.js](https://nodejs.org/) v22+ (v24 recommended)
- A Rust dedicated server install (SteamCMD app `258550`) with [Oxide/uMod](https://umod.org/)
- The Rust server must run with `+rcon.web 1` (txAdmin passes this automatically when it spawns the server)

## Install

### From a release (recommended)

Download the latest zip from [Releases](https://github.com/BLANKxSS/txAdmin-rust/releases),
extract it anywhere, then create a launcher script (see below) and run it.

### From source

```powershell
git clone https://github.com/BLANKxSS/txAdmin-rust.git
cd txAdmin-rust
npm install
npm run build
```

### Launcher script

```powershell
# start-txadmin.ps1 (adjust paths/ports)
$env:TXHOST_DATA_PATH = 'C:\rust\txData'        # where txAdmin stores its profile/database
$env:TXHOST_SERVER_PATH = 'C:\rust\server'      # folder containing RustDedicated.exe
$env:TXHOST_TXA_PORT = '40120'                  # web panel port
# master admin account (username::bcrypt-hash) - generate a hash with:
#   node -e "console.log(require('bcryptjs').hashSync('YOUR_PASSWORD', 10))"
$env:TXHOST_DEFAULT_ACCOUNT = 'admin::$2b$10$REPLACE_WITH_YOUR_BCRYPT_HASH'
node .\dist\core\index.js
```

Then open `http://127.0.0.1:40120`, log in, and set your server folder, ports, and RCON
password in **Settings → Server**. txAdmin spawns and supervises the Rust server itself.

### Optional in-game plugins

Copy from [`rust-plugins/`](rust-plugins/) into `<your server>\oxide\plugins`:
- `TxAdminMenu.cs` — in-game `/admin` menu. Grant access: `oxide.grant group admin txadminmenu.use`
- `TxAdminPanel.cs` — restart countdown + announcement banners (requires the
  [Magic Panel](https://umod.org/plugins/magic-panel) plugin)

## How it works

| txAdmin (FiveM) | This fork (Rust) |
|---|---|
| Runs inside FXServer's Node runtime | Standalone Node app |
| stdin/fd3 pipes to FXServer | Persistent **WebRCON** websocket |
| In-game resource pushes player events | 15s `global.status` polling + console stream parsing |
| HTTP healthchecks + resource heartbeats | `serverinfo` RCON polling |
| NUI (embedded Chromium) in-game menu | Oxide **CUI** plugins |
| License-based player database | **SteamID64**-keyed player database |

## Credits & License

This project is a derivative of [txAdmin](https://github.com/tabarra/txAdmin) by
André Tabarra and contributors, used under the MIT License (see [LICENSE](LICENSE)).
All the original architecture, UI, and most of the code are their work — this fork
replaces the FiveM/FXServer integration layer with a Rust/WebRCON one.
