import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { customAlphabet } from 'nanoid/non-secure';
import dict49 from 'nanoid-dictionary/nolookalikes';
import consoleFactory from '@lib/console';
import { resolveCFGFilePath } from '@lib/fxserver/fxsConfigHelper';
import { msToShortishDuration } from '@lib/misc';
import { SYM_SYSTEM_AUTHOR } from '@lib/symbols';
import { UpdateConfigKeySet } from '@modules/ConfigStore/utils';
import { childProcessEventBlackHole, getFxSpawnVariables, isValidChildProcess, mutableConvarConfigDependencies, setupCustomLocaleFile, stringifyConsoleArgs } from './utils';
import ProcessManager, { ChildProcessStateInfo } from './ProcessManager';
import ConsoleLineEnum from '@modules/Logger/FXServerLogger/ConsoleLineEnum';
import { txHostConfig } from '@core/globalData';
import path from 'node:path';
import fs from 'node:fs';
const console = consoleFactory('FxRunner');
const genMutex = customAlphabet(dict49, 5);

const MIN_KILL_DELAY = 250;

/**
 * Resolves the target player's SteamID64 from a txAdmin event payload, either from
 * the identifiers array (steam:<hex>) or by looking up the netid in the playerlist.
 */
const resolveEventTargetSteamId64 = (data: Record<string, any>): string | null => {
    const idsToSearch: string[] = Array.isArray(data?.targetIds) ? data.targetIds : [];
    const netid = data?.target ?? data?.targetNetId;
    if (typeof netid === 'number') {
        const player = txCore.fxPlayerlist.getPlayerById(netid);
        if (player && Array.isArray(player.idsOnline)) {
            idsToSearch.push(...player.idsOnline);
        }
    }
    for (const id of idsToSearch) {
        if (typeof id === 'string' && id.startsWith('steam:')) {
            try {
                return BigInt(`0x${id.slice(6)}`).toString(10);
            } catch { /* invalid hex, keep searching */ }
        }
    }
    return null;
};


/**
 * Module responsible for handling the Rust server process.
 *
 * FIXME: the methods that return error string should either throw or return
 * a more detailed and better formatted object
 */
export default class FxRunner {
    static readonly configKeysWatched = [
        'server.startupArgs',
        'server.gamePort',
        'server.queryPort',
        'server.identity',
        'server.rconPort',
        'server.rconPassword',
        ...mutableConvarConfigDependencies,
    ];

    public readonly history: ChildProcessStateInfo[] = [];
    private proc: ProcessManager | null = null;
    private isAwaitingShutdownNoticeDelay = false;
    private isAwaitingRestartSpawnDelay = false;
    private restartSpawnBackoffDelay = 0;


    //MARK: SIGNALS
    /**
     * Handles configuration updates
     */
    public handleConfigUpdate(updatedConfigs: UpdateConfigKeySet) {
        //RUSTTODO: Rust launch parameters cannot be changed at runtime
        if (this.proc?.isAlive && updatedConfigs.hasMatch('server.*')) {
            console.warn('Server configuration changed. A server restart is required for the changes to take effect.');
        }
    }


    /**
     * Gracefully shutdown when txAdmin gets an exit event.
     * There is no time for a more graceful shutdown with announcements and events.
     * Will only use the quit command and wait for the process to exit.
     */
    public handleShutdown() {
        if (!this.proc?.isAlive) return null;
        if (!txCore.rustRcon.isConnected) return null; //can't ask it to quit gracefully
        try {
            txCore.rustRcon.sendCommand('quit', 5000).catch(() => { });
        } catch (error) {
            return null;
        }
        return new Promise<void>((resolve) => {
            this.proc?.onExit(resolve); //will let the server finish by itself
        });
    }


    /**
     * Receives the signal that all the start banner was already printed and other modules loaded
     */
    public signalStartReady() {
        if (!txConfig.server.autoStart) return;

        if (!this.isConfigured) {
            return console.warn('Please open txAdmin on the browser to configure your server.');
        }

        if (!txCore.adminStore.hasAdmins()) {
            return console.warn('The server will not auto start because there are no admins configured.');
        }

        if (txConfig.server.quiet || txHostConfig.forceQuietMode) {
            console.defer(1000).warn('FXServer Quiet mode is enabled. Access the Live Console to see the logs.');
        }

        this.spawnServer(true);
    }


