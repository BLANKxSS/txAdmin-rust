# txAdmin → Rust (RustDedicated) conversion spec

Mission: convert this fork of txAdmin from managing FiveM's FXServer to managing a
**Rust (the game) dedicated server** (`RustDedicated.exe`) on Windows, running as a
**standalone Node.js app** (no FXServer runtime, no natives, no NUI, no in-game resource).

This is a coordinated multi-agent effort. Each agent owns ONLY the files in its section.
The integrator (main session) owns: `core/txAdmin.ts`, `core/index.ts`, `package.json`,
build scripts, and final wiring. **Never edit files outside your section.**

## Ground rules (all agents)

1. TypeScript, ESM, existing code style. Path aliases: `@core/*`, `@lib/*`, `@modules/*`,
   `@routes/*`, `@shared/*` (see `core/tsconfig.json`).
2. **Keep public APIs stable**: do not rename exported classes, public methods, public
   properties, or their return shapes — dozens of routes/modules depend on them. Change
   internals only. If a public method is truly meaningless for Rust, keep the signature
   and return a sensible inert value, marked with a `//RUSTTODO:` comment.
3. When FiveM functionality has no Rust equivalent, stub it (compile-safe, runtime-safe,
   returns empty/no-op) with `//RUSTTODO:` — do NOT delete exports others import.
4. No new npm dependencies. Node is v24: global `fetch` and `WebSocket` are available.
5. Do not run npm install / builds / dev servers. If `node_modules` exists you may run
   `npm run typecheck -w core` (or `-w panel`) to self-check; fix errors in YOUR files only.
6. Do NOT touch: `core/txAdmin.ts`, `core/index.ts`, `core/txManager.ts`, root/workspace
   `package.json`, `scripts/`, `locale/`, `web/`, or another agent's files.
7. Windows target. The repo lives at `D:\RustServer\admin\txAdmin`.

## Target environment facts

- Rust server dir: `D:/RustServer/server`, exe `RustDedicated.exe`
- Server identity: `main` (config lives in `server/main/cfg/server.cfg` under the server dir)
- Ports: game UDP 28015, RCON TCP/WebSocket 28016 (`+rcon.web 1`), query UDP 28017
- Default RCON password: set per-install via the panel settings (never commit a real one)
- txAdmin data dir default: `D:/RustServer/txData`
- Launch args reference (current start-server.ps1):
  `-batchmode -logfile <file> +server.port 28015 +server.queryport 28017 +server.identity main +rcon.port 28016 +rcon.password <pw> +rcon.web 1`
  When txAdmin spawns the server itself, do NOT pass `-logfile` — keep output on stdout
  so the existing logger pipeline captures it.

## Rust WebRCON protocol (replaces FXServer stdin/fd3/HTTP endpoints)

- Connect: `ws://127.0.0.1:<rconPort>/<rconPassword>`
- Send: `JSON.stringify({ Identifier: <int>, Message: "<command>", Name: "txAdmin" })`
- Receive: JSON `{ Identifier, Message, Type, Stacktrace }`. `Identifier` matches the
  request id for command responses; `0`/`-1` (or unknown ids) are unsolicited console
  broadcast lines. `Type` ∈ `Generic|Warning|Error|Chat`.
- Useful commands:
  - `serverinfo` → Message is a JSON string:
    `{ Hostname, MaxPlayers, Players, Queued, Joining, EntityCount, GameTime, Uptime(sec),
       Map, Framerate, Memory(MB), Collections, NetworkIn, NetworkOut, Restarting, SaveCreatedTime }`
  - `global.status` → text; player lines match:
    `/^\s*(\d{17})\s+"([^"]*)"\s+(\d+)\s+([\d.]+s)\s+(\S+)/` → steamId64, name, ping, connected, ip:port
  - `say <msg>` (broadcast chat), `kick <steamid> "<reason>"`, `banid <steamid> "<name>" "<reason>"`,
    `unban <steamid>`, `server.writecfg`, `quit` (graceful save + exit)
- SteamID64 → txAdmin identifier: `steam:<steamId64 as lowercase hex>` (`BigInt(id).toString(16)`),
  which is already a valid identifier format in `@lib/player/idUtils`.

## New shared module contract: `txCore.rustRcon`

