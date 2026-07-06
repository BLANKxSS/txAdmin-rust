const modulename = 'RustInstaller';
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { spawn } from 'node:child_process';
import https from 'node:https';
import consoleFactory from '@lib/console';
const console = consoleFactory(modulename);


type InstallerStatus = {
    running: boolean;
    done: boolean;
    failed: boolean;
    step: string;
    percent: number;
    serverPath: string | null;
    log: string[];
};

type StartResult = {
    started: boolean;
    error?: string;
};

/**
 * Manages Rust dedicated server auto-installation via SteamCMD.
 * Handles download, extraction, and installation in a background process.
 * Single background job safe via globalThis-safe instance state.
 */
export default class RustInstaller {
    private isRunning = false;
    private isDone = false;
    private isFailed = false;
    private currentStep = 'idle';
    private currentPercent = 0;
    private installedServerPath: string | null = null;
    private logLines: string[] = [];
    private readonly maxLogLines = 200;

    /**
     * Get current installation status
     */
    get status(): InstallerStatus {
        return {
            running: this.isRunning,
            done: this.isDone,
            failed: this.isFailed,
            step: this.currentStep,
            percent: this.currentPercent,
            serverPath: this.installedServerPath,
            log: [...this.logLines],
        };
    }

    /**
     * Start the installation process
     */
    start(targetPath: string): StartResult {
        // Guard: already running
        if (this.isRunning) {
            return { started: false, error: 'Installation already in progress' };
        }

        // Validate targetPath
        const validation = this.validateTargetPath(targetPath);
        if (validation.error) {
            return { started: false, error: validation.error };
        }

        // Reset state for new install
        this.isDone = false;
        this.isFailed = false;
        this.currentStep = 'idle';
        this.currentPercent = 0;
        this.installedServerPath = null;
        this.logLines = [];

        // Start async installation
        this.isRunning = true;
        this.performInstallation(targetPath).catch((error) => {
            console.error(`Installation error: ${(error as Error).message}`);
            this.isFailed = true;
            this.isRunning = false;
        });

        return { started: true };
    }

    /**
     * Validate target path: absolute, drive exists, can be created
     */
    private validateTargetPath(targetPath: string): { error?: string } {
        if (!targetPath) {
            return { error: 'Target path is empty' };
        }

        // Check if absolute
        if (!path.isAbsolute(targetPath)) {
            return { error: 'Target path must be absolute' };
        }

        // Check if drive exists (Windows only)
        const driveLetter = path.parse(targetPath).root;
        if (!fs.existsSync(driveLetter)) {
            return { error: `Drive ${driveLetter} does not exist` };
        }

        return {};
    }

    /**
     * Main installation flow
     */
    private async performInstallation(targetPath: string): Promise<void> {
        try {
            // Step 1: Create target directory
            this.addLog('Creating target directory...');
            await fsp.mkdir(targetPath, { recursive: true });
            this.addLog(`Target directory: ${targetPath}`);

            // Step 2: Ensure SteamCMD is available
            this.addLog('Checking SteamCMD...');
            await this.ensureSteamCMD(targetPath);

            // Step 3: Install Rust server
            this.addLog('Installing Rust server via SteamCMD...');
            await this.installRustServer(targetPath);

            // Step 4: Verify installation
            const serverExePath = path.join(targetPath, 'server', 'RustDedicated.exe');
            if (!fs.existsSync(serverExePath)) {
                throw new Error(
                    `Installation completed but RustDedicated.exe not found at ${serverExePath}. ` +
                    `Check SteamCMD log for errors.`
                );
            }

            this.installedServerPath = path.join(targetPath, 'server');
            this.currentStep = 'complete';
            this.currentPercent = 100;
            this.isDone = true;
            this.addLog('Installation complete!');
        } catch (error) {
            this.isFailed = true;
            this.addLog(`ERROR: ${(error as Error).message}`);
            console.error(`RustInstaller failed: ${(error as Error).message}`);
        } finally {
            this.isRunning = false;
        }
    }

    /**
     * Ensure SteamCMD is downloaded and extracted
     */
    private async ensureSteamCMD(targetPath: string): Promise<void> {
        const steamCmdPath = path.join(targetPath, 'steamcmd');
        const steamCmdExe = path.join(steamCmdPath, 'steamcmd.exe');

        // Already exists
        if (fs.existsSync(steamCmdExe)) {
            this.addLog('SteamCMD already installed');
            return;
        }

        this.currentStep = 'steamcmd';
        this.currentPercent = 10;

        // Download SteamCMD
        this.addLog('Downloading SteamCMD...');
        const zipPath = path.join(targetPath, 'steamcmd.zip');
        await this.downloadFile(
            'https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip',
            zipPath
        );
        this.addLog('SteamCMD downloaded');

        // Extract SteamCMD using PowerShell
        this.addLog('Extracting SteamCMD...');
        await this.extractZipWithPowerShell(zipPath, steamCmdPath);
        this.addLog('SteamCMD extracted');

        // Clean up zip
        try {
            await fsp.unlink(zipPath);
        } catch (error) {
            this.addLog(`Warning: Could not delete ${zipPath}`);
        }

        // Verify
        if (!fs.existsSync(steamCmdExe)) {
            throw new Error('SteamCMD extraction failed: steamcmd.exe not found');
        }

        this.currentPercent = 20;
    }