    /**
     * Handles boot signals related to bind errors and sets the backoff delay.  
     * On successfull bind, the backoff delay is reset to 0.  
     * On bind error, the backoff delay is increased by 5s, up to 45s.
     * @returns the new backoff delay in ms
     */
    public signalSpawnBackoffRequired(required: boolean) {
        if (required) {
            this.restartSpawnBackoffDelay = Math.min(
                this.restartSpawnBackoffDelay + 5_000,
                45_000
            );
        } else {
            if (this.restartSpawnBackoffDelay) {
                console.verbose.debug('Server booted successfully, resetting spawn backoff delay.');
            }
            this.restartSpawnBackoffDelay = 0;
        }
        return this.restartSpawnBackoffDelay;
    }


    //MARK: SPAWN
    /**
     * Spawns the FXServer and sets up all the event handlers.
     * NOTE: Don't use txConfig in here to avoid race conditions.
     */
    public async spawnServer(shouldAnnounce = false) {
        //If txAdmin is shutting down
        if(txManager.isShuttingDown) {
            const msg = `Cannot start the server while txAdmin is shutting down.`;
            console.error(msg);
            return msg;
        }

        //If the server is already alive
        if (this.proc !== null) {
            const msg = `The server has already started.`;
            console.error(msg);
            return msg;
        }

        //Setup spawn variables & locale file
        let fxSpawnVars;
        const newServerMutex = genMutex();
        try {
            txCore.webServer.resetToken();
            fxSpawnVars = getFxSpawnVariables();
            // debugPrintSpawnVars(fxSpawnVars); //DEBUG
        } catch (error) {
            const errMsg = `Error setting up spawn variables: ${(error as any).message}`;
            console.error(errMsg);
            return errMsg;
        }
        try {
            await setupCustomLocaleFile();
        } catch (error) {
            const errMsg = `Error copying custom locale: ${(error as any).message}`;
            console.error(errMsg);
            return errMsg;
        }

        //If there is any server configuration missing
        if (!this.isConfigured) {
            const msg = `Cannot start the server with missing configuration (serverDataPath || cfgPath).`;
            console.error(msg);
            return msg;
        }

        //RUSTTODO: no server.cfg validation for Rust, the game endpoint comes from the config
        const netEndpointDetected = `127.0.0.1:${txConfig.server.gamePort}`;

        //Reseting monitor stats
        txCore.fxMonitor.resetState();

        //Resetting frontend playerlist
        txCore.webServer.webSocket.buffer('playerlist', {
            mutex: newServerMutex,
            type: 'fullPlayerlist',
            playerlist: [],
        });

        //Announcing
        if (shouldAnnounce) {
            txCore.discordBot.sendAnnouncement({
                type: 'success',
                description: {
                    key: 'server_actions.spawning_discord',
                    data: { servername: fxSpawnVars.serverName },
                },
            });
        }

        //Starting server
        const childProc = spawn(
            fxSpawnVars.bin,
            fxSpawnVars.args,
            {
                cwd: fxSpawnVars.dataPath,
                stdio: ['pipe', 'pipe', 'pipe'],
            },
        );
        if (!isValidChildProcess(childProc)) {
            const errMsg = `Failed to run \n${fxSpawnVars.bin}`;
            console.error(errMsg);
            return errMsg;
        }
        this.proc = new ProcessManager(childProc, {
            mutex: newServerMutex,
            netEndpoint: netEndpointDetected,
            onStatusUpdate: () => {
                txCore.webServer.webSocket.pushRefresh('status');
            }
        });
        txCore.logger.fxserver.logFxserverSpawn(this.proc.pid.toString());

        //Setting up StdIO
        childProc.stdout.setEncoding('utf8');
        childProc.stdout.on('data',
            txCore.logger.fxserver.writeFxsOutput.bind(
                txCore.logger.fxserver,
                ConsoleLineEnum.StdOut,
            ),
        );
        childProc.stderr.on('data',
            txCore.logger.fxserver.writeFxsOutput.bind(
                txCore.logger.fxserver,
                ConsoleLineEnum.StdErr,
            ),
        );

        //_Almost_ don't care
        childProc.stdin.on('error', childProcessEventBlackHole);
        childProc.stdin.on('data', childProcessEventBlackHole);
        childProc.stdout.on('error', childProcessEventBlackHole);
        childProc.stderr.on('error', childProcessEventBlackHole);

        //Start the RCON connection loop
        txCore.rustRcon.connect();

        //FIXME: return a more detailed object
        return null;
    }


