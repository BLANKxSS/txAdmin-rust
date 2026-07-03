import fs from 'node:fs';
import path from 'node:path';
import chokidar from 'chokidar';
import debounce from 'lodash/debounce.js';
import esbuild, { BuildOptions } from 'esbuild';
import {
    copyStaticFiles,
    getPublishVersion,
} from './utils';
import config from './config';
import { parseTxDevEnv } from '../../shared/txDevEnv';
import { TxAdminRunner } from './TxAdminRunner';
process.loadEnvFile();

//Reset terminal
process.stdout.write('.\n'.repeat(40) + '\x1B[2J\x1B[H');

//Load the env vars, and check for the required ones
const txDevEnv = parseTxDevEnv();
if (!txDevEnv.VITE_URL) {
    console.error(`Missing 'TXDEV_VITE_URL' env variable.`);
    console.error('Please read the docs/development.md file for more information.');
    process.exit(1);
}

//Setup - standalone: build into ./dist and run with the current node binary
const { txVersion, preReleaseExpiration } = getPublishVersion(true);
const distPath = path.resolve('./dist');
console.log(`[BUILDER] Starting txAdmin (Rust edition) Dev Builder at ${distPath}`);

//Sync target path and start chokidar
copyStaticFiles(distPath, txVersion, 'init');
const debouncedCopier = debounce((eventName) => {
    copyStaticFiles(distPath, txVersion, eventName);
}, config.debouncerInterval);
const staticWatcher = chokidar.watch(config.copy, {
    persistent: true,
    ignoreInitial: true,
});
staticWatcher.on('add', () => { debouncedCopier('add'); });
staticWatcher.on('change', () => { debouncedCopier('change'); });
staticWatcher.on('unlink', () => { debouncedCopier('unlink'); });
//The bundled core is CJS, but the repo root package.json is ESM
fs.mkdirSync(distPath, { recursive: true });
fs.writeFileSync(path.join(distPath, 'package.json'), '{"type":"commonjs"}');

//Create txAdmin process runner: node dist/core/index.js
const txInstance = new TxAdminRunner(
    path.resolve('.'),
    process.execPath,
    { ...txDevEnv, LAUNCH_ARGS: [path.join(distPath, 'core', 'index.js'), ...(txDevEnv.LAUNCH_ARGS ?? [])] },
);

//Listens on stdin for commands
process.stdin.on('data', (data) => {
    const cmd = data.toString().toLowerCase().trim();
    if (cmd === 'r' || cmd === 'rr') {
        txInstance.removeRebootPause();
        console.log(`[BUILDER] Restarting due to stdin request.`);
        txInstance.killServer();
        txInstance.spawnServer();
    } else if (cmd === 'p' || cmd === 'pause') {
        txInstance.toggleRebootPause();
    } else if (cmd === 'cls' || cmd === 'clear') {
        console.clear();
    }
});

//Transpile & bundle
//NOTE: "result" is {errors[], warnings[], stop()}
console.log('[BUILDER] Setting up esbuild.');
const buildOptions: BuildOptions = {
    //no minify, no banner
    entryPoints: ['./core'],
    bundle: true,
    sourcemap: 'linked',
    outfile: path.join(distPath, 'core', 'index.js'),
    platform: 'node',
    target: 'node22',
    format: 'cjs', //typescript builds to esm and esbuild converts it to cjs
    charset: 'utf8',
    define: { TX_PRERELEASE_EXPIRATION: preReleaseExpiration },
};
const plugins: BuildOptions['plugins'] = [{
    name: 'txRestarter',
    setup(build) {
        build.onStart(() => {
            console.log(`[BUILDER] Build started.`);
            txInstance.killServer();
        });
        build.onEnd(({ errors }) => {
            if (errors.length) {
                console.log(`[BUILDER] Failed with errors.`);
            } else {
                console.log('[BUILDER] Finished build.');
                txInstance.spawnServer();
            }
        });
    },
}];

try {
    const esbuildCtx = await esbuild.context({ ...buildOptions, plugins });
    await esbuildCtx.watch();
} catch (error) {
    console.log('[BUILDER] Something went very wrong.');
    process.exit(1);
}
