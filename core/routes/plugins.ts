const modulename = 'WebServer:Plugins';
import path from 'node:path';
import fsp from 'node:fs/promises';
import fs from 'node:fs';
import consoleFactory from '@lib/console';
import { AuthedCtx } from '@modules/WebServer/ctxTypes';
import { ApiToastResp, GenericApiErrorResp } from '@shared/genericApiTypes';
import { txEnv } from '@core/globalData';
const console = consoleFactory(modulename);


// Types
export type PluginFileInfo = {
    name: string;
    file: string;
    size: number;
    mtime: number;
};

export type PluginCatalogEntry = {
    name: string;
    title: string;
    url: string;
    pageUrl?: string;
    description: string;
    author: string;
    downloads_shortened?: string;
    version?: string;
    updated_at_atom?: string;
    icon_url?: string;
    installed?: boolean;
};

export type GetPluginsDataResp = {
    installed: PluginFileInfo[];
    catalog: PluginCatalogEntry[];
    catalogUpdatedAt: number;
};


/**
 * Get installed plugins and catalog
 */
export async function getPluginsData(ctx: AuthedCtx) {
    try {
        // Check permissions
        if (!ctx.admin.hasPermission('commands.resources')) {
            return ctx.send<GenericApiErrorResp>({
                error: 'You don\'t have permission to access plugins.',
            });
        }

        // Get installed plugins
        const pluginsDir = path.join(txConfig.server.dataPath, 'oxide', 'plugins');
        let installedPlugins: PluginFileInfo[] = [];

        try {
            await fsp.mkdir(pluginsDir, { recursive: true });
            const files = await fsp.readdir(pluginsDir);
            for (const file of files) {
                if (!file.toLowerCase().endsWith('.cs')) continue;
                const filePath = path.join(pluginsDir, file);
                const stat = await fsp.stat(filePath);
                installedPlugins.push({
                    name: path.basename(file, '.cs'),
                    file,
                    size: stat.size,
                    mtime: stat.mtime.getTime(),
                });
            }
            installedPlugins.sort((a, b) => a.name.localeCompare(b.name));
        } catch (err) {
            console.warn(`Failed to read plugins directory: ${err}`);
        }

        // Read catalog
        const catalogPath = txEnv.profileSubPath('data', 'pluginsCatalog.json');
        let catalog: PluginCatalogEntry[] = [];
        let catalogUpdatedAt = 0;

        try {
            const catalogData = await fsp.readFile(catalogPath, 'utf8');
            const parsed = JSON.parse(catalogData);
            if (Array.isArray(parsed)) {
                catalog = parsed;
                const stat = await fsp.stat(catalogPath);
                catalogUpdatedAt = stat.mtime.getTime();
            }
        } catch (err) {
            if ((err as any).code !== 'ENOENT') {
                console.warn(`Failed to read catalog: ${err}`);
            }
        }

        // Mark installed plugins in catalog
        const installedNames = new Set(installedPlugins.map(p => p.name.toLowerCase()));
        const enrichedCatalog = catalog.map(entry => ({
            ...entry,
            installed: installedNames.has(entry.name.toLowerCase()),
        }));

        return ctx.send<GetPluginsDataResp>({
            installed: installedPlugins,
            catalog: enrichedCatalog,
            catalogUpdatedAt,
        });
    } catch (err) {
        console.error(`Error in getPluginsData: ${err}`);
        return ctx.send<GenericApiErrorResp>({
            error: `Failed to get plugins data: ${err instanceof Error ? err.message : String(err)}`,
        });
    }
}


/**
 * Sync plugins catalog from uMod API
 */
