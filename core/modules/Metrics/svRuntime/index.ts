const modulename = 'SvRuntimeMetrics';
import fsp from 'node:fs/promises';
import * as d3array from 'd3-array';
import consoleFactory from '@lib/console';
import { SvRtFileSchema, isSvRtLogDataType, isValidPerfThreadName, SvRtNodeMemorySchema } from './perfSchemas';
import type { SvRtFileType, SvRtLogDataType, SvRtLogType, SvRtNodeMemoryType, SvRtPerfBoundariesType, SvRtPerfCountsType } from './perfSchemas';
import { diffPerfs } from './perfUtils';
import { optimizeSvRuntimeLog } from './logOptimizer';
import { txEnv } from '@core/globalData';
import { ZodError } from 'zod';
import { PERF_DATA_BUCKET_COUNT, PERF_DATA_INITIAL_RESOLUTION, PERF_DATA_MIN_TICKS } from './config';
import { PerfChartApiResp } from '@routes/perfChart';
import { throttle } from 'throttle-debounce';
import { TimeCounter } from '../statsUtils';
import { FxMonitorHealth } from '@shared/enums';
const console = consoleFactory(modulename);


//Consts
const LOG_DATA_FILE_VERSION = 1;
const LOG_DATA_FILE_NAME = 'stats_svRuntime.json';
const FPS_SAMPLE_INTERVAL_MS = 10_000;

//Fixed frame time boundaries (in seconds) used to place the synthesized svMain "ticks" derived
//from the Rust server Framerate into a histogram compatible with the existing chart pipeline.
//RUSTTODO: only svMain gets real data (from fps), svNetwork/svSync stay empty.
const RUST_PERF_BOUNDARIES: SvRtPerfBoundariesType = [
    0.002, 0.004, 0.006, 0.008, 0.010,
    0.015, 0.020, 0.025, 0.033, 0.050,
    0.075, 0.100, 0.150, 0.250, '+Inf',
]; //length === PERF_DATA_BUCKET_COUNT (15)


/**
 * This module is reponsiple to collect many statistics from the server runtime
 * Most of those will be displayed on the Dashboard.
 */
export default class SvRuntimeMetrics {
    private readonly logFilePath = `${txEnv.profilePath}/data/${LOG_DATA_FILE_NAME}`;
    private statsLog: SvRtLogType = [];
    private lastFxsMemory: number | undefined;
    private lastNodeMemory: SvRtNodeMemoryType | undefined;
    private lastPerfBoundaries: SvRtPerfBoundariesType | undefined;
    private lastRawPerfData: SvRtPerfCountsType | undefined;
    private lastDiffPerfData: SvRtPerfCountsType | undefined;
    private lastRawPerfSaved: {
        ts: number,
        data: SvRtPerfCountsType,
    } | undefined;
    private queueSaveStatsHistory = throttle(
        15_000,
        this.saveStatsHistory.bind(this),
        { noLeading: true }
    );

    private fpsSamples: number[] = [];

    constructor() {
        setImmediate(() => {
            this.loadStatsHistory();
        });

        //Sample the fps from FxMonitor's cached serverinfo (no extra RCON traffic),
        //so each minute snapshot gets a real distribution instead of a single average.
        setInterval(() => {
            const fps = txCore.fxMonitor.rustServerInfo?.fps;
            if (typeof fps === 'number' && fps > 0) {
                this.fpsSamples.push(fps);
                if (this.fpsSamples.length > 30) this.fpsSamples.shift();
            }
        }, FPS_SAMPLE_INTERVAL_MS);

        //Cron functions
        setInterval(() => {
            this.collectStats().catch((error) => {
                console.verbose.warn('Error while collecting server stats.');
                console.verbose.dir(error);
            });
        }, 60 * 1000);
    }


    /**
     * Reset the last perf data except boundaries
     */
    private resetPerfState() {
        this.lastRawPerfData = undefined;
        this.lastDiffPerfData = undefined;
        this.lastRawPerfSaved = undefined;
    }


    /**
     * Reset the last perf data except boundaries
     */
    private resetMemoryState() {
        this.lastNodeMemory = undefined;
        this.lastFxsMemory = undefined;
    }


