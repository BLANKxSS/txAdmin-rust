import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import consoleFactory from '@lib/console';
const console = consoleFactory();


/**
 * Returns the first likely server.cfg given a server data path, or false
 */
export const findLikelyCFGPath = (serverDataPath: string) => {
    //RUSTTODO: Rust server config usually lives at <identity>/cfg/server.cfg
    const commonCfgFileNames = [
        'server/main/cfg/server.cfg',
        'server.cfg',
        'server.cfg.txt',
        'server.cfg.cfg',
        'server.txt',
        'server',
    ];

    for (const cfgFileName of commonCfgFileNames) {
        const absoluteCfgPath = path.join(serverDataPath, cfgFileName);
        try {
            if (fs.lstatSync(absoluteCfgPath).isFile()) {
                return cfgFileName;
            }
        } catch (error) { }
    }
    return false;
}


/**
 * Returns the absolute path of the given CFG Path
 */
export const resolveCFGFilePath = (cfgPath: string, dataPath: string) => {
    return (path.isAbsolute(cfgPath)) ? path.normalize(cfgPath) : path.resolve(dataPath, cfgPath);
};


/**
 * Reads CFG Path and return the file contents, or throw error if:
 *  - the path is not valid (must be absolute)
 *  - cannot read the file data
 */
export const readRawCFGFile = async (cfgPath: string) => {
    //Validating if the path is absolute
    if (!path.isAbsolute(cfgPath)) {
        throw new Error('File path must be absolute.');
    }

    //Validating file existence
    if (!fs.existsSync(cfgPath)) {
        throw new Error("File doesn't exist or its unreadable.");
    }

    //Validating if its actually a file
    if (!fs.lstatSync(cfgPath).isFile()) {
        throw new Error("File doesn't exist or its unreadable. Make sure to include the CFG file in the path, and not just the directory that contains it.");
    }

    //Reading file
    try {
        return await fsp.readFile(cfgPath, 'utf8');
    } catch (error) {
        throw new Error('Cannot read CFG file.');
    }
};


/**
 * Parse a cfg/console line and return an array of commands with tokens.
 * Notable difference: we don't handle inline block comment
 */
export const readLineCommands = (input: string) => {
    let inQuote = false;
    let inEscape = false;
    const prevCommands = [];
    let currCommand = [];
    let currToken = '';
    for (let i = 0; i < input.length; i++) {
        if (inEscape) {
            if (input[i] === '"' || input[i] === '\\') {
                currToken += input[i];
            }
            inEscape = false;
            continue;
        }

        if (!currToken.length) {
            if (
                input.slice(i, i + 2) === '//'
                || input[i] === '#'
            ) {
                break;
            }
        }

        if (!inQuote && input.charCodeAt(i) <= 32) {
            if (currToken.length) {
                currCommand.push(currToken);
                currToken = '';
            }
            continue;
        }

        if (input[i] === '"') {
            if (inQuote) {
                currCommand.push(currToken);
                currToken = '';
                inQuote = false;
            } else {
                inQuote = true;
            }
            continue;
        }

        if (input[i] === '\\') {
            inEscape = true;
            continue;
        }

        if (!inQuote && input[i] === ';') {
            if (currToken.length) {
                currCommand.push(currToken);
                currToken = '';
            }
            prevCommands.push(currCommand);
            currCommand = [];
            continue;
        };

        currToken += input[i];
    }
    if (currToken.length) {
        currCommand.push(currToken);
    }
    prevCommands.push(currCommand);

    return prevCommands;
};


/**
 * Validates the server config file.
 * RUSTTODO: FXServer-specific validation (endpoints, convars, onesync, etc) is not
 * applicable for Rust server configs. This only verifies the file is readable and
 * always reports "valid / no issues", making the CFG editor a plain text editor.
 */
export const validateFixServerConfig = async (cfgPath: string, serverDataPath: string) => {
    //Verify the file exists and is readable (throws to the caller otherwise)
    const cfgAbsolutePath = resolveCFGFilePath(cfgPath, serverDataPath);
    await readRawCFGFile(cfgAbsolutePath);

    //RUSTTODO: no cfg validation for Rust - always valid, no issues
    return {
        connectEndpoint: null as string | null,
        errors: null as string | null,
        warnings: null as string | null,
    };
};


/**
 * Saving the config file + backup, without any validation (plain text editor behavior).
 * RUSTTODO: FXServer cfg content validation removed - Rust configs are free-form.
 * Returns if saved, and warnings (always null).
 */
export const validateModifyServerConfig = async (
    cfgInputString: string,
    cfgPath: string,
    serverDataPath: string
) => {
    if (typeof cfgInputString !== 'string') {
        throw new Error('cfgInputString expected to be string.');
    }

    //Save file + backup
    const cfgAbsolutePath = resolveCFGFilePath(cfgPath, serverDataPath);
    try {
        console.warn(`Saving modified file '${cfgAbsolutePath}'`);
        try {
            await fsp.copyFile(cfgAbsolutePath, `${cfgAbsolutePath}.bkp`);
        } catch (error) {
            //Backup is best-effort - the file might not exist yet
        }
        await fsp.writeFile(cfgAbsolutePath, cfgInputString, 'utf8');
    } catch (error) {
        throw new Error(`Failed to edit 'server.cfg' with error: ${(error as Error).message}`);
    }

    return {
        success: true,
        errors: null as string | null,
        warnings: null as string | null,
    };
};