export async function syncPluginsCatalog(ctx: AuthedCtx) {
    try {
        // Check permissions
        if (!ctx.admin.testPermission('commands.resources', modulename)) {
            return ctx.send<GenericApiErrorResp>({
                error: 'You don\'t have permission to sync plugins.',
            });
        }

        const { query = '', pages = 5 } = ctx.request.body || {};
        const safePages = Math.max(1, Math.min(Number(pages) || 5, 10));

        // Load existing catalog
        const catalogPath = txEnv.profileSubPath('data', 'pluginsCatalog.json');
        let existingCatalog: PluginCatalogEntry[] = [];

        try {
            const data = await fsp.readFile(catalogPath, 'utf8');
            const parsed = JSON.parse(data);
            if (Array.isArray(parsed)) {
                existingCatalog = parsed;
            }
        } catch (err) {
            if ((err as any).code !== 'ENOENT') {
                console.warn(`Failed to read existing catalog: ${err}`);
            }
        }

        // Merge by lowercase name
        const byName = new Map(existingCatalog.map(item => [item.name.toLowerCase(), item]));

        // Fetch from uMod API
        for (let page = 1; page <= safePages; page++) {
            const url = new URL('https://umod.org/plugins/search.json');
            url.searchParams.set('query', query);
            url.searchParams.set('page', String(page));
            url.searchParams.set('sort', 'latest_release_at');
            url.searchParams.set('sortdir', 'desc');
            url.searchParams.append('categories[]', 'rust');

            try {
                const response = await fetch(url.toString(), {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    },
                });

                if (!response.ok) {
                    console.warn(`uMod API returned ${response.status} for page ${page}`);
                    break;
                }

                const json = await response.json() as any;
                const rows = Array.isArray(json.data) ? json.data : [];

                for (const row of rows) {
                    if (!row.name || !row.download_url) continue;

                    const normalized: PluginCatalogEntry = {
                        name: row.name,
                        title: row.title || row.name,
                        url: row.download_url,
                        pageUrl: row.url,
                        description: row.description || '',
                        author: row.author || '',
                        downloads_shortened: row.downloads_shortened,
                        version: row.latest_release_version,
                        updated_at_atom: row.updated_at_atom || row.latest_release_at_atom,
                        icon_url: row.icon_url,
                    };

                    byName.set(normalized.name.toLowerCase(), normalized);
                }

                if (!json.next_page_url) break;
            } catch (err) {
                console.warn(`Failed to fetch page ${page} from uMod: ${err}`);
            }
        }

        // Sort and save
        const merged = Array.from(byName.values()).sort((a, b) => {
            const aDate = new Date(a.updated_at_atom || '').getTime();
            const bDate = new Date(b.updated_at_atom || '').getTime();
            return bDate - aDate || a.name.localeCompare(b.name);
        });

        // Save catalog
        await fsp.mkdir(path.dirname(catalogPath), { recursive: true });
        await fsp.writeFile(catalogPath, JSON.stringify(merged, null, 2) + '\n', 'utf8');
        ctx.admin.logAction(`Synced ${merged.length} plugins from uMod`);

        // Mark installed in response
        const pluginsDir = path.join(txConfig.server.dataPath, 'oxide', 'plugins');
        let installedNames = new Set<string>();
        try {
            const files = await fsp.readdir(pluginsDir);
            installedNames = new Set(files.filter(f => f.toLowerCase().endsWith('.cs')).map(f => path.basename(f, '.cs').toLowerCase()));
        } catch (err) {
            // ignore
        }

        const enriched = merged.map(entry => ({
            ...entry,
            installed: installedNames.has(entry.name.toLowerCase()),
        }));

        return ctx.send<GetPluginsDataResp>({
            installed: [],
            catalog: enriched,
            catalogUpdatedAt: Date.now(),
        });
    } catch (err) {
        console.error(`Error in syncPluginsCatalog: ${err}`);
        return ctx.send<GenericApiErrorResp>({
            error: `Failed to sync catalog: ${err instanceof Error ? err.message : String(err)}`,
        });
    }
}


/**
 * Install a plugin
 */
export async function installPlugin(ctx: AuthedCtx) {
    try {
        // Check permissions
        if (!ctx.admin.testPermission('commands.resources', modulename)) {
            return ctx.send<GenericApiErrorResp>({
                error: 'You don\'t have permission to install plugins.',
            });
        }

        const { url } = ctx.request.body || {};

        // Validate URL: must be https and end with .cs
        if (!url || typeof url !== 'string' || !url.startsWith('https://') || !url.endsWith('.cs')) {
            return ctx.send<GenericApiErrorResp>({
                error: 'Invalid plugin URL. Must be a direct https:// link to a .cs file.',
            });
        }

        // The plugin filename is derived from the URL (authoritative for the Oxide
        // class name), not the display name which may contain spaces/punctuation.
        const name = decodeURIComponent(url.split('/').pop() || '').replace(/\.cs$/i, '');
        if (!name || !/^[A-Za-z0-9_.-]+$/.test(name) || name.includes('..')) {
            return ctx.send<GenericApiErrorResp>({
                error: 'Could not derive a valid plugin file name from the URL.',
            });
        }

        const pluginPath = path.join(txConfig.server.dataPath, 'oxide', 'plugins', `${name}.cs`);

        try {
            // Download plugin
            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                },
            });

            if (!response.ok) {
                return ctx.send<GenericApiErrorResp>({
                    error: `Failed to download plugin: HTTP ${response.status}`,
                });
            }

            const content = await response.text();
            if (!content || content.length < 50) {
                return ctx.send<GenericApiErrorResp>({
                    error: 'Downloaded file appears to be empty or invalid.',
                });
            }

            // Write plugin file
            await fsp.mkdir(path.dirname(pluginPath), { recursive: true });
            await fsp.writeFile(pluginPath, content, 'utf8');

            // Try to reload via RCON if connected
            let rconNote = '';
            try {
                if ((txCore as any).rustRcon && (txCore as any).rustRcon.isConnected) {
                    await (txCore as any).rustRcon.sendCommand(`oxide.reload ${name}`, 10000);
                    rconNote = ' Plugin reloaded via RCON.';
                } else {
                    rconNote = ' Plugin will load on server restart.';
                }
            } catch (rconErr) {
                rconNote = ' Plugin will load on server restart.';
                console.warn(`Failed to reload plugin via RCON: ${rconErr}`);
            }

            ctx.admin.logAction(`Installed plugin: ${name}`);
            return ctx.send<ApiToastResp>({
                type: 'success',
                msg: `Plugin ${name} installed.${rconNote}`,
            });
        } catch (err) {
            return ctx.send<GenericApiErrorResp>({
                error: `Failed to install plugin: ${err instanceof Error ? err.message : String(err)}`,
            });
        }
    } catch (err) {
        console.error(`Error in installPlugin: ${err}`);
        return ctx.send<GenericApiErrorResp>({
            error: `Install failed: ${err instanceof Error ? err.message : String(err)}`,
        });
    }
}


