const modulename = 'WebServer:SetupPost';
import path from 'node:path';
import fse from 'fs-extra';
import fsp from 'node:fs/promises';
import slash from 'slash';
import { validateFixServerConfig, findLikelyCFGPath } from '@lib/fxserver/fxsConfigHelper';
import consoleFactory from '@lib/console';
import { TxConfigState } from '@shared/enums';
const console = consoleFactory(modulename);

//Helper functions
const isUndefined = (x) => (x === undefined);

/**
 * Handle all the server control actions
 * @param {import('@modules/WebServer/ctxTypes').AuthedCtx} ctx
 */
export default async function SetupPost(ctx) {
    //Sanity check
    if (isUndefined(ctx.params.action)) {
        return ctx.utils.error(400, 'Invalid Request');
    }
    const action = ctx.params.action;

    //Check permissions
    if (!ctx.admin.testPermission('all_permissions', modulename)) {
        return ctx.send({
            success: false,
            message: 'You need to be the admin master or have all permissions to use the setup page.',
        });
    }

    //Ensure the correct state for the setup page
    if (txManager.configState !== TxConfigState.Setup) {
        return ctx.send({
            success: false,
            refresh: true,
        });
    }

    //Delegate to the specific action functions
    if (action == 'validateLocalDataFolder') {
        return await handleValidateLocalDataFolder(ctx);
    } else if (action == 'browseFolder') {
        return await handleBrowseFolder(ctx);
    } else if (action == 'validateCFGFile') {
        return await handleValidateCFGFile(ctx);
    } else if (action == 'save' && ctx.request.body.type == 'local') {
        return await handleSaveLocal(ctx);
    } else {
        return ctx.send({
            success: false,
            message: 'Unknown setup action.',
        });
    }
};


/**
 * Lists drives (at root) or subfolders of a given path so the panel can browse
 * the server's filesystem to pick an install/server location.
 * @param {import('@modules/WebServer/ctxTypes').AuthedCtx} ctx
 */
async function handleBrowseFolder(ctx) {
    const reqPath = typeof ctx.request.body.path === 'string' ? ctx.request.body.path.trim() : '';

    //Root: enumerate available Windows drives
    if (!reqPath) {
        const drives = [];
        for (let i = 67; i <= 90; i++) { //C..Z
            const drive = `${String.fromCharCode(i)}:\\`;
            if (fse.existsSync(drive)) drives.push({ name: drive, path: drive });
        }
        return ctx.send({ success: true, current: '', parent: null, folders: drives });
    }

    //List subdirectories of the requested path
    try {
        const normalized = path.normalize(reqPath);
        const entries = await fsp.readdir(normalized, { withFileTypes: true });
        const folders = entries
            .filter((e) => {
                try { return e.isDirectory(); } catch { return false; }
            })
            .map((e) => ({ name: e.name, path: path.join(normalized, e.name) }))
            .sort((a, b) => a.name.localeCompare(b.name));
        const parent = path.dirname(normalized);
        return ctx.send({
            success: true,
            current: normalized,
            parent: parent === normalized ? '' : parent, //'' → back to drive list
            folders,
        });
    } catch (error) {
        return ctx.send({ success: false, message: `Cannot open folder: ${error.message}` });
    }
}


/**
 * Handle Validation of Local (existing) Server Data Folder
 * @param {import('@modules/WebServer/ctxTypes').AuthedCtx} ctx
 */
async function handleValidateLocalDataFolder(ctx) {
    //Sanity check
    if (isUndefined(ctx.request.body.dataFolder)) {
        return ctx.utils.error(400, 'Invalid Request - missing parameters');
    }
    const dataFolderPath = slash(path.normalize(ctx.request.body.dataFolder.trim() + '/'));

    //Validate Rust server folder (must contain RustDedicated.exe)
    try {
        if (!fse.existsSync(path.join(dataFolderPath, 'RustDedicated.exe'))) {
            throw new Error("Couldn't locate RustDedicated.exe in the path provided.");
        } else {
            return ctx.send({
                success: true,
                detectedConfig: findLikelyCFGPath(dataFolderPath),
            });
        }
    } catch (error) {
        return ctx.send({success: false, message: error.message});
    }
}


