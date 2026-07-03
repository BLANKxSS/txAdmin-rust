const modulename = 'WebServer:OxideGroups';
import consoleFactory from '@lib/console';
import { AuthedCtx } from '@modules/WebServer/ctxTypes';
import { ApiToastResp, GenericApiErrorResp } from '@shared/genericApiTypes';
const console = consoleFactory(modulename);


// Types
export type OxideGroupMember = {
	steamId: string;
	name: string;
};

export type OxideGroup = {
	name: string;
	permissions: string[];
	players: OxideGroupMember[];
};

export type GetOxideGroupsDataResp = {
	rconOk: boolean;
	allPermissions?: string[];
	groups?: OxideGroup[];
};

export type OxideGroupsActionResp = {
	success: boolean;
	error?: string;
	groups?: string[];
};


// Parsers (ported from webapp/lib/backend.js)

/**
 * Parse oxide.show groups / oxide.show perms output
 * Format: "Groups: group1, group2, ..."
 */
function parseOxideList(output: string, label: string): string[] {
	const lines = output.split(/\r?\n/);
	const index = lines.findIndex((entry) =>
		entry.trim().toLowerCase().startsWith(`${label.toLowerCase()}:`)
	);
	if (index === -1) return [];

	const current = lines[index].slice(lines[index].indexOf(':') + 1).trim();
	const values = current || lines[index + 1] || '';
	return values
		.split(',')
		.map((item) => item.trim())
		.filter(Boolean)
		.sort((a, b) => a.localeCompare(b));
}

/**
 * Parse oxide.show group <name> output
 * Format:
 *   Group 'name' players:
 *   <steamid17> (Name)
 *   ...
 *   Group 'name' permissions:
 *   perm1, perm2, ...
 */
function parseGroupDetail(output: string, group: string): OxideGroup {
	const playersMarker = `Group '${group}' players:`;
	const permissionsMarker = `Group '${group}' permissions:`;
	const playersIndex = output.indexOf(playersMarker);
	const permissionsIndex = output.indexOf(permissionsMarker);

	const playersText = playersIndex === -1 ? '' : output
		.slice(playersIndex + playersMarker.length, permissionsIndex === -1 ? undefined : permissionsIndex)
		.trim();

	const permissionsText = permissionsIndex === -1 ? '' : output
		.slice(permissionsIndex + permissionsMarker.length)
		.trim();

	const players = playersText
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => line.match(/^(\d{17})(?:\s+\((.*?)\))?/))
		.filter(Boolean)
		.map((match: any) => ({ steamId: match[1], name: match[2] || '' }));

	const permissions = parseNameList(permissionsText);

	return { name: group, players, permissions };
}

/**
 * Parse oxide.show user <steamid> output
 * Format:
 *   Player 'Name' permissions:
 *   perm1, perm2, ...
 *
 *   Player 'Name' groups:
 *   group1, group2, ...
 */
function parseUserDetail(output: string, steamId: string): { groups: string[] } {
	const groupsMatch = output.match(/groups:\s*([\s\S]*?)$/i);
	const groupsText = groupsMatch ? groupsMatch[1].trim() : '';
	const groups = parseNameList(groupsText);
	return { groups };
}

/**
 * Parse comma-separated list, filtering out "no X" sentinels
 */
function parseNameList(text: string): string[] {
	const NO_RESULT_SENTINEL = /^(no |player is not |player has no )/i;
	return text
		.split(',')
		.map((item) => item.trim())
		.filter(Boolean)
		.filter((item) => !NO_RESULT_SENTINEL.test(item))
		.sort((a, b) => a.localeCompare(b));
}


// Handlers

/**
 * Get oxide groups and permissions data
 */
export async function getOxideGroupsData(ctx: AuthedCtx) {
	try {
		// Check permissions
		if (!ctx.admin.testPermission('server.groups', modulename)) {
			return ctx.send<GenericApiErrorResp>({
				error: 'You don\'t have permission to access groups.',
			});
		}

		// Try to get groups and permissions via RCON
		let groupNames: string[] = [];
		let allPermissions: string[] = [];

		try {
			if (!(txCore as any).rustRcon?.isConnected) {
				return ctx.send<GetOxideGroupsDataResp>({
					rconOk: false,
				});
			}

			const [groupsResp, permsResp] = await Promise.all([
				(txCore as any).rustRcon.sendCommand('oxide.show groups', 10000),
				(txCore as any).rustRcon.sendCommand('oxide.show perms', 10000),
			]);

			groupNames = parseOxideList(groupsResp, 'Groups');
			allPermissions = parseOxideList(permsResp, 'Permissions');
		} catch (rconErr) {
			console.warn(`RCON error fetching groups/perms: ${rconErr}`);
			return ctx.send<GetOxideGroupsDataResp>({
				rconOk: false,
			});
		}

		// Get details for each group
		const groups: OxideGroup[] = [];
		try {
			const groupDetails = await Promise.all(
				groupNames.map((name) =>
					(txCore as any).rustRcon
						.sendCommand(`oxide.show group ${name}`, 10000)
						.then((output: string) => parseGroupDetail(output, name))
						.catch((err: any) => {
							console.warn(`Failed to get group detail for '${name}': ${err}`);
							return { name, players: [], permissions: [] };
						})
				)
			);
			groups.push(...groupDetails);
		} catch (err) {
			console.warn(`Error fetching group details: ${err}`);
		}

		return ctx.send<GetOxideGroupsDataResp>({
			rconOk: true,
			allPermissions,
			groups,
		});
	} catch (err) {
		console.error(`Error in getOxideGroupsData: ${err}`);
		return ctx.send<GenericApiErrorResp>({
			error: `Failed to get oxide groups: ${err instanceof Error ? err.message : String(err)}`,
		});
	}
}


