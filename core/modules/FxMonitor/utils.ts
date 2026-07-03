import { secsToShortestDuration } from "@lib/misc";
import type { MonitorIssuesArray } from "./index";


/**
 * Class to easily check elapsed time.
 * Seconds precision, rounded down, consistent.
 */
export class Stopwatch {
    private readonly autoStart: boolean = false;
    private tsStart: number | null = null;

    constructor(autoStart?: boolean) {
        if (autoStart) {
            this.autoStart = true;
            this.restart();
        }
    }

    /**
     * Reset the stopwatch (stop and clear).
     */
    reset() {
        if (this.autoStart) {
            this.restart();
        } else {
            this.tsStart = null;
        }
    }

    /**
     * Start or restart the stopwatch.
     */
    restart() {
        this.tsStart = Date.now();
    }

    /**
     * Returns if the timer is over a certain amount of time.
     * Always false if not started.
     */
    isOver(secs: number) {
        const elapsed = this.elapsed;
        if (elapsed === Infinity) {
            return false;
        } else {
            return elapsed >= secs;
        }
    }

    /**
     * Returns true if the stopwatch is running.
     */
    get started() {
        return this.tsStart !== null;
    }

    /**
     * Returns the elapsed time in seconds or Infinity if not started.
     */
    get elapsed() {
        if (this.tsStart === null) {
            return Infinity;
        } else {
            const elapsedMs = Date.now() - this.tsStart;
            return Math.floor(elapsedMs / 1000);
        }
    }

    /**
     * Returns the elapsed time in milliseconds or Infinity if not started.
     */
    get elapsedMs() {
        if (this.tsStart === null) {
            return Infinity;
        } else {
            return Date.now() - this.tsStart;
        }
    }
}


/**
 * Exported enum
 */
export enum MonitorState {
    PENDING = 'PENDING',
    HEALTHY = 'HEALTHY',
    DELAYED = 'DELAYED',
    FATAL = 'FATAL',
}


/**
 * Class to easily check elapsed time.
 * Seconds precision, rounded down, consistent.
 */
export class HealthEventMonitor {
    private readonly swLastHealthyEvent = new Stopwatch();
    private firstHealthyEvent: number | undefined;

    constructor(
        private readonly delayLimit: number,
        private readonly fatalLimit: number,
    ) { }

    /**
     * Resets the state of the monitor.
     */
    public reset() {
        this.swLastHealthyEvent.reset();
        this.firstHealthyEvent = undefined;
    }

    /**
     * Register a successful event
     */
    public markHealthy() {
        this.swLastHealthyEvent.restart();
        this.firstHealthyEvent ??= Date.now();
    }

    /**
     * Returns the current status of the monitor.
     */
    public get status() {
        let state: MonitorState;
        if (!this.swLastHealthyEvent.started) {
            state = MonitorState.PENDING;
        } else if (this.swLastHealthyEvent.isOver(this.fatalLimit)) {
            state = MonitorState.FATAL;
        } else if (this.swLastHealthyEvent.isOver(this.delayLimit)) {
            state = MonitorState.DELAYED;
        } else {
            state = MonitorState.HEALTHY;
        }
        return {
            state,
            secsSinceLast: this.swLastHealthyEvent.elapsed,
            secsSinceFirst: this.firstHealthyEvent
                ? Math.floor((Date.now() - this.firstHealthyEvent) / 1000)
                : Infinity,
        }
    }
}

type HealthEventMonitorStatus = HealthEventMonitor['status'];


/**
 * Helper to get the time tags for error messages
 */
export const getMonitorTimeTags = (
    heartBeat: HealthEventMonitorStatus,
    healthCheck: HealthEventMonitorStatus,
    processUptime: number,
) => {
    const secs = (s: number) => Number.isFinite(s) ? secsToShortestDuration(s, { round: false }) : '--';
    const procTime = secsToShortestDuration(processUptime);
    const hbTime = secs(heartBeat.secsSinceLast);
    const hcTime = secs(healthCheck.secsSinceLast);
    return {
        simple: `(HB:${hbTime}|HC:${hcTime})`,
        withProc: `(P:${procTime}|HB:${hbTime}|HC:${hcTime})`,
    }
}


/**
 * Processes a MonitorIssuesArray and returns a clean array of strings.
 */
export const cleanMonitorIssuesArray = (issues: MonitorIssuesArray | undefined) => {
    if (!issues || !Array.isArray(issues)) return [];

    let cleanIssues: string[] = [];
    for (const issue of issues) {
        if (!issue) continue;
        if (typeof issue === 'string') {
            cleanIssues.push(issue);
        } else {
            cleanIssues.push(...issue.all.filter(Boolean));
        }
    }
    return cleanIssues;
}


/**
 * Helper class to organize monitor issues.
 */
export class MonitorIssue {
    private readonly infos: string[] = [];
    private readonly details: string[] = [];
    constructor(public title: string) { }
    setTitle(title: string) {
        this.title = title;
    }
    addInfo(info: string | undefined) {
        if (!info) return;
        this.infos.push(info);
    }
    addDetail(detail: string | undefined) {
        if (!detail) return;
        this.details.push(detail);
    }
    get all() {
        return [this.title, ...this.infos, ...this.details];
    }
}




//RUSTTODO: removed HTTP-based health check functions, now using RCON serverinfo
export type VerboseErrorData = {
    error: string,
    debugData: Record<string, string>,
}