    /**
     * Registers that fxserver has BOOTED (FxMonitor is ONLINE)
     */
    public logServerBoot(duration: number) {
        this.resetPerfState();
        this.resetMemoryState();
        txCore.webServer.webSocket.pushRefresh('dashboard');

        //If last log is a boot, remove it as the server didn't really start 
        // otherwise it would have lived long enough to have stats logged
        if (this.statsLog.length && this.statsLog.at(-1)!.type === 'svBoot') {
            this.statsLog.pop();
        }
        this.statsLog.push({
            ts: Date.now(),
            type: 'svBoot',
            duration,
        });
        this.queueSaveStatsHistory();
    }


    /**
     * Registers that fxserver has CLOSED (fxRunner killing the process)
     */
    public logServerClose(reason: string) {
        this.resetPerfState();
        this.resetMemoryState();
        txCore.webServer.webSocket.pushRefresh('dashboard');

        if (this.statsLog.length) {
            if (this.statsLog.at(-1)!.type === 'svClose') {
                //If last log is a close, skip saving a new one
                return;
            } else if (this.statsLog.at(-1)!.type === 'svBoot') {
                //If last log is a boot, remove it as the server didn't really start
                this.statsLog.pop();
                return;
            }
        }
        this.statsLog.push({
            ts: Date.now(),
            type: 'svClose',
            reason,
        });
        this.queueSaveStatsHistory();
    }


    /**
     * Stores the last server Node.JS memory usage for later use in the data log 
     */
    public logServerNodeMemory(payload: SvRtNodeMemoryType) {
        const validation = SvRtNodeMemorySchema.safeParse(payload);
        if (!validation.success) {
            console.verbose.warn('Invalid LogNodeHeapEvent payload:');
            console.verbose.dir(validation.error.errors);
            return;
        }
        this.lastNodeMemory = {
            used: payload.used,
            limit: payload.limit,
        };
        txCore.webServer.webSocket.pushRefresh('dashboard');
    }


    /**
     * Get recent stats
     */
    public getRecentStats() {
        return {
            fxsMemory: this.lastFxsMemory,
            nodeMemory: this.lastNodeMemory,
            perfBoundaries: this.lastPerfBoundaries,
            perfBucketCounts: this.lastDiffPerfData ? {
                svMain: this.lastDiffPerfData.svMain.buckets,
                svNetwork: this.lastDiffPerfData.svNetwork.buckets,
                svSync: this.lastDiffPerfData.svSync.buckets,
            } : undefined,
        }
    }


    /**
     * Synthesizes a cumulative perf counter snapshot from the Rust server fps samples.
     * Each ~10s sample contributes its share of "ticks" to the histogram bucket matching
     * its frame time (1/fps), keeping the cumulative-buckets shape the chart expects.
     */
    private synthesizePerfMetrics(samples: number[]): SvRtPerfCountsType {
        const emptyThread = () => ({
            count: 0,
            sum: 0,
            buckets: Array(PERF_DATA_BUCKET_COUNT).fill(0) as number[],
        });
        const base = this.lastRawPerfData ?? {
            svSync: emptyThread(),
            svNetwork: emptyThread(),
            svMain: emptyThread(),
        };

        const boundaries = this.lastPerfBoundaries ?? RUST_PERF_BOUNDARIES;
        const sampleSpanSec = 60 / samples.length; //each sample represents this many seconds
        let addedTicks = 0;
        let addedTime = 0;
        const addedBuckets = Array(PERF_DATA_BUCKET_COUNT).fill(0) as number[];
        for (const fps of samples) {
            const tickTime = 1 / fps;
            const ticks = Math.round(fps * sampleSpanSec);
            addedTicks += ticks;
            addedTime += tickTime * ticks;
            for (let i = 0; i < PERF_DATA_BUCKET_COUNT; i++) {
                const boundary = boundaries[i];
                if (boundary === '+Inf' || tickTime <= boundary) {
                    addedBuckets[i] += ticks;
                }
            }
        }

        return {
            svSync: {
                count: base.svSync.count,
                sum: base.svSync.sum,
                buckets: [...base.svSync.buckets],
            },
            svNetwork: {
                count: base.svNetwork.count,
                sum: base.svNetwork.sum,
                buckets: [...base.svNetwork.buckets],
            },
            svMain: {
                count: base.svMain.count + addedTicks,
                sum: base.svMain.sum + addedTime,
                buckets: base.svMain.buckets.map((bucket, i) => bucket + addedBuckets[i]),
            },
        };
    }


