const modulename = 'WebServer:FXServerControls';
import { AuthedCtx } from '@modules/WebServer/ctxTypes';
import consoleFactory from '@lib/console';
import { ApiToastResp } from '@shared/genericApiTypes';
const console = consoleFactory(modulename);


/**
 * Handle all the server control actions
 */
export default async function FXServerControls(ctx: AuthedCtx) {
    //Sanity check
    if (typeof ctx.request.body?.action !== 'string') {
        return ctx.utils.error(400, 'Invalid Request');
    }
    const { action } = ctx.request.body;

    //Check permissions
    if (!ctx.admin.testPermission('control.server', modulename)) {
        return ctx.send<ApiToastResp>({
            type: 'error',
            msg: 'You don\'t have permission to execute this action.',
        });
    }

    if (action === 'restart') {
        ctx.admin.logCommand('RESTART SERVER');
        //Restarting a Rust server involves a graceful save+quit (up to ~10s) plus a
        //respawn delay, which is longer than the HTTP timeout — do it in the background.
        txCore.fxRunner.restartServer('admin request', ctx.admin.name).catch((e) => { });
        return ctx.send<ApiToastResp>({
            type: 'warning',
            msg: 'The server is now restarting. This may take a moment.',
        });

    } else if (action === 'stop') {
        if (txCore.fxRunner.isIdle) {
            return ctx.send<ApiToastResp>({ type: 'success', msg: 'The server is already stopped.' });
        }
        ctx.admin.logCommand('STOP SERVER');
        //Graceful save+quit can take several seconds — run in the background so the
        //request returns immediately; the panel reflects the state via websocket.
        txCore.fxRunner.killServer('admin request', ctx.admin.name, false).catch((e) => { });
        return ctx.send<ApiToastResp>({ type: 'warning', msg: 'The server is now stopping...' });

    } else if (action === 'start') {
        if (!txCore.fxRunner.isIdle) {
            return ctx.send<ApiToastResp>({
                type: 'error',
                msg: 'The server is already running. If it\'s not working, press RESTART.'
            });
        }
        ctx.admin.logCommand('START SERVER');
        const spawnError = await txCore.fxRunner.spawnServer(true);
        if (spawnError !== null) {
            return ctx.send<ApiToastResp>({ type: 'error', md: true, msg: spawnError });
        } else {
            return ctx.send<ApiToastResp>({ type: 'success', msg: 'The server is now starting.' });
        }

    } else {
        return ctx.send<ApiToastResp>({
            type: 'error',
            msg: `Unknown control action '${action}'.`,
        });
    }
};