    //MARK: CONTROL
    /**
     * Restarts the FXServer
     */
    public async restartServer(reason: string, author: string | typeof SYM_SYSTEM_AUTHOR) {
        //Prevent concurrent restart request
        const respawnDelay = this.restartSpawnDelay;
        if (this.isAwaitingRestartSpawnDelay) {
            const durationStr = msToShortishDuration(
                respawnDelay.ms,
                { units: ['m', 's', 'ms'] }
            );
            return `A restart is already in progress, with a delay of ${durationStr}.`;
        }

        try {
            //Restart server
            const killError = await this.killServer(reason, author, true);
            if (killError) return killError;

            //Give time for the OS to release the ports

            if (respawnDelay.isBackoff) {
                console.warn(`Restarting the fxserver with backoff delay of ${respawnDelay.ms}ms`);
            }
            this.isAwaitingRestartSpawnDelay = true;
            await sleep(respawnDelay.ms);
            this.isAwaitingRestartSpawnDelay = false;

            //Start server again :)
            return await this.spawnServer();
        } catch (error) {
            const errMsg = `Couldn't restart the server.`;
            console.error(errMsg);
            console.verbose.dir(error);
            return errMsg;
        } finally {
            //Make sure the flag is reset
            this.isAwaitingRestartSpawnDelay = false;
        }
    }


    /**
     * Kills the FXServer child process.  
     * NOTE: isRestarting might be true even if not called by this.restartServer().
     */
    public async killServer(reason: string, author: string | typeof SYM_SYSTEM_AUTHOR, isRestarting = false) {
        if (!this.proc) return null; //nothing to kill

        //Prepare vars
        const shutdownDelay = Math.max(txConfig.server.shutdownNoticeDelayMs, MIN_KILL_DELAY);
        const reasonString = reason ?? 'no reason provided';
        const messageType = isRestarting ? 'restarting' : 'stopping';
        const messageColor = isRestarting ? 'warning' : 'danger';
        const tOptions = {
            servername: txConfig.general.serverName,
            reason: reasonString,
        };

        //Prevent concurrent kill request
        if (this.isAwaitingShutdownNoticeDelay) {
            const durationStr = msToShortishDuration(
                shutdownDelay,
                { units: ['m', 's', 'ms'] }
            );
            return `A shutdown is already in progress, with a delay of ${durationStr}.`;
        }

        try {
            //If the process is alive, send warnings event and await the delay
            if (this.proc.isAlive) {
                this.sendEvent('serverShuttingDown', {
                    delay: txConfig.server.shutdownNoticeDelayMs,
                    author: typeof author === 'string' ? author : 'txAdmin',
                    message: txCore.translator.t(`server_actions.${messageType}`, tOptions),
                });
                this.isAwaitingShutdownNoticeDelay = true;
                await sleep(shutdownDelay);
                this.isAwaitingShutdownNoticeDelay = false;
            }

            //Attempt graceful shutdown via RCON (saves the world), with kill fallback below
            if (this.proc.isAlive && txCore.rustRcon.isConnected) {
                try {
                    await txCore.rustRcon.sendCommand('quit', 2500).catch(() => { });
                    //Give the server a chance to save & exit by itself
                    const tsQuitSent = Date.now();
                    while (this.proc.isAlive && Date.now() - tsQuitSent < 10_000) {
                        await sleep(250);
                    }
                } catch (error) { /* fallback to kill below */ }
            }

            //Stop the RCON connection loop
            txCore.rustRcon.disconnect();

            //Stopping server (kill fallback - no-op if the process already exited)
            this.proc.destroy();
            const debugInfo = this.proc.stateInfo;
            this.history.push(debugInfo);
            this.proc = null;

            //Cleanup
            txCore.fxScheduler.handleServerClose();
            txCore.fxPlayerlist.handleServerClose(debugInfo.mutex);
            txCore.metrics.svRuntime.logServerClose(reasonString);
            txCore.discordBot.sendAnnouncement({
                type: messageColor,
                description: {
                    key: `server_actions.${messageType}_discord`,
                    data: tOptions,
                },
            }).catch(() => { });
            return null;
        } catch (error) {
            const msg = `Couldn't kill the server. Perhaps What Is Dead May Never Die.`;
            console.error(msg);
            console.verbose.dir(error);
            this.proc = null;
            return msg;
        } finally {
            //Make sure the flag is reset
            this.isAwaitingShutdownNoticeDelay = false;
        }
    }