    /**
     * Cron function to collect all the stats and save it to the cache file.
     * For Rust, the data source is FxMonitor's cached `serverinfo` data plus the
     * fps samples accumulated by the 10s sampler.
     */
    private async collectStats() {
        //Precondition checks
        const monitorStatus = txCore.fxMonitor.status;
        if (monitorStatus.health === FxMonitorHealth.OFFLINE) return; //collect even if partial
        if (monitorStatus.uptime < 30_000) return; //server barely booted
        if (!txCore.fxRunner.child?.isAlive) return;
        if (!txCore.rustRcon?.isConnected) return;

        //Drain the fps samples collected since the last minute
        const samples = this.fpsSamples;
        this.fpsSamples = [];
        if (!samples.length) {
            console.verbose.warn('No fps samples this minute. Skipping this collection.');
            return;
        }

        const serverInfo = txCore.fxMonitor.rustServerInfo;
        this.lastFxsMemory = (typeof serverInfo?.memoryMb === 'number' && serverInfo.memoryMb >= 0)
            ? serverInfo.memoryMb
            : undefined;

        //Check if first collection, or boundaries changed (eg. old fxserver data file)
        if (!this.lastPerfBoundaries) {
            console.verbose.debug('First perf collection.');
            this.lastPerfBoundaries = [...RUST_PERF_BOUNDARIES];
            this.resetPerfState();
        } else if (JSON.stringify(RUST_PERF_BOUNDARIES) !== JSON.stringify(this.lastPerfBoundaries)) {
            console.warn('Performance boundaries changed. Resetting history.');
            this.statsLog = [];
            this.lastPerfBoundaries = [...RUST_PERF_BOUNDARIES];
            this.resetPerfState();
        }

        //Synthesize the cumulative perf counters from the fps samples
        const perfMetrics = this.synthesizePerfMetrics(samples);

        //Check for min tick count (svMain only, the other threads are always empty on Rust)
        const minuteTicks = perfMetrics.svMain.count - (this.lastRawPerfData?.svMain.count ?? 0);
        if (minuteTicks < PERF_DATA_MIN_TICKS) {
            console.verbose.warn('Not enough ticks to log. Skipping this collection.');
            return;
        }

        //Calculate the tick/time counts since last collection (1m ago)
        this.lastDiffPerfData = diffPerfs(perfMetrics, this.lastRawPerfData);
        this.lastRawPerfData = perfMetrics;

        //Push the updated data to the dashboard ws room
        txCore.webServer.webSocket.pushRefresh('dashboard');

        //Check if enough time passed since last collection
        const now = Date.now();
        let perfToSave;
        if (!this.lastRawPerfSaved) {
            perfToSave = this.lastDiffPerfData;
        } else if (now - this.lastRawPerfSaved.ts >= PERF_DATA_INITIAL_RESOLUTION) {
            perfToSave = diffPerfs(perfMetrics, this.lastRawPerfSaved.data);
        }
        if (!perfToSave) return;

        //Get player count from serverinfo, fallback to the polled playerlist
        const playerCount = (typeof serverInfo?.players === 'number' && serverInfo.players >= 0)
            ? serverInfo.players
            : txCore.fxPlayerlist.onlineCount;

        //Update cache
        this.lastRawPerfSaved = {
            ts: now,
            data: perfMetrics,
        };
        const currSnapshot: SvRtLogDataType = {
            ts: now,
            type: 'data',
            players: playerCount,
            fxsMemory: this.lastFxsMemory ?? null,
            nodeMemory: this.lastNodeMemory?.used ?? null,
            perf: perfToSave,
        };
        this.statsLog.push(currSnapshot);
        // console.verbose.ok(`Collected performance snapshot #${this.statsLog.length}`);

        //Save perf series do file - not queued because it's priority
        this.queueSaveStatsHistory.cancel({ upcomingOnly: true });
        this.saveStatsHistory();
    }


