import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';


/**
 * Standalone boot variables - no FXServer natives needed
 * This file is not supposed to validate or default any of the values.
 */
export const getNativeVars = (ignoreDeprecatedConfigs: boolean) => {
    //RUSTTODO: Standalone Rust server mode - no FXServer
    const fxsVersion = 'standalone';
    const fxsCitizenRoot = process.env.TXHOST_SERVER_PATH ?? 'D:/RustServer/server';

    //Resource
    const resourceName = 'txAdmin';

    //txAdmin app path: repo root when running from source, dist/ when bundled.
    //NOTE: import.meta.url does not survive the esbuild CJS bundle, hence the fallbacks.
    let txaResourcePath: string;
    if (process.env.TXHOST_TXA_PATH) {
        txaResourcePath = path.resolve(process.env.TXHOST_TXA_PATH);
    } else if (typeof __dirname === 'string') {
        //bundled CJS: <dist>/core/index.js → <dist>
        txaResourcePath = path.resolve(__dirname, '..');
    } else {
        //TS source: core/boot/getNativeVars.ts → repo root
        txaResourcePath = path.resolve(fileURLToPath(import.meta.url), '../../..');
    }

    //Read txAdmin version from the repo root package.json
    let txaResourceVersion = '1.0.0';
    try {
        const packageJsonPath = path.join(txaResourcePath, 'package.json');
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
        txaResourceVersion = packageJson.version ?? '1.0.0';
    } catch (error) {
        console.warn('Failed to read package.json version, using default');
    }

    //Profile Convar - with warning
    const txAdminProfile = process.env.TXADMIN_PROFILE;
    if (txAdminProfile) {
        console.warn(`WARNING: The 'TXADMIN_PROFILE' env var is deprecated and will be removed in a future update.`);
        console.warn(`         To create multiple servers, set up a different TXHOST_DATA_PATH instead.`);
    }

    //The old ConVar system is gone - TXHOST_* env vars are read by getHostVars(),
    //so the legacy slots stay undefined to avoid double-source warnings.
    const txDataPath = undefined;
    const txAdminPort = undefined;
    const txAdminInterface = undefined;

    //Final object
    return {
        fxsVersion,
        fxsCitizenRoot,
        resourceName,
        txaResourceVersion,
        txaResourcePath,

        //custom vars
        txAdminProfile,
        txDataPath,
        txAdminPort,
        txAdminInterface,
    };
}