/**
 * Uninstall a plugin
 */
export async function uninstallPlugin(ctx: AuthedCtx) {
    try {
        // Check permissions
        if (!ctx.admin.testPermission('commands.resources', modulename)) {
            return ctx.send<GenericApiErrorResp>({
                error: 'You don\'t have permission to uninstall plugins.',
            });
        }

        const { name } = ctx.request.body || {};

        // Validate name
        if (!name || !/^[A-Za-z0-9_-]+$/.test(name)) {
            return ctx.send<GenericApiErrorResp>({
                error: 'Invalid plugin name.',
            });
        }

        const pluginPath = path.join(txConfig.server.dataPath, 'oxide', 'plugins', `${name}.cs`);
        const disabledDir = path.join(txConfig.server.dataPath, 'oxide', 'plugins.disabled');
        const disabledPath = path.join(disabledDir, `${name}.cs`);

        try {
            // Check if plugin exists
            if (!fs.existsSync(pluginPath)) {
                return ctx.send<GenericApiErrorResp>({
                    error: `Plugin ${name} is not installed.`,
                });
            }

            // Move to disabled folder
            await fsp.mkdir(disabledDir, { recursive: true });
            await fsp.rename(pluginPath, disabledPath);

            // Try to unload via RCON if connected
            let rconNote = '';
            try {
                if ((txCore as any).rustRcon && (txCore as any).rustRcon.isConnected) {
                    await (txCore as any).rustRcon.sendCommand(`oxide.unload ${name}`, 10000);
                    rconNote = ' Plugin unloaded via RCON.';
                } else {
                    rconNote = ' Plugin will unload on server restart.';
                }
            } catch (rconErr) {
                rconNote = ' Plugin will unload on server restart.';
                console.warn(`Failed to unload plugin via RCON: ${rconErr}`);
            }

            ctx.admin.logAction(`Uninstalled plugin: ${name}`);
            return ctx.send<ApiToastResp>({
                type: 'success',
                msg: `Plugin ${name} uninstalled.${rconNote}`,
            });
        } catch (err) {
            return ctx.send<GenericApiErrorResp>({
                error: `Failed to uninstall plugin: ${err instanceof Error ? err.message : String(err)}`,
            });
        }
    } catch (err) {
        console.error(`Error in uninstallPlugin: ${err}`);
        return ctx.send<GenericApiErrorResp>({
            error: `Uninstall failed: ${err instanceof Error ? err.message : String(err)}`,
        });
    }
}


/**
 * Reload a plugin
 */
export async function reloadPlugin(ctx: AuthedCtx) {
    try {
        // Check permissions
        if (!ctx.admin.testPermission('commands.resources', modulename)) {
            return ctx.send<GenericApiErrorResp>({
                error: 'You don\'t have permission to reload plugins.',
            });
        }

        const { name } = ctx.request.body || {};

        // Validate name
        if (!name || !/^[A-Za-z0-9_-]+$/.test(name)) {
            return ctx.send<GenericApiErrorResp>({
                error: 'Invalid plugin name.',
            });
        }

        try {
            // Check if RCON is available
            if (!(txCore as any).rustRcon || !(txCore as any).rustRcon.isConnected) {
                return ctx.send<GenericApiErrorResp>({
                    error: 'RCON is not connected. Cannot reload plugin.',
                });
            }

            // Send reload command
            await (txCore as any).rustRcon.sendCommand(`oxide.reload ${name}`, 10000);

            ctx.admin.logAction(`Reloaded plugin: ${name}`);
            return ctx.send<ApiToastResp>({
                type: 'success',
                msg: `Plugin ${name} reloaded.`,
            });
        } catch (err) {
            return ctx.send<GenericApiErrorResp>({
                error: `Failed to reload plugin: ${err instanceof Error ? err.message : String(err)}`,
            });
        }
    } catch (err) {
        console.error(`Error in reloadPlugin: ${err}`);
        return ctx.send<GenericApiErrorResp>({
            error: `Reload failed: ${err instanceof Error ? err.message : String(err)}`,
        });
    }
}
