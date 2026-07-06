import { useState, useEffect, useRef } from 'react';
import { useBackendApi, ApiTimeout } from '@/hooks/fetch';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2Icon, CheckCircleIcon, AlertCircleIcon, ServerIcon, FolderIcon, FolderOpenIcon } from 'lucide-react';
import { txToast } from '@/components/TxToaster';
import FolderPicker from './FolderPicker';

type Step = 'welcome' | 'server' | 'finish';
type ServerMode = 'install' | 'existing' | null;

interface InstallerProgress {
    running: boolean;
    done: boolean;
    failed: boolean;
    step: string;
    percent: number;
    serverPath: string;
    log: string[];
}

function ConsoleLog({ lines }: { lines: string[] }) {
    const boxRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        //auto-scroll to the newest line
        if (boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight;
    }, [lines]);
    return (
        <div
            ref={boxRef}
            className="bg-black text-zinc-200 rounded-md border p-3 h-64 overflow-y-auto font-mono text-xs leading-relaxed whitespace-pre-wrap"
        >
            {lines.length === 0
                ? <span className="text-zinc-500">Waiting for SteamCMD output...</span>
                : lines.map((line, idx) => <div key={idx}>{line}</div>)}
        </div>
    );
}

function WelcomeStep({ onNext }: { onNext: () => void }) {
    return (
        <Card className="w-full max-w-lg">
            <CardHeader className="text-center">
                <CardTitle className="text-2xl">Setup Your Rust Server</CardTitle>
                <CardDescription>Let's get your server up and running</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                <div className="text-center space-y-2">
                    <p className="text-muted-foreground">
                        This wizard will guide you through setting up your Rust dedicated server.
                    </p>
                    <p className="text-sm text-muted-foreground">
                        You can configure advanced settings after setup is complete.
                    </p>
                </div>
                <Button onClick={onNext} className="w-full">
                    Get Started
                </Button>
            </CardContent>
        </Card>
    );
}

