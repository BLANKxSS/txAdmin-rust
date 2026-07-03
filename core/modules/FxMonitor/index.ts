const modulename = 'FxMonitor';
import chalk from 'chalk';
import { MonitorState, getMonitorTimeTags, HealthEventMonitor, MonitorIssue, Stopwatch, cleanMonitorIssuesArray, type VerboseErrorData } from './utils';
import consoleFactory from '@lib/console';
import { SYM_SYSTEM_AUTHOR } from '@lib/symbols';
import { ChildProcessState } from '@modules/FxRunner/ProcessManager';
import { secsToShortestDuration } from '@lib/misc';
import { FxMonitorHealth } from '@shared/enums';
const console = consoleFactory(modulename);


//MARK: Consts
const HC_CONFIG = {
    //before first success:
    bootInitAfterHbLimit: 45,

    //after first success:
    delayLimit: 10,
    fatalLimit: 180, //since playerConnecting hangs now are HB, reduced from 5 to 3 minutes

    //other stuff
    requestTimeout: 1500,
    requestInterval: 1000,
};
const HB_CONFIG = {
    //before first success:
    //RUSTTODO: Rust servers can take several minutes to boot (map load/gen), tune if needed
    bootLimit: 600, //time limit for the first successful serverinfo response after spawn

    //after first success:
    delayLimit: 10,
    fatalLimit: 60,
};
const MAX_LOG_ENTRIES = 300; //5 minutes in 1s intervals
const MIN_WARNING_INTERVAL = 10;


//MARK:Types
export type MonitorIssuesArray = (string | MonitorIssue | undefined)[];
type MonitorRestartCauses = 'bootTimeout' | 'close' | 'healthCheck' | 'heartBeat' | 'both';
type ProcessStatusResult = {
    action: 'SKIP';
    reason: string;
} | {
    action: 'WARN';
    times?: string;
    reason: string;
    issues?: MonitorIssuesArray;
} | {
    action: 'RESTART';
    times?: string;
    reason: string;
    issues?: MonitorIssuesArray;
    cause: MonitorRestartCauses;
}
type ProcessStatusNote = {
    action: 'NOTE';
    reason: string;
}
type StatusLogEntry = (ProcessStatusResult | ProcessStatusNote) & { x?: number };
type RustServerInfo = {
    players: number;
    maxPlayers: number | null;
    fps: number | null;
    memoryMb: number | null;
    uptimeSecs: number | null;
    hostname: string | null;
};


//MARK: Utils
//This is inneficient, so wont put this in utils
class LimitedArray<T> extends Array<T> {
    constructor(public readonly limit: number) {
        super();
    }

    push(...items: T[]): number {
        while (this.length + items.length > this.limit) {
            this.shift();
        }
        return super.push(...items);
    }
}


//MARK: Main Class
/**
 * Module responsible for monitoring the FXServer health and status, restarting it if necessary.
 */
export default class FxMonitor {
    public readonly timers: NodeJS.Timer[] = [];

    //Status tracking
    private readonly statusLog = new LimitedArray<StatusLogEntry>(MAX_LOG_ENTRIES);
    private currentStatus: FxMonitorHealth = FxMonitorHealth.OFFLINE;
    private lastHealthCheckError: VerboseErrorData | null = null; //to print warning
    private isAwaitingRestart = false; //to prevent spamming while the server restarts (5s)
    private tsServerBooted: number | null = null;

    //to prevent DDoS crash false positive
    private readonly swLastStatusUpdate = new Stopwatch(false);

    //to prevent spamming
    private readonly swLastPartialHangRestartWarning = new Stopwatch(true);
    private readonly swLastStatusWarning = new Stopwatch(true);

    //to see if its above limit
    private readonly heartBeatMonitor = new HealthEventMonitor(HB_CONFIG.delayLimit, HB_CONFIG.fatalLimit);
    private readonly healthCheckMonitor = new HealthEventMonitor(HC_CONFIG.delayLimit, HC_CONFIG.fatalLimit);
    private readonly swLastFD3 = new Stopwatch();
    private readonly swLastHTTP = new Stopwatch();

    //for throttling RCON health checks to max every 5s
    private readonly swLastRconHealthCheck = new Stopwatch(false);

    //last parsed serverinfo data (player count, fps, uptime, etc)
    private lastServerInfo: RustServerInfo | null = null;