Agent 2 creates `core/modules/RustRcon/index.ts` (default-export class `RustRcon`, registered
by the integrator in txAdmin.ts as `rustRcon`). Everyone else may rely on this interface:

```ts
class RustRcon {
    get isConnected(): boolean;
    // resolves with the response Message; rejects on timeout/disconnected
    sendCommand(command: string, timeoutMs?: number): Promise<string>;  // default 10_000
    // event subscription for unsolicited console lines:
    onMessage(listener: (line: { type: string; message: string }) => void): void;
    onStatusChange(listener: (connected: boolean) => void): void;
    // lifecycle, called by FxRunner on spawn/kill:
    connect(): void;      // starts connect + auto-reconnect loop (10s), reads config
    disconnect(): void;   // stops reconnecting, closes socket
}
```

---

## AGENT 1 — Standalone boot (remove FXServer runtime deps)

Owned files:
- `core/boot/getNativeVars.ts` — REWRITE. No `GetConvar`/`GetCurrentResourceName`/etc.
  Return the same shape using: `fxsVersion: 'standalone'`,
  `fxsCitizenRoot: process.env.TXHOST_SERVER_PATH ?? 'D:/RustServer/server'`,
  `resourceName: 'txAdmin'`, `txaResourceVersion` read from the repo root `package.json`
  ("version" field), `txaResourcePath` = repo root (derive from
  `path.resolve(fileURLToPath(import.meta.url), '../../..')`), and the legacy vars
  (`txAdminProfile`, `txDataPath`, `txAdminPort`, `txAdminInterface`) from
  `process.env.TXADMIN_PROFILE / TXHOST_DATA_PATH / TXHOST_TXA_PORT / TXHOST_INTERFACE`.
- `core/globalData.ts` — remove the fxserver version parsing + minimum version fatal check
  (delete the `parseFxserverVersion` import/usage; set `const fxsVersion = 99999` and
  `let fxsVersionTag = 'Rust/Win'`, keep the provider tag logic harmless). Set default
  `dataPath` to `D:/RustServer/txData` (keep the TXHOST_DATA_PATH override plumbing).
  Everything else (zap vars, host vars, ports, defaults) stays.
- `core/global.d.ts` — delete ONLY the FXServer native function declarations
  (`GetConvar`, `GetCurrentResourceName`, `GetResourceMetadata`, `GetResourcePath`,
  `IsDuplicityVersion`, `ExecuteCommand`, `PrintStructuredTrace`, etc.).
  KEEP the `txCore`/`txConfig`/`txManager` global declarations and everything else.
- `core/boot/checkPreRelease.ts` — make the expiration logic a no-op (keep export).
- `core/boot/startReadyWatcher.ts` — remove any fxserver file/convar checks; it should
  still end by calling the same ready-signal it does today.
- `core/lib/fxserver/serverData.ts` — resource scanning: keep exports, return empty results.
- `core/lib/fxserver/scanMonitorFiles.ts` — keep export, return empty/null result.
- `core/lib/fxserver/runtimeFiles.ts` — `setRuntimeFile` and friends become no-ops that
  report success.
- `core/lib/fxserver/fxsConfigHelper.ts` — keep `resolveCFGFilePath` (pure path logic).
  Any FXServer cfg validation (`validateFixServerConfig` etc.) must keep its export and
  return "valid / no issues" so the CFG editor becomes a plain text editor.
