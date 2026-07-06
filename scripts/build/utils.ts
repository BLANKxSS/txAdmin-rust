import fs from 'node:fs';
import path from 'node:path';
import { SemVer } from 'semver';
import config from './config';


/**
 * txAdmin in ASCII
 */
export const txAdminASCII = () => {
    //NOTE: precalculating the ascii art for efficiency
    // const figlet = require('figlet');
    // let ascii = figlet.textSync('txAdmin');
    // let b64 = Buffer.from(ascii).toString('base64');
    // console.log(b64);
    const preCalculated = `ICBfICAgICAgICAgICAgXyAgICAgICBfICAgICAgICAgICBfICAgICAgIAogfCB8X19fICBfX
 yAgIC8gXCAgIF9ffCB8XyBfXyBfX18gKF8pXyBfXyAgCiB8IF9fXCBcLyAvICAvIF8gXCAvIF9gIHwgJ18gYCBfIFx8IHwg
 J18gXCAKIHwgfF8gPiAgPCAgLyBfX18gXCAoX3wgfCB8IHwgfCB8IHwgfCB8IHwgfAogIFxfXy9fL1xfXC9fLyAgIFxfXF9
 fLF98X3wgfF98IHxffF98X3wgfF98CiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA=`;
    return Buffer.from(preCalculated, 'base64').toString('ascii');
};


/**
 * txAdmin + license banner for bundled files
 */
export const licenseBanner = (baseDir = '.', isBundledFile = false) => {
    const licensePath = path.join(baseDir, 'LICENSE');
    const rootPrefix = isBundledFile ? '../' : '';
    const lineSep = '%'.repeat(80);
    const logoPad = ' '.repeat(18);
    const contentLines = [
        lineSep,
        ...txAdminASCII().split('\n').map((x) => logoPad + x),
        lineSep,
        'Author: André Tabarra (https://github.com/tabarra)',
        'Repository: https://github.com/tabarra/txAdmin',
        'txAdmin is a free open source software provided under the license below.',
        lineSep,
        ...fs.readFileSync(licensePath, 'utf8').trim().split('\n'),
        lineSep,
        'This distribution also includes third party code under their own licenses, which',
        `can be found in ${rootPrefix}THIRD-PARTY-LICENSES.txt or their respective repositories.`,
        `Attribution for non-code assets can be found at the bottom of ${rootPrefix}README.md or at`,
        'the top of the respective file.',
        lineSep,
    ];
    if (isBundledFile) {
        const flattened = contentLines.join('\n * ');
        return `/*!\n * ${flattened}\n */`;
    } else {
        return contentLines.join('\n');
    }
};


/**
 * Extracts the version from the TX_VERSION or GITHUB_REF env vars and detects if pre-release.
 * NOTE: to run locally: `TX_VERSION="9.9.9" npm run build`
 */
export const getPublishVersion = (isOptional: boolean) => {
    const workflowRef = process.env.TX_VERSION ?? process.env.GITHUB_REF;
    //Fallback (local builds without an explicit version): use the root package.json version
    //so the panel shows the real version instead of a placeholder.
    let pkgVersion = '0.0.0-dev';
    try {
        pkgVersion = JSON.parse(fs.readFileSync('./package.json', 'utf8')).version || pkgVersion;
    } catch { /* keep default */ }
    const fallback = {
        txVersion: pkgVersion,
        isPreRelease: false,
        preReleaseExpiration: '0',
    };
    try {
        if (!workflowRef) {
            if (isOptional) {
                return fallback;
            } else {
                throw new Error('No --tag found.');
            }
        }
        const refRemoved = workflowRef.replace(/^(refs\/(tags|heads)\/)?v?/, '');
        let parsedVersion;
        try {
            parsedVersion = new SemVer(refRemoved);
        } catch (error) {
            //eg. GITHUB_REF is a branch ref like refs/heads/main
            if (isOptional) return fallback;
            throw error;
        }
        const isPreRelease = parsedVersion.prerelease.length > 0;
        const potentialExpiration = new Date().setUTCHours(24 * config.preReleaseExpirationDays, 0, 0, 0);
        console.log(`txAdmin version ${parsedVersion.version}.`);
        return {
            txVersion: parsedVersion.version,
            isPreRelease,
            preReleaseExpiration: isPreRelease ? potentialExpiration.toString() : '0',
        };
    } catch (error) {
        console.error('Version setup failed: ' + error.message);
        process.exit(1);
    }
};


/**
 * Sync the files from local path to target path.
 * This function tried to remove the files before copying new ones,
 * therefore, first make sure the path is correct.
 * NOTE: each change, it resets the entire target path.
 */
export const copyStaticFiles = (targetPath: string, txVersion: string, eventName: string) => {
    console.log(`[COPIER][${eventName}] Syncing ${targetPath}.`);
    for (const srcPath of config.copy) {
        const destPath = path.join(targetPath, srcPath);
        fs.rmSync(destPath, { recursive: true, force: true });
        fs.cpSync(srcPath, destPath, { recursive: true });
    }
};