    constructor() {
        // Cron functions
        this.timers.push(setInterval(() => this.performHealthCheck(), HC_CONFIG.requestInterval));
        this.timers.push(setInterval(() => this.updateStatus(), 1000));
    }


    //MARK: State Helpers
    /**
     * Sets the current status and propagates the change to the Discord Bot and WebServer
     */
    private setCurrentStatus(newStatus: FxMonitorHealth) {
        if (newStatus === this.currentStatus) return;

        //Set state
        this.currentStatus = newStatus;
        txCore.discordBot.updateBotStatus().catch((e) => { });
        txCore.webServer.webSocket.pushRefresh('status');
    }


    /**
     * Reset Health Monitor Stats.
     * This is called internally and by FxRunner
     */
    public resetState() {
        this.setCurrentStatus(FxMonitorHealth.OFFLINE);
        this.lastHealthCheckError = null;
        this.isAwaitingRestart = false;
        this.tsServerBooted = null;

        this.swLastStatusUpdate.reset();
        this.swLastStatusWarning.reset();
        this.swLastPartialHangRestartWarning.reset(); //for partial hang

        this.heartBeatMonitor.reset();
        this.healthCheckMonitor.reset();
        this.swLastFD3.reset();
        this.swLastHTTP.reset();
        this.swLastRconHealthCheck.reset();
        this.lastServerInfo = null;
    }


    /**
     * Processes the status and then deals with the results.
     * MARK: UPDATE STATUS
     */
    private updateStatus() {
        //Get and cleanup the result
        const result = this.calculateMonitorStatus();
        const cleanIssues = 'issues' in result ? cleanMonitorIssuesArray(result.issues) : [];
        if (result.reason.endsWith('.')) {
            result.reason = result.reason.slice(0, -1);
        }

        //Merge with last entry if possible
        const lastEntry = this.statusLog.at(-1);
        if (lastEntry && lastEntry.action === result.action && lastEntry.reason === result.reason) {
            lastEntry.x = (lastEntry.x ?? 1) + 1;
            if ('times' in lastEntry && 'times' in result) lastEntry.times = result.times;
            if ('issues' in lastEntry && cleanIssues.length) lastEntry.issues = cleanIssues;
        } else {
            this.statusLog.push(result);
        }

        //Right now we only care about WARN and RESTART
        if (result.action !== 'WARN' && result.action !== 'RESTART') return;

        //Prepare reason
        if (!result.reason) {
            console.error('Missing reason in status update.');
            return;
        }
        const styledIssues = cleanIssues.map((i) => chalk.dim('- ' + i));

        //Warning - check if last warning was long enough ago
        if (result.action === 'WARN') {
            if (this.swLastStatusWarning.isOver(MIN_WARNING_INTERVAL)) {
                this.swLastStatusWarning.restart();
                const timesPrefix = result.times ? `${result.times} ` : '';
                console.warn(timesPrefix + result.reason + '.');
                for (const line of styledIssues) {
                    console.warn(line);
                }
            }
            return;
        }

        //Restart - log to the required channels + restart the server
        if (result.action === 'RESTART') {
            if (txCore.fxRunner.isIdle) return; //should never happen

            //Logging
            const timesSuffix = result.times ? ` ${result.times}.` : '.';
            const logMessage = `Restarting server: ${result.reason}` + timesSuffix;
            console.error(logMessage);
            txCore.logger.admin.writeSystem('MONITOR', logMessage);
            txCore.logger.fxserver.logInformational(logMessage); //just for better visibility
            for (const line of styledIssues) {
                txCore.logger.fxserver.logInformational(line);
                console.error(line);
            }
            if (this.lastHealthCheckError) {
                console.verbose.debug('Last HealthCheck error debug data:');
                console.verbose.dir(this.lastHealthCheckError.debugData);
                console.verbose.debug('-'.repeat(40));
            }

            //Restarting the server
            this.resetState(); //will set the status to OFFLINE
            this.isAwaitingRestart = true;
            txCore.fxRunner.restartServer(
                txCore.translator.t('restarter.server_unhealthy_kick_reason'),
                SYM_SYSTEM_AUTHOR,
            );
            txCore.metrics.txRuntime.registerFxserverRestart(result.cause);
        }
    }