    //MARK: COMMANDS
    /**
     * Resets the convars in the server.
     * //RUSTTODO: Rust has no txAdmin convars, kept as inert method for API compatibility.
     * Return shape preserved: array of [setter, convar, value] tuples (always empty).
     */
    public async updateMutableConvars(): Promise<[string, string, string][] | null> {
        return [];
    }


    /**
     * Broadcasts a txAdmin event to the server.
     * There is no in-game resource on Rust, so player action events are translated to
     * their Rust console command equivalents; other events broadcast their
     * user-visible message (if any) via `say`.
     * @returns true if the command was sent successfully, false otherwise.
     */
    public sendEvent(eventType: string, data: Record<string, any> = {}) {
        if (typeof eventType !== 'string' || !eventType) throw new Error('invalid eventType');
        if (!this.proc?.isAlive) return false;
        try {
            const cleanStr = (x: unknown) => String(x ?? '').replaceAll(/["\r\n]/g, ' ').trim();
            const steamId64 = resolveEventTargetSteamId64(data);

            if (eventType === 'playerKicked') {
                if (!steamId64) return false;
                const reason = cleanStr(data.dropMessage || data.reason || 'kicked');
                return this.sendRawCommand(`kick ${steamId64} "${reason}"`, SYM_SYSTEM_AUTHOR);
            } else if (eventType === 'playerBanned') {
                if (!steamId64) return false;
                const reason = cleanStr(data.kickMessage || data.reason || 'banned');
                const name = cleanStr(data.targetName || 'player');
                this.sendRawCommand(`banid ${steamId64} "${name}" "${reason}"`, SYM_SYSTEM_AUTHOR);
                this.sendRawCommand('server.writecfg', SYM_SYSTEM_AUTHOR);
                return true;
            } else if (eventType === 'playerWarned') {
                const target = cleanStr(data.targetName || 'player');
                const reason = cleanStr(data.reason);
                const author = cleanStr(data.author || 'txAdmin');
                //NOTE: Rust has no targeted chat via console, so this is a broadcast
                this.sendRawCommand(`txadminpanel.announce "WARNING to ${target}: ${reason}"`, SYM_SYSTEM_AUTHOR);
                return this.sendRawCommand(`say [WARNING to ${target}] ${reason} (by ${author})`, SYM_SYSTEM_AUTHOR);
            } else if (eventType === 'playerDirectMessage') {
                const player = txCore.fxPlayerlist.getPlayerById(data.target);
                const target = cleanStr(player?.displayName || 'player');
                const author = cleanStr(data.author || 'txAdmin');
                const message = cleanStr(data.message);
                //NOTE: Rust has no targeted chat via console, so this is a broadcast
                return this.sendRawCommand(`say [DM to ${target} from ${author}] ${message}`, SYM_SYSTEM_AUTHOR);
            }

            //Other events: broadcast the user-visible message (if any) via chat.
            let userMessage: string | undefined;
            if (typeof data?.message === 'string' && data.message.length) {
                userMessage = data.message;
            } else if (typeof data?.translatedMessage === 'string' && data.translatedMessage.length) {
                userMessage = data.translatedMessage;
            }
            if (!userMessage) return true; //no-op, but "successful"

            //Announcements also go to the in-game HUD banner (TxAdminPanel plugin)
            this.sendRawCommand(`txadminpanel.announce "${cleanStr(userMessage)}"`, SYM_SYSTEM_AUTHOR);
            return this.sendRawCommand(
                `say ${userMessage.replaceAll(/\n/g, ' ')}`,
                SYM_SYSTEM_AUTHOR,
            );
        } catch (error) {
            console.verbose.error(`Error firing server event ${eventType}`);
            console.verbose.dir(error);
            return false;
        }
    }


    /**
     * Formats and sends commands to the server console (via RCON).
     */
    public sendCommand(
        cmdName: string,
        cmdArgs: (string | number | object)[],
        author: string | typeof SYM_SYSTEM_AUTHOR
    ) {
        if (!this.proc?.isAlive) return false;
        if (typeof cmdName !== 'string' || !cmdName.length) throw new Error('cmdName is empty');
        if (!Array.isArray(cmdArgs)) throw new Error('cmdArgs is not an array');
        //NOTE: Rust console commands may be namespaced (eg. global.say, server.writecfg)
        if (!/^[\w.]+$/.test(cmdName)) {
            throw new Error('invalid cmdName string');
        }

        // Send the command to the server
        const rawInput = `${cmdName} ${stringifyConsoleArgs(cmdArgs)}`;
        return this.sendRawCommand(rawInput, author);
    }


    /**
     * Sends a raw command to the server console via RCON.
     * NOTE: return shape kept as boolean for API compatibility, the RCON
     * command is dispatched asynchronously (fire-and-forget).
     */
    public sendRawCommand(command: string, author: string | typeof SYM_SYSTEM_AUTHOR) {
        if (!this.proc?.isAlive) return false;
        if (typeof command !== 'string') throw new Error('Expected command as String!');
        if (author !== SYM_SYSTEM_AUTHOR && (typeof author !== 'string' || !author.length)) {
            throw new Error('Expected non-empty author as String or Symbol!');
        }
        if (!txCore.rustRcon.isConnected) return false;
        try {
            txCore.rustRcon.sendCommand(command).catch((error) => {
                console.verbose.error(`RCON command failed: ${(error as any)?.message}`);
            });
            if (author === SYM_SYSTEM_AUTHOR) {
                txCore.logger.fxserver.logSystemCommand(command);
            } else {
                txCore.logger.fxserver.logAdminCommand(author, command);
            }
            return true;
        } catch (error) {
            console.error('Error sending RCON command.');
            console.verbose.dir(error);
            return false;
        }
    }


    //MARK: GETTERS
    /**
     * The ChildProcessStateInfo of the current FXServer, or null
     */
    public get child() {
        return this.proc?.stateInfo;
    }


    /**
     * If the server is _supposed to_ not be running.  
     * It takes into consideration the RestartSpawnDelay.  
     * - TRUE: server never started, or failed during a start/restart.
     * - FALSE: server started, but might have been killed or crashed.
     */
    public get isIdle() {
        return !this.proc && !this.isAwaitingRestartSpawnDelay;
    }


    /**
     * True if the server is set up: dataPath/cfgPath configured AND the server
     * folder actually contains the server executable. The folder check makes a
     * fresh install (whose dataPath is still the schema default) show the setup
     * wizard instead of failing to spawn.
     */
    public get isConfigured() {
        if (
            typeof txConfig.server.dataPath !== 'string'
            || txConfig.server.dataPath.length === 0
            || typeof txConfig.server.cfgPath !== 'string'
            || txConfig.server.cfgPath.length === 0
        ) {
            return false;
        }
        try {
            return fs.existsSync(path.join(txConfig.server.dataPath, txConfig.server.serverExe));
        } catch {
            return false;
        }
    }


    /**
     * The resolved paths of the server
     * FIXME: check where those paths are needed and only calculate what is relevant
     */
    public get serverPaths() {
        if (!this.isConfigured) return;
        return {
            dataPath: path.normalize(txConfig.server.dataPath!), //to maintain consistency
            cfgPath: resolveCFGFilePath(txConfig.server.cfgPath, txConfig.server.dataPath!),
        }
        // return {
        //     data: {
        //         absolute: 'xxx',
        //     },
        //     //TODO: cut paste logic from resolveCFGFilePath
        //     resources: {
        //         //???
        //     },
        //     cfg: {
        //         fileName: 'xxx',
        //         relativePath: 'xxx',
        //         absolutePath: 'xxx',
        //     }
        // };
    }


    /**
     * The duration in ms that FxRunner should wait between killing the server and starting it again.  
     * This delay is present to avoid weird issues with the OS not releasing the endpoint in time.  
     * NOTE: reminder that the config might be 0ms
     */
    public get restartSpawnDelay() {
        let ms = txConfig.server.restartSpawnDelayMs;
        let isBackoff = false;
        if (this.restartSpawnBackoffDelay >= ms) {
            ms = this.restartSpawnBackoffDelay;
            isBackoff = true;
        }

        return {
            ms,
            isBackoff,
            // isDefault: ms === ConfigStore.SchemaDefaults.server.restartSpawnDelayMs
        }
    }
};