    /**
     * Loads the stats database/cache/history
     */
    private async loadStatsHistory() {
        try {
            const rawFileData = await fsp.readFile(this.logFilePath, 'utf8');
            const fileData = JSON.parse(rawFileData);
            if (fileData?.version !== LOG_DATA_FILE_VERSION) throw new Error('invalid version');
            const statsData = SvRtFileSchema.parse(fileData);
            this.lastPerfBoundaries = statsData.lastPerfBoundaries;
            this.statsLog = statsData.log;
            this.resetPerfState();
            console.verbose.ok(`Loaded ${this.statsLog.length} performance snapshots from cache`);
            await optimizeSvRuntimeLog(this.statsLog);
        } catch (error) {
            if ((error as any)?.code === 'ENOENT') {
                console.verbose.debug(`${LOG_DATA_FILE_NAME} not found, starting with empty stats.`);
                return;
            }
            if (error instanceof ZodError) {
                console.warn(`Failed to load ${LOG_DATA_FILE_NAME} due to invalid data.`);
            } else {
                console.warn(`Failed to load ${LOG_DATA_FILE_NAME} with message: ${(error as Error).message}`);
            }
            console.warn('Since this is not a critical file, it will be reset.');
        }
    }


    /**
     * Saves the stats database/cache/history
     */
    private async saveStatsHistory() {
        try {
            await optimizeSvRuntimeLog(this.statsLog);
            const savePerfData: SvRtFileType = {
                version: LOG_DATA_FILE_VERSION,
                lastPerfBoundaries: this.lastPerfBoundaries,
                log: this.statsLog,
            };
            await fsp.writeFile(this.logFilePath, JSON.stringify(savePerfData));
        } catch (error) {
            console.warn(`Failed to save ${LOG_DATA_FILE_NAME} with message: ${(error as Error).message}`);
        }
    }


    /**
     * Returns the data for charting the performance of a specific thread
     */
    public getChartData(threadName: string): PerfChartApiResp {
        if (!isValidPerfThreadName(threadName)) return { fail_reason: 'invalid_thread_name' };
        if (!this.statsLog.length || !this.lastPerfBoundaries?.length) return { fail_reason: 'data_unavailable' };

        //Processing data
        return {
            boundaries: this.lastPerfBoundaries,
            threadPerfLog: this.statsLog.map((log) => {
                if (!isSvRtLogDataType(log)) return log;
                return {
                    ...log,
                    perf: log.perf[threadName],
                };
            })
        }
    }


    /**
     * Returns a summary of the collected data and returns.
     * NOTE: kinda expensive
     */
    public getServerPerfSummary() {
        //Configs
        const minSnapshots = 36; //3h of data
        const tsScanWindowStart = Date.now() - 6 * 60 * 60 * 1000; //6h ago

        //that's short for cumulative buckets, if you thought otherwise, i'm judging you
        const cumBuckets = Array(PERF_DATA_BUCKET_COUNT).fill(0);
        let cumTicks = 0;

        //Processing each snapshot - then each bucket
        let totalSnapshots = 0;
        const players = [];
        const fxsMemory = [];
        const nodeMemory = []
        for (const log of this.statsLog) {
            if (log.ts < tsScanWindowStart) continue;
            if (!isSvRtLogDataType(log)) continue;
            if (log.perf.svMain.count < PERF_DATA_MIN_TICKS) continue;
            totalSnapshots++
            players.push(log.players);
            fxsMemory.push(log.fxsMemory);
            nodeMemory.push(log.nodeMemory);
            for (let bIndex = 0; bIndex < PERF_DATA_BUCKET_COUNT; bIndex++) {
                const tickCount = log.perf.svMain.buckets[bIndex];
                cumTicks += tickCount;
                cumBuckets[bIndex] += tickCount;
            }
        }

        //Checking if at least 36 snapshots (3h of data) in the last 6h
        if (totalSnapshots < minSnapshots) {
            return null; //not enough data for meaningful analysis
        }

        //Formatting Output
        return {
            snaps: totalSnapshots,
            freqs: cumBuckets.map(cumAvg => cumAvg / cumTicks),
            players: d3array.median(players),
            fxsMemory: d3array.median(fxsMemory),
            nodeMemory: d3array.median(nodeMemory),
        };
    }
};