- `core/lib/fxserver/fxsVersionParser.ts` + its `.test.ts` — DELETE both, and remove the
  import from `core/globalData.ts` (you own it) — verify nothing else imports it first
  (grep; if something you don't own imports it, keep a trivial stub instead of deleting).
- `core/lib/diagnostics.ts` — replace fxserver-specific data gathering with static
  placeholders ('Rust standalone') so it compiles and runs.
- `core/lib/console.ts` — ONLY if it references fxserver/natives; otherwise leave.

## AGENT 2 — RustRcon module + FxRunner (process control)

Owned files:
- NEW `core/modules/RustRcon/index.ts` — implement the contract above. Details:
  - Config from `txConfig.server.rconPort` / `txConfig.server.rconPassword`
    (you add these to the schema, see below). Also
    `static readonly configKeysWatched = ['server.rconPort', 'server.rconPassword']` with a
    `handleConfigUpdate()` that reconnects.
  - Use the global `WebSocket` (Node 24). Auto-reconnect every 10s while `connect()`ed.
    Pending command map keyed by Identifier with per-command timeout. Unsolicited
    messages → emit to `onMessage` listeners with type from `Type.toLowerCase()`.
  - On socket close: reject all pending commands.
- `core/modules/ConfigStore/schema/server.ts` — rework:
  - `dataPath` default `'D:/RustServer/server'` (string, the Rust server folder).
  - `cfgPath` keep, default `'server/main/cfg/server.cfg'`.
  - `startupArgs` keep (extra args appended to launch).
  - DELETE `onesync`. ADD: `serverExe` (default `'RustDedicated.exe'`),
    `identity` (default `'main'`), `gamePort` (int, default 28015), `queryPort` (int,
    default 28017), `rconPort` (int, default 28016), `rconPassword` (string, default
    a placeholder). Keep `autoStart`, `quiet`,
    `shutdownNoticeDelayMs`, `restartSpawnDelayMs`. Follow the existing
    `typeDefinedConfig` pattern.
  - Check `core/modules/ConfigStore/schema/index.ts` and `configMigrations.ts` for
    references to removed keys (e.g. `onesync`) and fix them (you own those edits).
- `core/modules/FxRunner/utils.ts` — REWRITE the spawn-variable builder:
  `getFxSpawnVariables()` (keep the name) now returns
  `{ bin, args, serverName, dataPath }` where `bin = path.join(txConfig.server.dataPath, txConfig.server.serverExe)`
  and args = `['-batchmode', '+server.port', gamePort, '+server.queryport', queryPort,
  '+server.identity', identity, '+rcon.port', rconPort, '+rcon.password', rconPassword,
  '+rcon.web', '1', ...startupArgs]` (all stringified). NO `-logfile` (stdout stays piped).
  Delete convar-building (`getMutableConvars`, `mutableConvarConfigDependencies` → export
  an empty array to keep FxRunner's `configKeysWatched` working), delete
  `setupCustomLocaleFile` (or make no-op — check importers). Keep
  `childProcessEventBlackHole`, `isValidChildProcess`, `stringifyConsoleArgs`.
- `core/modules/FxRunner/index.ts` — convert:
  - Spawn via the new utils (cwd = `txConfig.server.dataPath`). Keep ProcessManager usage,
    history, backoff, restart/kill flow, announcements, config-update handling
    (now watching the new server.* keys and just noting a restart is needed).
  - `sendCommand`/`sendRawCommand` (whatever exists): route through
    `txCore.rustRcon.sendCommand()` instead of stdin. Return shapes unchanged.
  - Graceful shutdown (`handleShutdown`, stop/restart paths): replace
    `proc.stdin.write('quit ...')` with `txCore.rustRcon.sendCommand('quit')` and keep the
    kill-after-timeout fallback.
  - On successful spawn: call `txCore.rustRcon.connect()`. On kill/exit: `disconnect()`.
  - `sendEvent(...)` (fd3/txaEvent to the FiveM resource): announcements become
    `txCore.rustRcon.sendCommand('say <text>')` where a user-visible message exists;
    otherwise no-op `//RUSTTODO:`. Delete the import/usage of `handleFd3Messages`.
- DELETE `core/modules/FxRunner/handleFd3Messages.ts`.
- `core/modules/FxRunner/ProcessManager.ts` — keep; remove stdin-command helpers if any;
  the child no longer receives stdin commands.
- `core/modules/FxRunner/utils.test.ts` — update or delete to match the new utils.
- Type registration: add `rustRcon: RustRcon;` to the `TxCoreType`... NO — that's in
  `core/txAdmin.ts` which the INTEGRATOR owns. Instead, note it in your final report.
  For typechecking inside your files use `(txCore as any).rustRcon` ONLY if the global
  type doesn't resolve; prefer clean typing if it compiles.

## AGENT 3 — FxMonitor (health) + FxPlayerlist (players) + metrics stubs

Owned files:
- `core/modules/FxMonitor/index.ts` + `core/modules/FxMonitor/utils.ts`:
  - Health checks were HTTP GETs to fxserver's `/info.json`/`/dynamic.json` plus
    heartbeats from the in-game resource. Replace both signals with ONE source:
    every second tick stays, but the check is `txCore.rustRcon.sendCommand('serverinfo', 1500)`
    at most every 5s (cache between ticks). Success = healthcheck AND heartbeat success
    (feed both code paths so the existing state machine, restart limits, and
    `currentStatus` transitions keep working). Parse the JSON Message; expose player
    count/fps/uptime wherever the old code exposed dynamic data.
  - Keep ALL public members (`currentStatus`, `statusLog`, restart logic calling
    `txCore.fxRunner`, etc.). Delete only fxserver-specific helpers in utils
    (`fetchInfoJson`/`fetchDynamicJson` → replace with the rcon-based equivalent).
- `core/modules/FxPlayerlist/index.ts`:
  - Was event-driven (playerJoining/playerDropped from the game resource). Replace with a
    15s poll loop (start it in the constructor, guard with rustRcon.isConnected):
    `global.status` → parse with the regex in the facts section → diff against current
    list → for new players synthesize the join flow, for missing players the drop flow
    (reason `'unknown'` / category `'unknown'` `//RUSTTODO`).
  - Player identity: netid = incrementing integer you assign per join; ids =
    `[`steam:${BigInt(steamId64).toString(16)}`]`; displayName from the status line.
    Reuse the existing ServerPlayer class / handlers as much as possible.
  - Keep all public methods and events (other modules call `getPlayerList()` etc.).
- `core/modules/Metrics/svRuntime/index.ts` (+ its config if needed): the fxserver perf
  histogram fetching must go. Keep the module API and file logging alive; collect what we
  CAN get: every 60s, if rcon connected, `serverinfo` → log fps/players/memory using the
  existing optimizer if the shapes allow, otherwise skip collection entirely (empty chart
  is acceptable) `//RUSTTODO`. It must boot and never throw.
- `core/modules/Metrics/playerDrop/index.ts` — only if it breaks from playerlist changes:
  drops arrive with reason `'unknown'`; make sure classification tolerates it.
- Do NOT touch FxRunner, RustRcon (rely on the contract), ConfigStore, routes, panel.

## AGENT 4 — Routes + panel cleanup (de-FiveM the UI/API)

Owned files/areas:
- DELETE `core/deployer/` (whole dir), `core/routes/deployer/` (whole dir).
- `core/routes/index.ts` — remove imports/registrations for deployer routes and the
  resources route. Keep intercom (future Oxide plugin may use it).
- DELETE `core/routes/resources.js` and `core/modules/FxResources/` — then grep for
  `fxResources`/`FxResources` usages OUTSIDE `core/txAdmin.ts` (integrator handles that
  one) and stub/remove those call sites (they're yours if they're in routes/wsRooms).
- `core/routes/setup/get.ts` + `post.js` — remove the deployer flow options; the setup
  becomes: confirm server folder path (`txConfig.server.dataPath`) exists and contains
  `RustDedicated.exe`, then save + ready. Keep route shapes the panel expects (you own
  the matching panel pages too, keep them consistent).
- `core/routes/fxserver/downloadLog.js`, `cfgEditor/*` — keep, they're generic enough.
- `panel/src` cleanup:
  - Remove the Resources page, deployer/setup-wizard deployer steps, and any NUI/in-game
    menu settings UI. Update the router + nav/menu lists accordingly
    (`grep -ri "resources\|deployer\|nui" panel/src` and prune).
  - Login page: remove the Cfx.re/CitizenFX OAuth button + related API calls; password
    login stays. (Leave backend oauth routes alone; just don't render the button.)
  - User-visible strings "FiveM", "RedM", "FXServer", "Cfx.re" → "Rust" / "Rust server"
    where they describe the managed server (don't rename code symbols, only display text).
  - Server Settings page: it renders from config schemas — make sure removed keys
    (`onesync`) aren't hardcoded anywhere in panel forms; add plain inputs for the new
    `server.*` keys ONLY if the form is hardcoded per-key (check first; if it's
    schema-driven, do nothing).
- `shared/` — only display-string changes if needed; do not change enums/consts shapes.
- Do NOT touch: core/modules (except deleting FxResources), core/txAdmin.ts, globalData.

## Integrator checklist (main session — not agents)

- txAdmin.ts: register RustRcon (before FxRunner), remove FxResources.
- index.ts/txManager.ts adjustments, build scripts → standalone `node dist/index.js`,
  start-txadmin.ps1, typecheck all, panel build, boot test against the real server.
