const modulename = 'UpdateChecker';
import { txEnv } from '@core/globalData';
import consoleFactory from '@lib/console';
import { UpdateDataType } from '@shared/otherTypes';
import { UpdateAvailableEventType } from '@shared/socketioTypes';
import { queryChangelogApi } from './queryChangelogApi';
import { getUpdateRolloutDelay } from './updateRollout';
const console = consoleFactory(modulename);


type CachedDelayType = {
    ts: number,
    diceRoll: number,
}

/**
 * Creates a cache string.
 */
const createCacheString = (delayData: CachedDelayType) => {
    return `${delayData.ts},${delayData.diceRoll}`;
}


/**
 * Parses the cached string.
 * Format: "ts,diceRoll"
 */
const parseCacheString = (raw: any) => {
    if (typeof raw !== 'string' || !raw) return;
    const [ts, diceRoll] = raw.split(',');
    const obj = {
        ts: parseInt(ts),
        diceRoll: parseInt(diceRoll),
    } satisfies CachedDelayType;
    if (isNaN(obj.ts) || isNaN(obj.diceRoll)) return;
    return obj;
}


/**
 * Rolls dice, gets integer between 0 and 100
 */
const rollDice = () => {
    return Math.floor(Math.random() * 101);
}

const DELAY_CACHE_KEY = 'updateDelay';


//RUSTTODO: Rust version checking not implemented - no upstream changelog API for standalone builds
export default class UpdateChecker {
    txaUpdateData?: UpdateDataType;
    fxsUpdateData?: UpdateDataType;

    constructor() {
        //RUSTTODO: Update checking is silently disabled for Rust standalone mode
        console.verbose.debug('UpdateChecker initialized (no-op for Rust standalone)');
    }


    /**
     * Check for updates (disabled for Rust standalone)
     */
    async checkChangelog() {
        //RUSTTODO: No-op - Rust version checking not implemented
        return;
    }
};

/*
    TODO:
    Create an page with the changelog, that queries for the following endpoint and caches it for 15 minutes:
        https://changelogs-live.fivem.net/api/changelog/versions/2385/2375?tag=server
    Maybe even grab the data from commits:
        https://changelogs-live.fivem.net/api/changelog/versions/5562
    Other relevant apis:
        https://changelogs-live.fivem.net/api/changelog/versions/win32/server? (the one being used below)
        https://changelogs-live.fivem.net/api/changelog/versions
        https://api.github.com/repos/tabarra/txAdmin/releases (changelog in [].body)

    NOTE: old logic
    if == recommended, you're fine
    if > recommended && < optional, pls update to optional
    if == optional, you're fine
    if > optional && < latest, pls update to latest
    if == latest, duh
    if < critical, BIG WARNING
*/