/**
 * Execute oxide groups and permissions actions
 */
export async function oxideGroupsActions(ctx: AuthedCtx) {
	try {
		// Check permissions
		if (!ctx.admin.testPermission('server.groups', modulename)) {
			return ctx.send<GenericApiErrorResp>({
				error: 'You don\'t have permission to manage groups.',
			});
		}

		const { action, group, permission, steamId } = ctx.request.body || {};

		// Validation regexes
		const validName = /^[A-Za-z0-9_.\-]+$/;
		const validSteamId = /^\d{17}$/;

		let command: string;

		try {
			// Dispatch to action handlers
			if (action === 'createGroup') {
				if (!validName.test(group)) {
					return ctx.send<OxideGroupsActionResp>({
						success: false,
						error: 'Invalid group name. Only alphanumeric, underscore, dot, and hyphen allowed.',
					});
				}
				command = `oxide.group add ${group}`;
			} else if (action === 'removeGroup') {
				if (!validName.test(group)) {
					return ctx.send<OxideGroupsActionResp>({
						success: false,
						error: 'Invalid group name.',
					});
				}
				command = `oxide.group remove ${group}`;
			} else if (action === 'grantPerm') {
				if (!validName.test(group) || !validName.test(permission)) {
					return ctx.send<OxideGroupsActionResp>({
						success: false,
						error: 'Invalid group or permission name.',
					});
				}
				command = `oxide.grant group ${group} ${permission}`;
			} else if (action === 'revokePerm') {
				if (!validName.test(group) || !validName.test(permission)) {
					return ctx.send<OxideGroupsActionResp>({
						success: false,
						error: 'Invalid group or permission name.',
					});
				}
				command = `oxide.revoke group ${group} ${permission}`;
			} else if (action === 'addMember') {
				if (!validSteamId.test(steamId) || !validName.test(group)) {
					return ctx.send<OxideGroupsActionResp>({
						success: false,
						error: 'Invalid SteamID64 or group name.',
					});
				}
				command = `oxide.usergroup add ${steamId} ${group}`;
			} else if (action === 'removeMember') {
				if (!validSteamId.test(steamId) || !validName.test(group)) {
					return ctx.send<OxideGroupsActionResp>({
						success: false,
						error: 'Invalid SteamID64 or group name.',
					});
				}
				command = `oxide.usergroup remove ${steamId} ${group}`;
			} else if (action === 'getUserGroups') {
				if (!validSteamId.test(steamId)) {
					return ctx.send<OxideGroupsActionResp>({
						success: false,
						error: 'Invalid SteamID64.',
					});
				}

				// Special case: get user groups
				try {
					if (!(txCore as any).rustRcon?.isConnected) {
						return ctx.send<OxideGroupsActionResp>({
							success: false,
							error: 'RCON not connected.',
						});
					}
					const output = await (txCore as any).rustRcon.sendCommand(
						`oxide.show user ${steamId}`,
						10000
					);
					const result = parseUserDetail(output, steamId);
					return ctx.send<OxideGroupsActionResp>({
						success: true,
						groups: result.groups,
					});
				} catch (err) {
					return ctx.send<OxideGroupsActionResp>({
						success: false,
						error: `Failed to get user groups: ${err instanceof Error ? err.message : String(err)}`,
					});
				}
			} else {
				return ctx.send<OxideGroupsActionResp>({
					success: false,
					error: 'Unknown action.',
				});
			}

			// Execute command
			if (!(txCore as any).rustRcon?.isConnected) {
				return ctx.send<OxideGroupsActionResp>({
					success: false,
					error: 'RCON not connected.',
				});
			}

			await (txCore as any).rustRcon.sendCommand(command, 10000);
			ctx.admin.logAction(`Oxide groups action: ${action} (${command})`);

			return ctx.send<OxideGroupsActionResp>({
				success: true,
			});
		} catch (err) {
			return ctx.send<OxideGroupsActionResp>({
				success: false,
				error: `Failed to execute action: ${err instanceof Error ? err.message : String(err)}`,
			});
		}
	} catch (err) {
		console.error(`Error in oxideGroupsActions: ${err}`);
		return ctx.send<GenericApiErrorResp>({
			error: `Action failed: ${err instanceof Error ? err.message : String(err)}`,
		});
	}
}
