const modulename = 'FxPlayerlist';
import { cloneDeep } from 'lodash-es';
import { ServerPlayer } from '@lib/player/playerClasses.js';
import { DatabaseActionWarnType, DatabasePlayerType } from '@modules/Database/databaseTypes';
import consoleFactory from '@lib/console';
import { PlayerDroppedEventType, PlayerJoiningEventType } from '@shared/socketioTypes';
const console = consoleFactory(modulename);


//MARK: Consts
const POLL_INTERVAL_MS = 15_000; //15s poll of `global.status` via RCON
const POLL_CMD_TIMEOUT_MS = 5_000;

//Translates Rust disconnect reasons into the canonical strings the playerDrop
//classifier already understands, so drops sort into the same categories as txAdmin
//(player-initiated / server-initiated / timeout) instead of 'unknown'.
const normalizeRustDropReason = (reason: string): string => {
    if (/^disconnect(ed)?$/i.test(reason)) return 'Exiting'; //player closed the game
    if (/timed? ?out/i.test(reason)) return 'Connection timed out';
    if (/^kick(ed)?:?\s*(.*)$/i.test(reason)) {
        const detail = reason.replace(/^kick(ed)?:?\s*/i, '');
        return `Disconnected by server: ${detail || 'kicked'}`;
    }
    return reason;
};

//Matches player lines from the `global.status` RCON response:
// <steamId64> "<name>" <ping> <connected>s <ip:port> [...]
const STATUS_PLAYER_LINE_REGEX = /^\s*(\d{17})\s+"([^"]*)"\s+(\d+)\s+([\d.]+s)\s+(\S+)/;


export type PlayerDropEvent = {
    type: 'txAdminPlayerlistEvent',
    event: 'playerDropped',
    id: number,
    reason: string, //need to check if this is always a string
    resource?: string,
    category?: number,
}


/**
 * Module that holds the server playerlist mirroring the Rust server's internal playerlist state, as well as
 * recently disconnected players' licenses for quick searches.
 *
 * Unlike FiveM (which pushed playerJoining/playerDropped events from the in-game resource), for Rust the
 * playerlist is obtained by polling the `global.status` RCON command every 15 seconds, parsing the player
 * lines, and diffing against the current list to synthesize join/drop events through the same handlers.
 *
 * NOTE: licenseCache will keep an array of ['mutex#id', license], to be used for searches from server log clicks.
 * The licenseCache will contain only the licenses from last 50k disconnected players, which should be one entire
 *  session for the q99.9 servers out there and weight around 4mb.
 * The idea is: all players with license will be in the database, so storing only license is enough to find them.
 *
 * NOTE: #playerlist keeps all players in this session, a heap snapshot revealed that an
 *  average player (no actions) will weight about 520 bytes, and the q9999 of max netid is ~22k,
 *  meaning that for 99.99 of the servers, the list will be under 11mb.
 * A list with 50k connected players will weight around 26mb, meaning no optimization is required there.
 */
export default class FxPlayerlist {
    #playerlist: (ServerPlayer | undefined)[] = []; //FIXME: make continuous array instead of indexed by netid
    licenseCache: [mutexid: string, license: string][] = [];
    licenseCacheLimit = 50_000; //mutex+id+license * 50_000 = ~4mb
    joinLeaveLog: [ts: number, isJoin: boolean][] = [];
    joinLeaveLogLimitTime = 30 * 60 * 1000; //30 mins, [ts+isJoin] * 100_000 = ~4.3mb

    //Rust poll state
    #nextNetId = 1; //incrementing netid assigned per join
    #onlineSteamIds = new Map<string, number>(); //steamId64 -> netid
    #dropReasons = new Map<string, { reason: string, at: number }>(); //steamId64 -> disconnect reason
    #isPolling = false;

    constructor() {
        //Poll the playerlist via RCON every 15s
        setInterval(() => {
            this.pollPlayerlist().catch((error) => {
                console.verbose.warn('Error polling the server playerlist.');
                console.verbose.dir(error);
            });
        }, POLL_INTERVAL_MS);

        //Capture disconnect reasons from the console stream, since `global.status`
        //polling can only see that a player vanished, not why.
        //Line format: <ip:port>/<steamId64>/<name> disconnecting: <reason>
        //NOTE: deferred because txCore cannot be accessed during module construction.
        setImmediate(() => {
            txCore.rustRcon.onMessage((line) => {
                const match = line.message?.match(/\/(\d{17})\/.* disconnecting: (.+)$/);
                if (!match) return;
                this.#dropReasons.set(match[1], { reason: match[2].trim(), at: Date.now() });
            });
        });
    }