    /**
     * MARK: CALCULATE STATUS
     * Refreshes the Server Status and calls for a restart if neccessary.
     *  - HealthCheck: performing an GET to the /dynamic.json file
     *  - HeartBeat: receiving an intercom POST or FD3 txAdminHeartBeat event
     */
    private calculateMonitorStatus(): ProcessStatusResult {
        //Check if the server is supposed to be offline
        if (txCore.fxRunner.isIdle) {
            this.resetState();
            return {
                action: 'SKIP',
                reason: 'Server is idle',
            };
        }

        //Ignore check while server is restarting
        if (this.isAwaitingRestart) {
            return {
                action: 'SKIP',
                reason: 'Server is restarting',
            };
        }

        //Check if process was frozen
        if (this.swLastStatusUpdate.isOver(10)) {
            console.error(`txAdmin was frozen for ${this.swLastStatusUpdate.elapsed - 1} seconds for unknown reason (random issue, VPS Lag, DDoS, etc).`);
            this.swLastStatusUpdate.restart();
            return {
                action: 'SKIP',
                reason: 'txAdmin was frozen',
            }
        }
        this.swLastStatusUpdate.restart();

        //Get elapsed times & process status
        const heartBeat = this.heartBeatMonitor.status;
        const healthCheck = this.healthCheckMonitor.status;
        const processUptime = Math.floor((txCore.fxRunner.child?.uptime ?? 0) / 1000);
        const timeTags = getMonitorTimeTags(heartBeat, healthCheck, processUptime)
        // console.dir({
        //     timeTag: timeTags.withProc,
        //     heartBeat,
        //     healthCheck,
        //     child: txCore.fxRunner.child?.status,
        // }, { compact: true }); //DEBUG
        const secs = (s: number) => Number.isFinite(s) ? secsToShortestDuration(s, { round: false }) : '--';

        //Don't wait for the fail counts if the child was destroyed
        if (txCore.fxRunner.child?.status === ChildProcessState.Destroyed) {
            //No need to set any status, this.updateStatus will trigger this.resetState
            return {
                action: 'RESTART',
                reason: 'Server process close detected',
                cause: 'close',
            };
        }

        //Check if its online and return
        if (heartBeat.state === MonitorState.HEALTHY && healthCheck.state === MonitorState.HEALTHY) {
            this.setCurrentStatus(FxMonitorHealth.ONLINE);
            if (!this.tsServerBooted) {
                this.tsServerBooted = Date.now();
                this.handleBootCompleted(processUptime).catch(() => { });
            }
            return {
                action: 'SKIP',
                reason: 'Server is healthy',
            }
        }

        //At least one monitor is unhealthy
        const currentStatusString = (
            heartBeat.state !== MonitorState.HEALTHY
            && healthCheck.state !== MonitorState.HEALTHY
        ) ? FxMonitorHealth.OFFLINE : FxMonitorHealth.PARTIAL
        this.setCurrentStatus(currentStatusString);

        //Check if still in grace period
        if (processUptime < txConfig.restarter.bootGracePeriod) {
            return {
                action: 'SKIP',
                reason: `FXServer is ${currentStatusString}, still in grace period of ${txConfig.restarter.bootGracePeriod}s.`,
            };
        }

        //Checking all conditions and either filling FailReason or restarting it outright
        //NOTE: This part MUST restart if boot timed out, but FATAL will be dealt with down below
        let heartBeatIssue: MonitorIssue | undefined;
        let healthCheckIssue: MonitorIssue | undefined;

        //If HealthCheck failed
        if (healthCheck.state !== MonitorState.HEALTHY) {
            healthCheckIssue = new MonitorIssue('Impossible HealthCheck failure.');
            healthCheckIssue.addDetail(this.lastHealthCheckError?.error);

            //No HealthCheck received yet
            if (healthCheck.state === MonitorState.PENDING) {
                healthCheckIssue.setTitle('No successful HealthCheck yet.');

                //Check if heartbeats started but no healthchecks yet
                if (heartBeat.state !== MonitorState.PENDING) {
                    healthCheckIssue.addInfo(`Resources started ${secs(heartBeat.secsSinceFirst)} ago but the HTTP endpoint is still unresponsive.`);
                    if (heartBeat.secsSinceFirst > HC_CONFIG.bootInitAfterHbLimit) {
                        return {
                            action: 'RESTART',
                            times: timeTags.withProc,
                            reason: 'Server boot timed out',
                            issues: [healthCheckIssue],
                            cause: 'bootTimeout',
                        }
                    }
                }
            } else if (healthCheck.state === MonitorState.DELAYED || healthCheck.state === MonitorState.FATAL) {
                //Started, but failing
                healthCheckIssue.setTitle(`HealthChecks failing for the past ${secs(healthCheck.secsSinceLast)}.`);
            } else {
                throw new Error(`Unexpected HealthCheck state: ${healthCheck.state}`);
            }
        }

        //If HeartBeat failed
        if (heartBeat.state !== MonitorState.HEALTHY) {
            heartBeatIssue = new MonitorIssue('Impossible HeartBeat failure.');

            //No HeartBeat received yet
            if (heartBeat.state === MonitorState.PENDING) {
                heartBeatIssue.setTitle('No successful HeartBeat yet.');
                //RUSTTODO: no resource boot tracking on Rust, just wait for the first RCON serverinfo response
                if (!txCore.rustRcon?.isConnected) {
                    heartBeatIssue.addInfo('RCON is not yet connected to the Rust server.');
                } else {
                    heartBeatIssue.addInfo('RCON connected, waiting for the first serverinfo response.');
                }
                if (processUptime > HB_CONFIG.bootLimit) {
                    heartBeatIssue.addInfo(`No serverinfo response received within the ${secs(HB_CONFIG.bootLimit)} limit.`);
                    return {
                        action: 'RESTART',
                        times: timeTags.withProc,
                        reason: 'Server boot timed out',
                        issues: [heartBeatIssue],
                        cause: 'bootTimeout',
                    }
                }
            } else if (heartBeat.state === MonitorState.DELAYED || heartBeat.state === MonitorState.FATAL) {
                //HeartBeat started, but failing
                heartBeatIssue.setTitle(`Stopped receiving HeartBeats ${secs(heartBeat.secsSinceLast)} ago.`);
            } else {
                throw new Error(`Unexpected HeartBeat state: ${heartBeat.state}`);
            }
        }

        //Check if either HB or HC are FATAL, restart the server
        if (heartBeat.state === MonitorState.FATAL || healthCheck.state === MonitorState.FATAL) {
            let cause: MonitorRestartCauses;
            if (heartBeat.state === MonitorState.FATAL && healthCheck.state === MonitorState.FATAL) {
                cause = 'both';
            } else if (heartBeat.state === MonitorState.FATAL) {
                cause = 'heartBeat';
            } else if (healthCheck.state === MonitorState.FATAL) {
                cause = 'healthCheck';
            } else {
                throw new Error(`Unexpected fatal state: HB:${heartBeat.state} HC:${healthCheck.state}`);
            }

            return {
                action: 'RESTART',
                cause,
                times: timeTags.simple,
                reason: 'Server is not responding',
                issues: [heartBeatIssue, healthCheckIssue],
            }
        }

        //If http-only hang, warn 1 minute before restart
        if (
            heartBeat.state === MonitorState.HEALTHY
            && this.swLastPartialHangRestartWarning.isOver(120)
            && healthCheck.secsSinceLast > (HC_CONFIG.fatalLimit - 60)
        ) {
            this.swLastPartialHangRestartWarning.restart();

            //Sending discord announcement
            txCore.discordBot.sendAnnouncement({
                type: 'danger',
                description: {
                    key: 'restarter.partial_hang_warn_discord',
                    data: { servername: txConfig.general.serverName },
                },
            });

            // Dispatch `txAdmin:events:announcement`
            txCore.fxRunner.sendEvent('announcement', {
                author: 'txAdmin',
                message: txCore.translator.t('restarter.partial_hang_warn'),
            });
        }

        //Return warning
        const isStillBooting = heartBeat.state === MonitorState.PENDING || healthCheck.state === MonitorState.PENDING;
        return {
            action: 'WARN',
            times: isStillBooting ? timeTags.withProc : timeTags.simple,
            reason: isStillBooting ? 'Server is taking too long to start' : 'Server is not responding',
            issues: [heartBeatIssue, healthCheckIssue],
        }
    }


