import { useState } from "react";
import { useBackendApi, BackendApiError } from "@/hooks/fetch";
import { useAdminPerms } from "@/hooks/auth";
import { useOpenConfirmDialog } from "@/hooks/dialogs";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2Icon, RefreshCwIcon, DownloadIcon, PuzzleIcon, ExternalLinkIcon, SearchIcon } from "lucide-react";
import useSWR from "swr";
import { tsToLocaleDateString } from "@/lib/dateTime";
import { formatBytes, getRelativeTime } from "./pluginUtils";

import type { PluginCatalogEntry, GetPluginsDataResp } from "@shared/otherTypes";

type SortOption = 'name' | 'downloads' | 'updated';
type FilterOption = 'all' | 'installed' | 'not-installed';

function PluginsBrowsePageInner() {
    const [searchQuery, setSearchQuery] = useState('');
    const [sortBy, setSortBy] = useState<SortOption>('downloads');
    const [filterBy, setFilterBy] = useState<FilterOption>('all');
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [refreshError, setRefreshError] = useState<string | null>(null);
    const { hasPerm } = useAdminPerms();
    const openConfirmDialog = useOpenConfirmDialog();

    // API hooks
    const getDataApi = useBackendApi<GetPluginsDataResp>({
        method: 'GET',
        path: '/plugins',
        throwGenericErrors: true,
    });

    const syncApi = useBackendApi<GetPluginsDataResp>({
        method: 'POST',
        path: '/plugins/sync',
        throwGenericErrors: true,
    });

    const installApi = useBackendApi<{ type: string; msg: string }>({
        method: 'POST',
        path: '/plugins/install',
        throwGenericErrors: true,
    });

    // SWR for data fetching
    const swr = useSWR('/plugins', async () => {
        const data = await getDataApi({});
        if (!data) throw new Error('No data returned');
        return data;
    }, {
        isPaused: () => isRefreshing,
    });

    // Handle refresh
    const handleRefreshCatalog = async () => {
        setIsRefreshing(true);
        setRefreshError(null);
        try {
            const data = await syncApi({ query: searchQuery, pages: 5 });
            if (!data) throw new Error('No data returned');
            await swr.mutate({ ...data, installed: swr.data?.installed || [] }, false);
        } catch (error) {
            if (error instanceof BackendApiError || error instanceof Error) {
                setRefreshError(error.message);
            } else {
                setRefreshError(JSON.stringify(error));
            }
        } finally {
            setIsRefreshing(false);
        }
    };

    // Handle install from catalog
    const handleInstall = (plugin: PluginCatalogEntry) => {
        openConfirmDialog({
            title: 'Install Plugin',
            actionLabel: 'Install',
            confirmBtnVariant: 'default',
            message: (
                <div className="space-y-2">
                    <p>Install <strong>{plugin.title}</strong>?</p>
                    {plugin.description && (
                        <p className="text-sm opacity-75">{plugin.description}</p>
                    )}
                </div>
            ),
            onConfirm: async () => {
                try {
                    const result = await installApi({ name: plugin.name, url: plugin.url });
                    if (result) {
                        await swr.mutate();
                    }
                } catch (error) {
                    console.error('Install failed:', error);
                }
            },
        });
    };

    if (!hasPerm('commands.resources')) {
        return (
            <div className="flex items-center justify-center h-screen">
                <p className="text-lg text-muted-foreground">You don't have permission to access plugins.</p>
            </div>
        );
    }

    const { installed = [], catalog = [], catalogUpdatedAt = 0 } = swr.data || {};

    // Filter and sort catalog
    let filteredCatalog = catalog.filter(plugin => {
        const matchesSearch =
            plugin.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
            plugin.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            plugin.author.toLowerCase().includes(searchQuery.toLowerCase());

        if (!matchesSearch) return false;

        if (filterBy === 'installed') return plugin.installed;
        if (filterBy === 'not-installed') return !plugin.installed;
        return true;
    });

    // Sort catalog
    filteredCatalog = [...filteredCatalog].sort((a, b) => {
        if (sortBy === 'name') {
            return a.title.localeCompare(b.title);
        } else if (sortBy === 'downloads') {
            const aDownloads = parseInt(a.downloads_shortened?.replace(/[^0-9]/g, '') || '0');
            const bDownloads = parseInt(b.downloads_shortened?.replace(/[^0-9]/g, '') || '0');
            return bDownloads - aDownloads;
        } else if (sortBy === 'updated') {
            const aDate = parseISODate(a.updated_at_atom)?.getTime() || 0;
            const bDate = parseISODate(b.updated_at_atom)?.getTime() || 0;
            return bDate - aDate;
        }
        return 0;
    });

    return (
        <div className="w-full max-w-screen-lg mx-auto space-y-6 pb-8">
            {/* Page Header */}
            <PageHeader
                title="Browse Plugins"
                description="Search and install plugins from uMod.org"
            />

            {/* Browse Catalog Section */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <SearchIcon className="w-5 h-5" />
                        Plugin Catalog
                    </CardTitle>
                    <CardDescription>
                        Explore and install plugins from uMod.org
                        {catalogUpdatedAt > 0 && (
                            <> • Updated {tsToLocaleDateString(catalogUpdatedAt)}</>
                        )}
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    {/* Toolbar */}
                    <div className="space-y-3">
                        <div className="flex gap-2 flex-wrap items-center">
                            <Input
                                placeholder="Search plugins..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                disabled={swr.isLoading || isRefreshing}
                                className="flex-1 min-w-[200px]"
                            />
                            <Select
                                value={sortBy}
                                onValueChange={(val) => setSortBy(val as SortOption)}
                                disabled={swr.isLoading || isRefreshing}
                            >
                                <SelectTrigger className="w-[180px]">
                                    <SelectValue placeholder="Sort by" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="downloads">Most Downloads</SelectItem>
                                    <SelectItem value="updated">Recently Updated</SelectItem>
                                    <SelectItem value="name">Name A–Z</SelectItem>
                                </SelectContent>
                            </Select>
                            <Select
                                value={filterBy}
                                onValueChange={(val) => setFilterBy(val as FilterOption)}
                                disabled={swr.isLoading || isRefreshing}
                            >
                                <SelectTrigger className="w-[140px]">
                                    <SelectValue placeholder="Filter" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All</SelectItem>
                                    <SelectItem value="installed">Installed</SelectItem>
                                    <SelectItem value="not-installed">Not Installed</SelectItem>
                                </SelectContent>
                            </Select>
                            <Button
                                onClick={handleRefreshCatalog}
                                disabled={swr.isLoading || isRefreshing}
                            >
                                {isRefreshing ? (
                                    <>
                                        <Loader2Icon className="w-4 h-4 mr-2 animate-spin" />
                                        Syncing...
                                    </>
                                ) : (
                                    <>
                                        <RefreshCwIcon className="w-4 h-4 mr-2" />
                                        Refresh
                                    </>
                                )}
                            </Button>
                        </div>
                    </div>

                    {refreshError && (
                        <div className="bg-destructive/10 border border-destructive/30 rounded p-3 text-sm text-destructive">
                            {refreshError}
                        </div>
                    )}

                    {swr.isLoading ? (
                        <div className="flex items-center justify-center py-12">
                            <Loader2Icon className="w-6 h-6 animate-spin text-muted-foreground" />
                        </div>
                    ) : filteredCatalog.length === 0 ? (
                        <p className="text-sm text-muted-foreground py-8 text-center">
                            {catalog.length === 0
                                ? 'No plugins in catalog. Click "Refresh" to load the catalog from uMod.'
                                : 'No plugins match your search.'}
                        </p>
                    ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                            {filteredCatalog.map(plugin => (
                                <div key={plugin.name} className="border rounded-lg overflow-hidden flex flex-col">
                                    {/* Plugin Icon */}
                                    {plugin.icon_url ? (
                                        <img
                                            src={plugin.icon_url}
                                            alt={plugin.title}
                                            className="w-full h-32 object-cover bg-muted"
                                            onError={(e) => {
                                                (e.target as HTMLImageElement).style.display = 'none';
                                            }}
                                        />
                                    ) : (
                                        <div className="w-full h-32 bg-muted flex items-center justify-center">
                                            <PuzzleIcon className="w-12 h-12 text-muted-foreground opacity-50" />
                                        </div>
                                    )}

                                    {/* Card Content */}
                                    <div className="p-4 flex-1 flex flex-col space-y-3">
                                        <div>
                                            <div className="flex items-start justify-between gap-2 mb-1">
                                                <h3 className="font-semibold text-sm leading-tight flex-1">
                                                    {plugin.title || plugin.name}
                                                </h3>
                                                {plugin.installed && (
                                                    <Badge variant="secondary" className="text-xs shrink-0">
                                                        Installed
                                                    </Badge>
                                                )}
                                            </div>
                                            <p className="text-xs text-muted-foreground">
                                                by {plugin.author || 'Unknown'}
                                            </p>
                                        </div>

                                        {/* Description */}
                                        <p className="text-xs text-muted-foreground line-clamp-2 flex-1">
                                            {plugin.description || 'No description'}
                                        </p>

                                        {/* Badges */}
                                        <div className="flex flex-wrap gap-2">
                                            {plugin.downloads_shortened && (
                                                <Badge variant="outline" className="text-xs">
                                                    {plugin.downloads_shortened}
                                                </Badge>
                                            )}
                                            {plugin.version && (
                                                <Badge variant="outline" className="text-xs">
                                                    v{plugin.version}
                                                </Badge>
                                            )}
                                            {plugin.updated_at_atom && (
                                                <Badge variant="outline" className="text-xs">
                                                    {getRelativeTime(plugin.updated_at_atom)}
                                                </Badge>
                                            )}
                                            <Badge variant="outline" className="text-xs">
                                                uMod
                                            </Badge>
                                        </div>

                                        {/* Actions */}
                                        <div className="flex gap-2 pt-2">
                                            {plugin.pageUrl && (
                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    className="flex-1"
                                                    asChild
                                                >
                                                    <a
                                                        href={plugin.pageUrl}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="flex items-center justify-center"
                                                    >
                                                        <ExternalLinkIcon className="w-4 h-4" />
                                                    </a>
                                                </Button>
                                            )}
                                            {plugin.installed ? (
                                                <Badge variant="outline" className="flex-1 justify-center cursor-default">
                                                    Installed
                                                </Badge>
                                            ) : (
                                                <Button
                                                    size="sm"
                                                    variant="default"
                                                    className="flex-1"
                                                    onClick={() => handleInstall(plugin)}
                                                    disabled={swr.isLoading || isRefreshing}
                                                >
                                                    <DownloadIcon className="w-4 h-4 mr-1" />
                                                    Install
                                                </Button>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}

export default function PluginsBrowsePage() {
    return <PluginsBrowsePageInner />;
}
