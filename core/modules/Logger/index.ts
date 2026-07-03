const modulename = 'Logger';
import type { Options as RfsOptions } from 'rotating-file-stream';
import AdminLogger from './handlers/admin';
import FXServerLogger from './FXServerLogger';
import ServerLogger from './handlers/server';
import { getLogSizes } from './loggerUtils.js';
import consoleFactory from '@lib/console';
import { txEnv } from '@core/globalData';
const console = consoleFactory(modulename);


/**
 * Logger module that holds the scope-specific loggers and provides some utility functions.
 */
export default class Logger {
    private readonly basePath = `${txEnv.profilePath}/logs/`;
    public readonly admin: AdminLogger;
    public readonly fxserver: FXServerLogger;
    public readonly server: ServerLogger;

    constructor() {
        this.admin = new AdminLogger(this.basePath, txConfig.logger.admin);
        this.fxserver = new FXServerLogger(this.basePath, txConfig.logger.fxserver);
        this.server = new ServerLogger(this.basePath, txConfig.logger.server);

        //Rust has no in-game resource pushing log events, so the server log is fed
        //by translating the RCON broadcast stream (chat + death lines).
        //NOTE: deferred because txCore cannot be accessed during module construction.
        setImmediate(() => {
            txCore.rustRcon.onMessage(this.translateRustBroadcast.bind(this));
        });
    }


    /**
     * Translates Rust RCON broadcast lines into server log events (chat, deaths).
     */
    private translateRustBroadcast(line: { type: string; message: string }) {
        try {
            const findNetid = (steamId64: string) => {
                const hex = BigInt(steamId64).toString(16);
                return txCore.fxPlayerlist.getOnlinePlayersByLicense(hex)[0]?.netid ?? 'tx';
            };

            if (line.type === 'chat') {
                //Message is a JSON string: { Channel, Message, UserId, Username, Color, Time }
                const chat = JSON.parse(line.message);
                if (typeof chat?.Message !== 'string' || !chat.Message.length) return;
                this.server.write([{
                    ts: Date.now(),
                    src: typeof chat.UserId === 'string' && /^\d{17}$/.test(chat.UserId)
                        ? findNetid(chat.UserId)
                        : 'tx',
                    type: 'ChatMessage',
                    data: { author: chat.Username ?? 'unknown', text: chat.Message },
                }]);
            } else if (line.type === 'generic') {
                //Death lines look like: Name[212029/76561198000000000] was killed by Boar (Boar)
                const death = line.message.match(/^(.+?)\[(?:\d+\/)?(\d{17})\] (?:was killed by|died) (.+)$/);
                if (death) {
                    this.server.write([{
                        ts: Date.now(),
                        src: findNetid(death[2]),
                        type: 'DeathNotice',
                        data: { cause: death[3] },
                    }]);
                }
            }
        } catch { /* never let a log line break the stream */ }
    }


    /**
     * Returns the total size of the log files used.
     */
    getUsageStats() {
        //{loggerName: statsString}
        throw new Error('Not yet implemented.');
    }


    /**
     * Return the total size of the log files used.
     * FIXME: this regex is kinda redundant with the one from loggerUtils.js
     */
    async getStorageSize() {
        return await getLogSizes(
            this.basePath,
            /^(admin|fxserver|server)(_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}(_\d+)?)?.log$/,
        );
    }
};
