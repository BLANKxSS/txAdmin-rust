const modulename = 'WebServer:ServerInstaller';
import consoleFactory from '@lib/console';
import type { AuthedCtx } from '@modules/WebServer/ctxTypes';
import type { ApiToastResp } from '@shared/genericApiTypes';
import { z } from 'zod';
import { fromError } from 'zod-validation-error';
const console = consoleFactory(modulename);


//Request/Response types
export type ServerInstallerStartReq = {
    targetPath: string;
};
export type ServerInstallerStartResp = ApiToastResp & {
    started?: boolean;
};
export type ServerInstallerProgressResp = {
    running: boolean;
    done: boolean;
    failed: boolean;
    step: string;
    percent: number;
    serverPath: string | null;
    log: string[];
};

//Validation schemas
const startBodySchema = z.object({
    targetPath: z.string().min(1, 'Target path is required'),
});


/**
 * POST /serverInstaller/start
 * Start a new Rust server installation
 */
export default async function serverInstaller_start(ctx: AuthedCtx) {
    // Check permissions - setup/installer requires master
    if (!ctx.admin.testPermission('all_permissions', modulename)) {
        return ctx.send({
            type: 'error',
            msg: 'You don\'t have permission to install the server.',
        } as ServerInstallerStartResp);
    }

    // Validate input
    const bodyRes = startBodySchema.safeParse(ctx.request.body);
    if (!bodyRes.success) {
        return ctx.send({
            type: 'error',
            title: 'Invalid Request',
            msg: fromError(bodyRes.error, { prefix: null }).message,
        } as ServerInstallerStartResp);
    }

    const { targetPath } = bodyRes.data;

    // Start the installation
    const result = txCore.rustInstaller.start(targetPath);

    if (result.started) {
        console.log(`Server installation started at ${targetPath}`);
        return ctx.send({
            type: 'success',
            msg: 'Rust server installation started.',
            started: true,
        } as ServerInstallerStartResp);
    } else {
        console.warn(`Server installation failed to start: ${result.error}`);
        return ctx.send({
            type: 'error',
            title: 'Installation Error',
            msg: result.error || 'Failed to start installation',
            started: false,
        } as ServerInstallerStartResp);
    }
}


/**
 * GET /serverInstaller/progress
 * Get current installation status
 */
export async function serverInstaller_progress(ctx: AuthedCtx) {
    // Check permissions
    if (!ctx.admin.testPermission('all_permissions', modulename)) {
        return ctx.send({
            running: false,
            done: false,
            failed: false,
            step: 'unauthorized',
            percent: 0,
            serverPath: null,
            log: ['You don\'t have permission to view the installation status.'],
        } as ServerInstallerProgressResp);
    }

    // Get current status
    const status = txCore.rustInstaller.status;

    return ctx.send({
        running: status.running,
        done: status.done,
        failed: status.failed,
        step: status.step,
        percent: status.percent,
        serverPath: status.serverPath,
        log: status.log,
    } as ServerInstallerProgressResp);
}