function ServerStep({ onNext, onBack }: { onNext: (mode: ServerMode, path: string) => void; onBack: () => void }) {
    const [mode, setMode] = useState<ServerMode>(null);
    const [installPath, setInstallPath] = useState('C:\\rustserver');
    const [existingPath, setExistingPath] = useState('');
    const [isInstalling, setIsInstalling] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const pollIntervalRef = useRef<NodeJS.Timeout>();
    const [progress, setProgress] = useState<InstallerProgress | null>(null);
    //Existing-folder validation state (null = not checked yet)
    const [existingValid, setExistingValid] = useState<boolean | null>(null);
    const [existingChecking, setExistingChecking] = useState(false);
    const validateTimerRef = useRef<NodeJS.Timeout>();
    const [picker, setPicker] = useState<null | 'install' | 'existing'>(null);

    // API hooks for server installation
    const startInstallerApi = useBackendApi<{ started: boolean; error?: string }>({
        method: 'POST',
        path: '/serverInstaller/start',
        throwGenericErrors: false,
    });

    const getProgressApi = useBackendApi<InstallerProgress>({
        method: 'GET',
        path: '/serverInstaller/progress',
        throwGenericErrors: false,
    });

    const validateFolderApi = useBackendApi<{ success: boolean; message?: string }>({
        method: 'POST',
        path: '/setup/validateLocalDataFolder',
        throwGenericErrors: false,
    });

    //Validate the existing folder (debounced) whenever the path changes
    useEffect(() => {
        clearTimeout(validateTimerRef.current);
        setExistingValid(null);
        const folder = existingPath.trim();
        if (!folder) return;
        setExistingChecking(true);
        validateTimerRef.current = setTimeout(async () => {
            try {
                const res = await validateFolderApi({ data: { dataFolder: folder } });
                setExistingValid(!!res?.success);
            } catch {
                setExistingValid(false);
            } finally {
                setExistingChecking(false);
            }
        }, 500);
        return () => clearTimeout(validateTimerRef.current);
    }, [existingPath]);

    // Polling function
    const pollProgress = async () => {
        try {
            const data = await getProgressApi({});
            if (data) {
                setProgress(data);
                if (data.done || data.failed) {
                    clearInterval(pollIntervalRef.current);
                    setIsInstalling(false);
                    if (data.failed) {
                        setError('Installation failed. See logs below.');
                    } else if (data.done && data.serverPath) {
                        // Success! Move to next step
                        setTimeout(() => onNext('install', data.serverPath), 1000);
                    }
                }
            }
        } catch (err) {
            console.error('Error polling progress:', err);
            clearInterval(pollIntervalRef.current);
            setIsInstalling(false);
            setError('Failed to get installation progress.');
        }
    };

    const handleInstall = async () => {
        setError(null);
        if (!installPath.trim()) {
            setError('Please enter an installation path.');
            return;
        }

        setIsInstalling(true);
        setProgress(null);

        try {
            const result = await startInstallerApi({ data: { targetPath: installPath.trim() } });
            if (!result?.started) {
                setError(result?.error || 'Failed to start installation.');
                setIsInstalling(false);
                return;
            }

            // Start polling
            pollIntervalRef.current = setInterval(pollProgress, 2000);
        } catch (err) {
            console.error('Install error:', err);
            setError('Failed to start installation.');
            setIsInstalling(false);
        }
    };

    const handleUseExisting = () => {
        if (!existingPath.trim()) {
            setError('Please enter a server path.');
            return;
        }
        onNext('existing', existingPath.trim());
    };

    useEffect(() => {
        return () => {
            if (pollIntervalRef.current) {
                clearInterval(pollIntervalRef.current);
            }
        };
    }, []);

    if (isInstalling && progress) {
        const stepLabels: Record<string, string> = {
            idle: 'Preparing...',
            steamcmd: 'Downloading SteamCMD',
            server: 'Downloading Rust server files',
            complete: 'Done',
        };
        const stepLabel = stepLabels[progress.step] ?? progress.step;
        return (
            <Card className="w-full max-w-2xl">
                <CardHeader className="text-center">
                    <CardTitle>Installing Rust Server</CardTitle>
                    <CardDescription>Downloading via SteamCMD — this can take several minutes.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    {/* Progress bar */}
                    <div className="space-y-2">
                        <div className="flex justify-between items-center">
                            <span className="text-sm font-medium flex items-center gap-2">
                                <Loader2Icon className="w-4 h-4 animate-spin" />{stepLabel}
                            </span>
                            <span className="text-sm font-mono text-muted-foreground">{progress.percent}%</span>
                        </div>
                        <div className="w-full bg-muted rounded-full h-2.5 overflow-hidden">
                            <div
                                className="bg-primary h-full transition-all duration-500"
                                style={{ width: `${progress.percent}%` }}
                            />
                        </div>
                    </div>

                    {/* SteamCMD console */}
                    <ConsoleLog lines={progress.log} />
                </CardContent>
            </Card>
        );
    }

    return (
        <Card className="w-full max-w-lg">
            <CardHeader className="text-center">
                <CardTitle>Choose Server Option</CardTitle>
                <CardDescription>How would you like to set up your server?</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                {error && (
                    <div className="bg-destructive/10 border border-destructive/30 rounded p-3 text-sm text-destructive flex gap-2">
                        <AlertCircleIcon className="w-4 h-4 mt-0.5 flex-shrink-0" />
                        <span>{error}</span>
                    </div>
                )}

                {/* Install New Option */}
                <div
                    className={`border rounded-lg p-4 cursor-pointer transition-colors ${
                        mode === 'install'
                            ? 'border-primary bg-primary/5'
                            : 'border-muted hover:border-muted-foreground/50'
                    }`}
                    onClick={() => setMode('install')}
                >
                    <div className="flex gap-3 mb-3">
                        <ServerIcon className="w-5 h-5 text-primary" />
                        <div>
                            <h3 className="font-semibold">Install New Rust Server</h3>
                            <p className="text-sm text-muted-foreground">
                                Download and install automatically
                            </p>
                        </div>
                    </div>
                    {mode === 'install' && (
                        <div className="space-y-3 mt-4 pt-4 border-t">
                            <div className="flex gap-2">
                                <Input
                                    placeholder="Installation path (e.g., C:\rustserver)"
                                    value={installPath}
                                    onChange={(e) => setInstallPath(e.target.value)}
                                    disabled={isInstalling}
                                />
                                <Button type="button" variant="outline" size="icon" disabled={isInstalling}
                                    onClick={() => setPicker('install')} title="Browse folders">
                                    <FolderOpenIcon className="w-4 h-4" />
                                </Button>
                            </div>
                            <Button
                                onClick={handleInstall}
                                disabled={isInstalling || !installPath.trim()}
                                className="w-full"
                            >
                                {isInstalling ? (
                                    <>
                                        <Loader2Icon className="w-4 h-4 mr-2 animate-spin" />
                                        Installing...
                                    </>
                                ) : (
                                    'Install'
                                )}
                            </Button>
                        </div>
                    )}
                </div>

                {/* Use Existing Option */}
                <div
                    className={`border rounded-lg p-4 cursor-pointer transition-colors ${
                        mode === 'existing'
                            ? 'border-primary bg-primary/5'
                            : 'border-muted hover:border-muted-foreground/50'
                    }`}
                    onClick={() => setMode('existing')}
                >
                    <div className="flex gap-3 mb-3">
                        <FolderIcon className="w-5 h-5 text-primary" />
                        <div>
                            <h3 className="font-semibold">Use Existing Server</h3>
                            <p className="text-sm text-muted-foreground">
                                Point to an existing server folder
                            </p>
                        </div>
                    </div>
                    {mode === 'existing' && (
                        <div className="space-y-3 mt-4 pt-4 border-t">
                            <div className="flex gap-2">
                                <Input
                                    placeholder="Path to server folder (containing RustDedicated.exe)"
                                    value={existingPath}
                                    onChange={(e) => setExistingPath(e.target.value)}
                                    disabled={isInstalling}
                                />
                                <Button type="button" variant="outline" size="icon" disabled={isInstalling}
                                    onClick={() => setPicker('existing')} title="Browse folders">
                                    <FolderOpenIcon className="w-4 h-4" />
                                </Button>
                            </div>
                            {existingPath.trim() && (
                                <div className="text-sm flex items-center gap-2">
                                    {existingChecking ? (
                                        <span className="text-muted-foreground flex items-center gap-2">
                                            <Loader2Icon className="w-4 h-4 animate-spin" /> Checking folder...
                                        </span>
                                    ) : existingValid ? (
                                        <span className="text-green-600 dark:text-green-500 flex items-center gap-2">
                                            <CheckCircleIcon className="w-4 h-4" /> RustDedicated.exe found
                                        </span>
                                    ) : existingValid === false ? (
                                        <span className="text-destructive flex items-center gap-2">
                                            <AlertCircleIcon className="w-4 h-4" /> RustDedicated.exe not found in this folder
                                        </span>
                                    ) : null}
                                </div>
                            )}
                            <Button
                                onClick={handleUseExisting}
                                disabled={isInstalling || !existingValid}
                                className="w-full"
                            >
                                Next
                            </Button>
                        </div>
                    )}
                </div>

                <Button
                    variant="ghost"
                    onClick={onBack}
                    className="w-full"
                >
                    Back
                </Button>
            </CardContent>

            <FolderPicker
                open={picker !== null}
                onClose={() => setPicker(null)}
                title={picker === 'install' ? 'Choose install location' : 'Select your server folder'}
                onSelect={(p) => {
                    if (picker === 'install') setInstallPath(p);
                    else setExistingPath(p);
                }}
            />
        </Card>
    );
}