/**
 * Handle Validation of CFG File
 * @param {import('@modules/WebServer/ctxTypes').AuthedCtx} ctx
 */
async function handleValidateCFGFile(ctx) {
    //Sanity check
    if (
        isUndefined(ctx.request.body.dataFolder)
        || isUndefined(ctx.request.body.cfgFile)
    ) {
        return ctx.utils.error(400, 'Invalid Request - missing parameters');
    }

    const dataFolderPath = slash(path.normalize(ctx.request.body.dataFolder.trim()));
    const cfgFilePathNormalized = slash(path.normalize(ctx.request.body.cfgFile.trim()));

    //Validate file
    try {
        const result = await validateFixServerConfig(cfgFilePathNormalized, dataFolderPath);
        if (result.errors) {
            const message = `**The file path is correct, but there are error(s) in your config file(s):**\n${result.errors}`;
            return ctx.send({success: false, markdown: true, message});
        } else {
            return ctx.send({success: true});
        }
    } catch (error) {
        const message = `Error:\n ${error.message}.`;
        return ctx.send({success: false, message});
    }
}


/**
 * Handle Save settings for local server data imports
 * Actions: sets serverDataPath/cfgPath, starts the server, redirect to live console
 * @param {import('@modules/WebServer/ctxTypes').AuthedCtx} ctx
 */
async function handleSaveLocal(ctx) {
    //Sanity check
    if (
        isUndefined(ctx.request.body.name)
        || isUndefined(ctx.request.body.dataFolder)
        || isUndefined(ctx.request.body.cfgFile)
    ) {
        return ctx.utils.error(400, 'Invalid Request - missing parameters');
    }

    //Prepare body input
    const cfg = {
        name: ctx.request.body.name.trim(),
        dataFolder: slash(path.normalize(ctx.request.body.dataFolder + '/')),
        cfgFile: slash(path.normalize(ctx.request.body.cfgFile)),
    };

    //Validating Server Data Path (must contain RustDedicated.exe)
    try {
        const stat = await fsp.stat(path.join(cfg.dataFolder, 'RustDedicated.exe'))
        if (!stat.isFile()) {
            throw new Error('RustDedicated.exe is not a file');
        }
    } catch (error) {
        let msg = error?.message ?? 'unknown error';
        if (error?.code === 'ENOENT') {
            msg = 'Could not find RustDedicated.exe in the server folder.';
        }
        return ctx.send({success: false, message: `<strong>Server Folder error:</strong> ${msg}`});
    }

    //Preparing & saving config
    try {
        txCore.configStore.saveConfigs({
            general: {
                serverName: cfg.name,
            },
            server: {
                dataPath: cfg.dataFolder,
                cfgPath: cfg.cfgFile,
            }
        }, ctx.admin.name);
    } catch (error) {
        console.warn(`[${ctx.admin.name}] Error changing global/fxserver settings via setup stepper.`);
        console.verbose.dir(error);
        return ctx.send({
            type: 'danger',
            markdown: true,
            message: `**Error saving the configuration file:**\n${error.message}`
        });
    }

    //Logging
    ctx.admin.logAction('Changing global/fxserver settings via setup stepper.');

    //If running (for some reason), kill it first 
    if (!txCore.fxRunner.isIdle) {
        ctx.admin.logCommand('STOP SERVER');
        await txCore.fxRunner.killServer('new server set up', ctx.admin.name, true);
    }

    //Starting server
    const spawnError = await txCore.fxRunner.spawnServer(false);
    if (spawnError !== null) {
        return ctx.send({success: false, markdown: true, message: spawnError});
    } else {
        return ctx.send({success: true});
    }
}