    //MARK: HC & HB
    /**
     * Sends an RCON serverinfo command to check if the server is healthy.
     * Throttled to max every 5s to avoid excessive RCON traffic.
     */
    private async performHealthCheck() {
        //Check if the server is supposed to be offline
        if (txCore.fxRunner.isIdle) return;
        if (!txCore.rustRcon?.isConnected) return;

        //Throttle to max every 5s
        if (this.swLastRconHealthCheck.started && !this.swLastRconHealthCheck.isOver(5)) {
            return;
        }
        this.swLastRconHealthCheck.restart();

        //Make RCON request
        try {
            const response = await txCore.rustRcon.sendCommand('serverinfo', HC_CONFIG.requestTimeout);

            //Parse the JSON response
            let serverInfo: any;
            try {
                serverInfo = JSON.parse(response);
            } catch (e) {
                this.lastHealthCheckError = {
                    error: 'Failed to parse serverinfo JSON response',
                    debugData: { response: response.slice(0, 256) },
                };
                return;
            }

            //Successful healthcheck - feed BOTH the healthcheck and heartbeat code paths,
            //since the RCON serverinfo response is now the single health signal source
            this.lastHealthCheckError = null;
            this.healthCheckMonitor.markHealthy();
            this.heartBeatMonitor.markHealthy();

            //Expose dynamic data (player count, fps, uptime) for other consumers
            if (typeof serverInfo.Players === 'number') this.lastServerInfo = {
                players: serverInfo.Players,
                maxPlayers: typeof serverInfo.MaxPlayers === 'number' ? serverInfo.MaxPlayers : null,
                fps: typeof serverInfo.Framerate === 'number' ? serverInfo.Framerate : null,
                memoryMb: typeof serverInfo.Memory === 'number' ? serverInfo.Memory : null,
                uptimeSecs: typeof serverInfo.Uptime === 'number' ? serverInfo.Uptime : null,
                hostname: typeof serverInfo.Hostname === 'string' ? serverInfo.Hostname : null,
            };

            //Cache maxClients if available
            if (typeof serverInfo.MaxPlayers === 'number' && serverInfo.MaxPlayers > 0) {
                txCore.cacheStore.set('fxsRuntime:maxClients', serverInfo.MaxPlayers);
            }
        } catch (error) {
            this.lastHealthCheckError = {
                error: `HealthCheck RCON error: ${(error as Error).message}`,
                debugData: {},
            };
        }
    }