    /**
     * Download a file from a URL to a local path
     */
    private downloadFile(url: string, destPath: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const file = fs.createWriteStream(destPath);
            https.get(url, (response) => {
                if (response.statusCode !== 200) {
                    reject(new Error(`Failed to download: HTTP ${response.statusCode}`));
                    return;
                }
                response.pipe(file);
                file.on('finish', () => {
                    file.close();
                    resolve();
                });
                file.on('error', (err) => {
                    fs.unlink(destPath, () => {}); // ignore cleanup errors
                    reject(err);
                });
            }).on('error', (err) => {
                fs.unlink(destPath, () => {}); // ignore cleanup errors
                reject(err);
            });
        });
    }

    /**
     * Extract ZIP using PowerShell Expand-Archive
     */
    private extractZipWithPowerShell(zipPath: string, destPath: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const psCommand = `Expand-Archive -Force -Path "${zipPath}" -DestinationPath "${destPath}"`;
            const proc = spawn('powershell.exe', ['-NoProfile', '-Command', psCommand], {
                windowsHide: true,
            });

            let stderr = '';
            proc.stderr?.on('data', (data) => {
                stderr += data.toString();
            });

            proc.on('close', (code) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`PowerShell extraction failed: ${stderr || 'unknown error'}`));
                }
            });

            proc.on('error', (error) => {
                reject(new Error(`Failed to spawn PowerShell: ${(error as Error).message}`));
            });
        });
    }

    /**
     * Install Rust server via SteamCMD.
     * NOTE: SteamCMD self-updates on its first run and exits with a non-zero code
     * (commonly 7) *before* installing anything. Its exit code is therefore
     * unreliable — we judge success by whether RustDedicated.exe actually appears,
     * and re-run SteamCMD (which resumes the download) until it does.
     */
    private async installRustServer(targetPath: string): Promise<void> {
        this.currentStep = 'server';
        this.currentPercent = 25;

        const steamCmdExe = path.join(targetPath, 'steamcmd', 'steamcmd.exe');
        const serverInstallPath = path.join(targetPath, 'server');
        fs.mkdirSync(serverInstallPath, { recursive: true });
        const serverExe = path.join(serverInstallPath, 'RustDedicated.exe');

        const args = [
            '+force_install_dir', serverInstallPath,
            '+login', 'anonymous',
            '+app_update', '258550', 'validate',
            '+quit',
        ];

        const maxAttempts = 4;
        let lastCode: number | null = null;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            this.addLog(`Running SteamCMD (attempt ${attempt}/${maxAttempts})...`);
            lastCode = await this.runSteamCmd(steamCmdExe, args, targetPath);

            //Success is measured by the artifact, not the exit code
            if (fs.existsSync(serverExe)) {
                this.currentPercent = 100;
                this.addLog('RustDedicated.exe is present — install OK.');
                return;
            }
            this.addLog(`SteamCMD exited with code ${lastCode}; server files not complete yet, retrying...`);
        }

        throw new Error(
            `SteamCMD did not produce RustDedicated.exe after ${maxAttempts} attempts ` +
            `(last exit code ${lastCode}). See the log above for details.`
        );
    }

    /**
     * Runs SteamCMD once, streaming its output to the log, and resolves with the
     * exit code (never rejects except on spawn failure).
     */
    private runSteamCmd(steamCmdExe: string, args: string[], cwd: string): Promise<number> {
        return new Promise((resolve, reject) => {
            const proc = spawn(steamCmdExe, args, { cwd, windowsHide: true });

            const handleChunk = (data: Buffer, isErr = false) => {
                const lines = data.toString().split('\n');
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed) continue;
                    this.addLog(isErr ? `[stderr] ${trimmed}` : trimmed);
                    const progressMatch = trimmed.match(/progress:\s*([\d.]+)/i);
                    if (progressMatch) {
                        this.currentPercent = Math.min(99, Math.max(25, parseFloat(progressMatch[1])));
                    }
                }
            };

            proc.stdout?.on('data', (d) => handleChunk(d));
            proc.stderr?.on('data', (d) => handleChunk(d, true));
            proc.on('close', (code) => resolve(code ?? -1));
            proc.on('error', (error) => reject(new Error(`Failed to spawn SteamCMD: ${(error as Error).message}`)));
        });
    }

    /**
     * Add a log line, capping at maxLogLines
     */
    private addLog(message: string): void {
        const timestamp = new Date().toISOString().split('T')[1].slice(0, 8);
        const logLine = `[${timestamp}] ${message}`;
        this.logLines.push(logLine);

        if (this.logLines.length > this.maxLogLines) {
            this.logLines.shift();
        }

        console.verbose.debug(`RustInstaller: ${message}`);
    }
}
