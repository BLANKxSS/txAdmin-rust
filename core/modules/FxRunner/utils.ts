import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { Readable, Writable } from "node:stream";
import path from "path";


/**
 * Blackhole event logger
 */
let lastBlackHoleSpewTime = 0;
const blackHoleSpillMaxInterval = 5000;
export const childProcessEventBlackHole = (...args: any[]) => {
    const currentTime = Date.now();
    if (currentTime - lastBlackHoleSpewTime > blackHoleSpillMaxInterval) {
        //Let's call this "hawking radiation"
        console.verbose.error('ChildProcess unexpected event:');
        console.verbose.dir(args);
        lastBlackHoleSpewTime = currentTime;
    }
};


/**
 * Empty array for compatibility - mutable convars are no longer supported for Rust
 */
export const mutableConvarConfigDependencies: string[] = [];


/**
 * Returns the variables needed to spawn the Rust server
 */
export const getFxSpawnVariables = (): FxSpawnVariables => {
    if (!txConfig.server.dataPath) throw new Error('Missing server data path');
    if (!txConfig.server.serverExe) throw new Error('Missing server executable name');

    const gamePort = txConfig.server.gamePort;
    const queryPort = txConfig.server.queryPort;
    const rconPort = txConfig.server.rconPort;
    const rconPassword = txConfig.server.rconPassword;
    const identity = txConfig.server.identity;

    const cmdArgs = [
        '-batchmode',
        '+server.port', gamePort.toString(),
        '+server.queryport', queryPort.toString(),
        '+server.identity', identity,
        '+rcon.port', rconPort.toString(),
        '+rcon.password', rconPassword,
        '+rcon.web', '1',
        ...txConfig.server.startupArgs,
    ];

    const bin = path.join(txConfig.server.dataPath, txConfig.server.serverExe);

    return {
        bin,
        args: cmdArgs,
        serverName: txConfig.general.serverName,
        dataPath: txConfig.server.dataPath,
        cfgPath: txConfig.server.cfgPath,
    }
}

type FxSpawnVariables = {
    bin: string;
    args: string[];
    dataPath: string;
    cfgPath: string;
    serverName: string;
}


/**
 * Type guard for a valid child process
 */
export const isValidChildProcess = (p: any): p is ValidChildProcess => {
    if (!p) return false;
    if (typeof p.pid !== 'number') return false;
    if (!Array.isArray(p.stdio)) return false;
    if (p.stdio.length < 3) return false;
    if (!(p.stdio[0] instanceof Writable)) return false;
    if (!(p.stdio[1] instanceof Readable)) return false;
    if (!(p.stdio[2] instanceof Readable)) return false;
    return true;
};
export type ValidChildProcess = ChildProcessWithoutNullStreams & {
    pid: number;
    readonly stdio: [
        Writable,
        Readable,
        Readable,
    ];
};


/**
 * Sanitizes an argument for console input.
 */
export const sanitizeConsoleArgString = (arg: string) => {
    if (typeof arg !== 'string') throw new Error('unexpected type');
    return arg.replaceAll(/(?<!\\)"/g, '\"')
        .replaceAll(/;/g, '\u037e')
        .replaceAll(/\n/g, ' ');
}


/**
 * Stringifies the command arguments for console output.  
 * Arguments are wrapped in double quotes.
 * Double quotes are replaced by unicode equivalent.
 * Objects are JSON.stringified.  
 *   
 * NOTE: We expect the other side to know they have to parse non-string arguments.  
 *   
 * NOTE: Escaping double quotes is working, but escaping semicolon is bugged
 * and doesn't happen when there is an odd number of escaped double quotes in the argument.
 */
export const stringifyConsoleArgs = (args: (string | number | object)[]) => {
    const cleanArgs: string[] = [];
    for (const arg of args) {
        if (typeof arg === 'string') {
            cleanArgs.push(sanitizeConsoleArgString(JSON.stringify(arg)));
        } else if (typeof arg === 'number') {
            cleanArgs.push(sanitizeConsoleArgString(JSON.stringify(arg.toString())));
        } else if (typeof arg === 'object' && arg !== null) {
            const json = JSON.stringify(arg);
            const escaped = json.replaceAll(/"/g, '\\"');
            cleanArgs.push(`"${sanitizeConsoleArgString(escaped)}"`);
        } else {
            throw new Error('arg expected to be string or object');
        }
    }

    return cleanArgs.join(' ');
}


/**
 * Custom locale file setup is not applicable to Rust servers
 */
//RUSTTODO: no-op for compatibility
export const setupCustomLocaleFile = async () => {
    // No-op: Rust servers don't support custom locale files
};