    /**
     * Polls the Rust server via RCON `global.status`, diffs the result against the current
     * playerlist, and synthesizes playerJoining/playerDropped events for the existing handlers.
     */
    private async pollPlayerlist() {
        if (this.#isPolling) return;
        if (!txCore.rustRcon?.isConnected) return;
        const mutex = txCore.fxRunner.child?.mutex;
        if (!mutex || !txCore.fxRunner.child?.isAlive) return;

        this.#isPolling = true;
        try {
            const response = await txCore.rustRcon.sendCommand('global.status', POLL_CMD_TIMEOUT_MS);
            const seenSteamIds = new Map<string, string>(); //steamId64 -> name
            for (const line of response.split('\n')) {
                const match = STATUS_PLAYER_LINE_REGEX.exec(line);
                if (!match) continue;
                const [, steamId64, name] = match;
                seenSteamIds.set(steamId64, name);
            }

            //Synthesize joins for new players
            for (const [steamId64, name] of seenSteamIds) {
                if (this.#onlineSteamIds.has(steamId64)) continue;
                const netid = this.#nextNetId++;
                this.#onlineSteamIds.set(steamId64, netid);
                await this.handleServerEvents({
                    event: 'playerJoining',
                    id: netid,
                    player: {
                        name: name || 'unknown',
                        ids: [`steam:${BigInt(steamId64).toString(16)}`],
                        hwids: [],
                    },
                }, mutex);
            }

            //Synthesize drops for missing players
            for (const [steamId64, netid] of this.#onlineSteamIds) {
                if (seenSteamIds.has(steamId64)) continue;
                this.#onlineSteamIds.delete(steamId64);
                const cachedReason = this.#dropReasons.get(steamId64);
                this.#dropReasons.delete(steamId64);
                //reasons older than 2 polls belong to a previous session
                const reason = (cachedReason && Date.now() - cachedReason.at < POLL_INTERVAL_MS * 2)
                    ? normalizeRustDropReason(cachedReason.reason)
                    : 'unknown';
                await this.handleServerEvents({
                    event: 'playerDropped',
                    id: netid,
                    reason,
                }, mutex);
            }
        } finally {
            this.#isPolling = false;
        }
    }


    /**
     * Number of online/connected players.
     */
    get onlineCount() {
        return this.#playerlist.filter(p => p && p.isConnected).length;
    }


    /**
     * Number of players that joined/left in the last hour.
     */
    get joinLeaveTally() {
        let toRemove = 0;
        const out = { joined: 0, left: 0 };
        const tsWindowStart = Date.now() - this.joinLeaveLogLimitTime;
        for (const [ts, isJoin] of this.joinLeaveLog) {
            if (ts > tsWindowStart) {
                out[isJoin ? 'joined' : 'left']++;
            } else {
                toRemove++;
            }
        }
        this.joinLeaveLog.splice(0, toRemove);
        return out;
    }


    /**
     * Handler for server restart - it will kill all players
     * We MUST do .disconnect() for all players to clear the timers.
     * NOTE: it's ok for us to overfill before slicing the licenseCache because it's at most ~4mb
     */
    handleServerClose(oldMutex: string) {
        for (const player of this.#playerlist) {
            if (player) {
                player.disconnect();
                if (player.license) {
                    this.licenseCache.push([`${oldMutex}#${player.netid}`, player.license]);
                }
            }
        }
        this.licenseCache = this.licenseCache.slice(-this.licenseCacheLimit);
        this.#playerlist = [];
        this.joinLeaveLog = [];
        this.#onlineSteamIds.clear();
        txCore.webServer.webSocket!.buffer('playerlist', {
            mutex: oldMutex,
            type: 'fullPlayerlist',
            playerlist: [],
        });
    }


    /**
     * To guarantee multiple instances of the same player license have their dbData synchronized,
     * this function (called by database.players.update) goes through every matching player
     * (except the source itself) to update their dbData.
     */
    handleDbDataSync(dbData: DatabasePlayerType, srcUniqueId: Symbol) {
        for (const player of this.#playerlist) {
            if (
                player instanceof ServerPlayer
                && player.isRegistered
                && player.license === dbData.license
                && player.uniqueId !== srcUniqueId
            ) {
                player.syncUpstreamDbData(dbData);
            }
        }
    }


    /**
     * Returns a playerlist array with ServerPlayer data of all connected players.
     * The data is cloned to prevent pollution.
     */
    getPlayerList() {
        return this.#playerlist
            .filter(p => p?.isConnected)
            .map((p) => {
                return cloneDeep({
                    netid: p!.netid,
                    displayName: p!.displayName,
                    pureName: p!.pureName,
                    license: p!.license,
                });
            });
    }


    /**
     * Returns a specifc ServerPlayer or undefined.
     * NOTE: this returns the actual object and not a deep clone!
     */
    getPlayerById(netid: number) {
        return this.#playerlist[netid]; //FIXME: do this.#playerlist.find() instead
    }


    /**
     * Returns a specifc ServerPlayer or undefined.
     * NOTE: this returns the actual object and not a deep clone!
     */
    getOnlinePlayersByLicense(searchLicense: string) {
        return this.#playerlist.filter(p => p && p.license === searchLicense && p.isConnected) as ServerPlayer[];
    }


    /**
     * Returns a set of all online players' licenses.
     */
    getOnlinePlayersLicenses() {
        return new Set(this.#playerlist.filter(p => p && p.isConnected).map(p => p!.license));
    }


    /**
     * Returns a list of online players' netids associated with each ID/HWID provided.
     */
    getAssociatedOnlineNetIds(targetIds: string[] | null = null, targetHwids: string[] | null = null) {
        type IdAssociation = [id: string, netid: number];
        if (!targetIds?.length && !targetHwids?.length) {
            return {
                idsFound: [] as IdAssociation[],
                hwidsFound: [] as IdAssociation[],
            }
        }
        const idsFound: IdAssociation[] = [];
        const hwidsFound: IdAssociation[] = [];
        for (const player of this.#playerlist.filter(p => p && p.isConnected) as ServerPlayer[]) {
            targetIds?.filter(id => player.idsOnline.includes(id)).forEach(id => {
                idsFound.push([id, player.netid]);
            });
            targetHwids?.filter(hwid => player.hwidsOnline.includes(hwid)).forEach(hwid => {
                hwidsFound.push([hwid, player.netid]);
            });
        }

        return { idsFound, hwidsFound };
    }


    /**
     * Receives initial data callback from ServerPlayer.
     * //RUSTTODO: previously dispatched pending warns to the FiveM in-game resource via a server
     * command, there is no Rust equivalent for showing a warn screen, so this is a no-op for now.
     */
    dispatchInitialPlayerData(playerId: number, pendingWarn: DatabaseActionWarnType) {
        //no-op
    }


    /**
     * Handler for all playerlist events (now synthesized from RCON polling diffs)
     * TODO: use zod for type safety
     */
    async handleServerEvents(payload: any, mutex: string) {
        const currTs = Date.now();
        if (payload.event === 'playerJoining') {
            try {
                if (typeof payload.id !== 'number') throw new Error(`invalid player id`);
                if (this.#playerlist[payload.id] !== undefined) throw new Error(`duplicated player id`);
                const svPlayer = new ServerPlayer(payload.id, payload.player, this);
                this.#playerlist[payload.id] = svPlayer;
                this.joinLeaveLog.push([currTs, true]);
                txCore.logger.server.write([{
                    type: 'playerJoining',
                    src: payload.id,
                    ts: currTs,
                    data: { ids: svPlayer.idsOnline }
                }], mutex);
                txCore.webServer.webSocket.buffer<PlayerJoiningEventType>('playerlist', {
                    mutex,
                    type: 'playerJoining',
                    netid: svPlayer.netid,
                    displayName: svPlayer.displayName,
                    pureName: svPlayer.pureName,
                    license: svPlayer.license,
                });
            } catch (error) {
                console.verbose.warn(`playerJoining event error: ${(error as Error).message}`);
            }

        } else if (payload.event === 'playerDropped') {
            try {
                if (typeof payload.id !== 'number') throw new Error(`invalid player id`);
                if (!(this.#playerlist[payload.id] instanceof ServerPlayer)) throw new Error(`player id not found`);
                this.#playerlist[payload.id]!.disconnect();
                this.joinLeaveLog.push([currTs, false]);
                const reasonCategory = txCore.metrics.playerDrop.handlePlayerDrop(payload);
                if (reasonCategory !== false) {
                    txCore.logger.server.write([{
                        type: 'playerDropped',
                        src: payload.id,
                        ts: currTs,
                        data: { reason: payload.reason }
                    }], mutex);
                }
                txCore.webServer.webSocket.buffer<PlayerDroppedEventType>('playerlist', {
                    mutex,
                    type: 'playerDropped',
                    netid: this.#playerlist[payload.id]!.netid,
                    reasonCategory: reasonCategory ? reasonCategory : undefined,
                });
            } catch (error) {
                console.verbose.warn(`playerDropped event error: ${(error as Error).message}`);
            }
        } else {
            console.warn(`Invalid event: ${payload?.event}`);
        }
    }
};