function FinishStep({ dataFolder, onBack }: { dataFolder: string; onBack: () => void }) {
    const [serverName, setServerName] = useState('Rust Server');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const saveSetupApi = useBackendApi<{ success: boolean; message?: string }>({
        method: 'POST',
        path: '/setup/save',
        throwGenericErrors: false,
    });

    const handleFinish = async () => {
        setError(null);
        if (!serverName.trim()) {
            setError('Please enter a server name.');
            return;
        }

        setIsLoading(true);
        try {
            const result = await saveSetupApi({
                data: {
                    type: 'local',
                    name: serverName.trim(),
                    dataFolder: dataFolder,
                    cfgFile: 'server/main/cfg/server.cfg',
                },
            });

            if (result?.success) {
                txToast.success('Server setup complete! Redirecting...');
                setTimeout(() => {
                    window.location.href = '/';
                }, 1500);
            } else {
                setError(result?.message || 'Failed to save server configuration.');
                setIsLoading(false);
            }
        } catch (err) {
            console.error('Save error:', err);
            setError('Failed to save configuration. Please try again.');
            setIsLoading(false);
        }
    };

    return (
        <Card className="w-full max-w-lg">
            <CardHeader className="text-center">
                <div className="flex justify-center mb-2">
                    <CheckCircleIcon className="w-8 h-8 text-green-600" />
                </div>
                <CardTitle>Almost Done!</CardTitle>
                <CardDescription>Give your server a name</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                {error && (
                    <div className="bg-destructive/10 border border-destructive/30 rounded p-3 text-sm text-destructive flex gap-2">
                        <AlertCircleIcon className="w-4 h-4 mt-0.5 flex-shrink-0" />
                        <span>{error}</span>
                    </div>
                )}

                <div className="space-y-2">
                    <label className="text-sm font-medium">Server Name</label>
                    <Input
                        placeholder="Rust Server"
                        value={serverName}
                        onChange={(e) => setServerName(e.target.value)}
                        disabled={isLoading}
                    />
                </div>

                <div className="bg-muted rounded p-3 text-sm space-y-1">
                    <p className="text-muted-foreground">
                        <span className="font-medium text-foreground">Data Folder:</span>
                    </p>
                    <p className="font-mono text-xs break-all">{dataFolder}</p>
                </div>

                <Button
                    onClick={handleFinish}
                    disabled={isLoading || !serverName.trim()}
                    className="w-full"
                >
                    {isLoading ? (
                        <>
                            <Loader2Icon className="w-4 h-4 mr-2 animate-spin" />
                            Starting Server...
                        </>
                    ) : (
                        'Finish & Start Server'
                    )}
                </Button>

                <Button
                    variant="ghost"
                    onClick={onBack}
                    disabled={isLoading}
                    className="w-full"
                >
                    Back
                </Button>
            </CardContent>
        </Card>
    );
}

export default function SetupPage() {
    const [step, setStep] = useState<Step>('welcome');
    const [dataFolder, setDataFolder] = useState('');

    const handleWelcomeNext = () => {
        setStep('server');
    };

    const handleServerNext = (mode: ServerMode, path: string) => {
        setDataFolder(path);
        setStep('finish');
    };

    const handleBack = () => {
        if (step === 'server') {
            setStep('welcome');
        } else if (step === 'finish') {
            setStep('server');
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center p-4 bg-muted/30">
            {step === 'welcome' && <WelcomeStep onNext={handleWelcomeNext} />}
            {step === 'server' && <ServerStep onNext={handleServerNext} onBack={handleBack} />}
            {step === 'finish' && <FinishStep dataFolder={dataFolder} onBack={handleBack} />}
        </div>
    );
}
