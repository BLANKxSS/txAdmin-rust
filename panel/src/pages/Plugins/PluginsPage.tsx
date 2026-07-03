import { useState } from "react";
import { useBackendApi, BackendApiError } from "@/hooks/fetch";
import { useAdminPerms } from "@/hooks/auth";
import { useOpenConfirmDialog } from "@/hooks/dialogs";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2Icon, TrashIcon, RotateCwIcon, DownloadIcon } from "lucide-react";
import useSWR from "swr";
import { formatBytes } from "./pluginUtils";

import type { PluginFileInfo, GetPluginsDataResp } from "@shared/otherTypes";


function PluginsPageInner() {
    const [installUrlData, setInstallUrlData] = useState({ name: '', url: '' });
    const [isInstallingUrl, setIsInstallingUrl] = useState(false);
    const [installUrlError, setInstallUrlError] = useState<string | null>(null);
    const { hasPerm } = useAdminPerms();
    const openConfirmDialog = useOpenConfirmDialog();

    // API hooks
    const getDataApi = useBackendApi<GetPluginsDataResp>({
        method: 'GET',
        path: '/plugins',
        throwGenericErrors: true,
    });

    const installApi = useBackendApi<{ type: string; msg: string }>({
        method: 'POST',
        path: '/plugins/install',
        throwGenericErrors: true,
    });

    const uninstallApi = useBackendApi<{ type: string; msg: string }>({
        method: 'POST',
        path: '/plugins/uninstall',
        throwGenericErrors: true,
    });

    const reloadApi = useBackendApi<{ type: string; msg: string }>({
        method: 'POST',
        path: '/plugins/reload',
        throwGenericErrors: true,
    });

    // SWR for data fetching
    const swr = useSWR('/plugins', async () => {
        const data = await getDataApi({});
        if (!data) throw new Error('No data returned');
        return data;
    }, {
        isPaused: () => isInstallingUrl,
    });

    // Handle install from URL
    const handleInstallFromUrl = async () => {
        setInstallUrlError(null);
        if (!installUrlData.name.trim() || !installUrlData.url.trim()) {
            setInstallUrlError('Plugin name and URL are required.');
            return;
        }

        setIsInstallingUrl(true);
        try {
            const result = await installApi({
                name: installUrlData.name.trim(),
                url: installUrlData.url.trim()
            });
            if (result) {
                setInstallUrlData({ name: '', url: '' });
                await swr.mutate();
            }
        } catch (error) {
            if (error instanceof BackendApiError || error instanceof Error) {
                setInstallUrlError(error.message);
            } else {
                setInstallUrlError(JSON.stringify(error));
            }
        } finally {
            setIsInstallingUrl(false);
        }
    };

    // Handle uninstall
    const handleUninstall = (plugin: PluginFileInfo) => {
        openConfirmDialog({
            title: 'Uninstall Plugin',
            actionLabel: 'Uninstall',
            confirmBtnVariant: 'destructive',
            message: <p>Are you sure you want to uninstall <strong>{plugin.name}</strong>?</p>,
            onConfirm: async () => {
                try {
                    const result = await uninstallApi({ name: plugin.name });
                    if (result) {
                        await swr.mutate();
                    }
                } catch (error) {
                    console.error('Uninstall failed:', error);
                }
            },
        });
    };

    // Handle reload
    const handleReload = async (plugin: PluginFileInfo) => {
        try {
            const result = await reloadApi({ name: plugin.name });
            if (result) {
                await swr.mutate();
            }
        } catch (error) {
            console.error('Reload failed:', error);
        }
    };

    if (!hasPerm('commands.resources')) {
        return (
            <div className="flex items-center justify-center h-screen">
                <p className="text-lg text-muted-foreground">You don't have permission to access plugins.</p>
            </div>
        );
    }

    const { installed = [] } = swr.data || {};

    return (
        <div className="w-full max-w-screen-lg mx-auto space-y-6 pb-8">
            {/* Page Header */}
            <PageHeader
                title="Plugins"
                description="Manage Oxide/uMod plugins for your Rust server"
            />

            {/* Installed Plugins Section */}
            {installed.length > 0 && (
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <DownloadIcon className="w-5 h-5" />
                            Installed Plugins
                        </CardTitle>
                        <CardDescription>
                            {installed.length} plugin{installed.length !== 1 ? 's' : ''} installed
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                            {installed.map(plugin => (
                                <div key={plugin.name} className="border rounded-lg p-4 space-y-3">
                                    <div>
                                        <h3 className="font-semibold truncate">{plugin.name}</h3>
                                        <p className="text-xs text-muted-foreground">
                                            {formatBytes(plugin.size)}
                                        </p>
                                    </div>
                                    <div className="flex gap-2 flex-wrap">
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={() => handleReload(plugin)}
                                            disabled={swr.isLoading}
                                        >
                                            <RotateCwIcon className="w-4 h-4 mr-1" />
                                            Reload
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant="destructive"
                                            onClick={() => handleUninstall(plugin)}
                                            disabled={swr.isLoading}
                                        >
                                            <TrashIcon className="w-4 h-4 mr-1" />
                                            Uninstall
                                        </Button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Install from URL Section */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <DownloadIcon className="w-5 h-5" />
                        Install from URL
                    </CardTitle>
                    <CardDescription>
                        Install plugins from custom sources or direct .cs file URLs
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-3">
                        <Input
                            placeholder="Plugin name (alphanumeric, underscores, hyphens only)"
                            value={installUrlData.name}
                            onChange={(e) => setInstallUrlData({ ...installUrlData, name: e.target.value })}
                            disabled={isInstallingUrl}
                        />
                        <Input
                            placeholder="Direct HTTPS URL to .cs file (e.g., https://example.com/plugin.cs)"
                            value={installUrlData.url}
                            onChange={(e) => setInstallUrlData({ ...installUrlData, url: e.target.value })}
                            disabled={isInstallingUrl}
                        />
                    </div>
                    {installUrlError && (
                        <div className="bg-destructive/10 border border-destructive/30 rounded p-3 text-sm text-destructive">
                            {installUrlError}
                        </div>
                    )}
                    <Button
                        onClick={handleInstallFromUrl}
                        disabled={isInstallingUrl || !installUrlData.name.trim() || !installUrlData.url.trim()}
                    >
                        {isInstallingUrl ? (
                            <>
                                <Loader2Icon className="w-4 h-4 mr-2 animate-spin" />
                                Installing...
                            </>
                        ) : (
                            <>
                                <DownloadIcon className="w-4 h-4 mr-2" />
                                Install from URL
                            </>
                        )}
                    </Button>
                </CardContent>
            </Card>

        </div>
    );
}


export default function PluginsPage() {
    return <PluginsPageInner />;
}