    /**
     * Handles the HeartBeat event from the server.
     */
    public handleHeartBeat(source: 'fd3' | 'http') {
        this.heartBeatMonitor.markHealthy();
        if (source === 'fd3') {
            if (
                this.swLastHTTP.started
                && this.swLastHTTP.elapsed > 15
                && this.swLastFD3.elapsed < 5
            ) {
                txCore.metrics.txRuntime.registerFxserverHealthIssue('http');
            }
            this.swLastFD3.restart();
        } else if (source === 'http') {
            if (
                this.swLastFD3.started
                && this.swLastFD3.elapsed > 15
                && this.swLastHTTP.elapsed < 5
            ) {
                txCore.metrics.txRuntime.registerFxserverHealthIssue('fd3');
            }
            this.swLastHTTP.restart();
        }
    }


    //MARK: ON BOOT
    /**
     * Handles boot completion notification.
     * //RUSTTODO: Previously fetched server icon and metadata from HTTP endpoints
     */
    private async handleBootCompleted(bootDuration: number) {
        //Registering the boot
        txCore.metrics.txRuntime.registerFxserverBoot(bootDuration);
        txCore.metrics.svRuntime.logServerBoot(bootDuration);
        txCore.fxRunner.signalSpawnBackoffRequired(false);

        //RUSTTODO: HTTP-based icon and metadata fetching no longer available for Rust server
        //In future, could implement via serverinfo command parsing or other means
    }


    //MARK: Getters
    /**
     * Returns the current status object that is sent to the host status endpoint
     */
    public get status() {
        let healthReason = 'Unknown - no log entries.';
        const lastEntry = this.statusLog.at(-1);
        if (lastEntry) {
            const healthReasonLines = [
                lastEntry.reason + '.',
            ];
            if ('issues' in lastEntry) {
                const cleanIssues = cleanMonitorIssuesArray(lastEntry.issues);
                healthReasonLines.push(...cleanIssues);
            }
            healthReason = healthReasonLines.join('\n');
        }
        return {
            health: this.currentStatus,
            healthReason,
            uptime: this.tsServerBooted ? Date.now() - this.tsServerBooted : 0,
        }
    }

    /**
     * Returns the last parsed `serverinfo` RCON response data (or null).
     * Contains player count, fps, memory, uptime, etc.
     */
    public get rustServerInfo() {
        return this.lastServerInfo;
    }
};
