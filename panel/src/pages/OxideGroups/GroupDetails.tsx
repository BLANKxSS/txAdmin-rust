import { useState, useMemo } from "react";
import { useBackendApi, BackendApiError } from "@/hooks/fetch";
import { useOpenConfirmDialog } from "@/hooks/dialogs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Loader2Icon, TrashIcon, ChevronDownIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type GroupDetailsProps = {
    group: {
        name: string;
        permissions: string[];
        players: Array<{
            steamId: string;
            name: string;
        }>;
    };
    allPermissions: string[];
    rconOk: boolean;
    onRefresh: () => void;
    onGroupDeleted: () => void;
};

type PermissionGroup = {
    prefix: string;
    permissions: Array<{
        name: string;
        hasPermission: boolean;
    }>;
};

function GroupDetails({
    group,
    allPermissions,
    rconOk,
    onRefresh,
    onGroupDeleted,
}: GroupDetailsProps) {
    const [permSearchText, setPermSearchText] = useState("");
    const [newMemberSteamId, setNewMemberSteamId] = useState("");
    const [addMemberLoading, setAddMemberLoading] = useState(false);
    const [addMemberError, setAddMemberError] = useState<string | null>(null);
    const openConfirmDialog = useOpenConfirmDialog();

    // API hooks
    const mutateApi = useBackendApi<{ success: boolean } | { error: string }>({
        method: "POST",
        path: "/oxideGroups",
        throwGenericErrors: false,
    });

    const deleteGroupApi = useBackendApi<{ success: boolean } | { error: string }>({
        method: "POST",
        path: "/oxideGroups",
        throwGenericErrors: false,
    });

    // Group permissions by plugin prefix
    const permissionGroups: PermissionGroup[] = useMemo(() => {
        const grouped = new Map<string, Set<string>>();

        allPermissions.forEach((perm) => {
            const prefix = perm.includes(".") ? perm.split(".")[0] : "other";
            if (!grouped.has(prefix)) {
                grouped.set(prefix, new Set());
            }
            grouped.get(prefix)!.add(perm);
        });

        return Array.from(grouped.entries())
            .map(([prefix, perms]) => ({
                prefix,
                permissions: Array.from(perms)
                    .sort()
                    .map((perm) => ({
                        name: perm,
                        hasPermission: group.permissions.includes(perm),
                    }))
                    .filter(
                        (p) =>
                            permSearchText === "" ||
                            p.name
                                .toLowerCase()
                                .includes(permSearchText.toLowerCase())
                    ),
            }))
            .filter((group) => group.permissions.length > 0)
            .sort((a, b) => a.prefix.localeCompare(b.prefix));
    }, [allPermissions, group.permissions, permSearchText]);

    const handleTogglePermission = async (
        permission: string,
        hasPermission: boolean
    ) => {
        try {
            const result = await mutateApi({
                data: {
                    action: hasPermission ? "revokePerm" : "grantPerm",
                    group: group.name,
                    permission,
                },
            });
            if (result && "success" in result && result.success) {
                onRefresh();
            } else if (result && "error" in result) {
                console.error("Failed to update permission:", result.error);
            }
        } catch (error) {
            console.error("Failed to update permission:", error);
        }
    };

    const handleAddMember = async () => {
        setAddMemberError(null);
        const steamId = newMemberSteamId.trim();

        if (!steamId) {
            setAddMemberError("SteamID64 is required.");
            return;
        }

        if (!/^\d+$/.test(steamId)) {
            setAddMemberError("Invalid SteamID64 format. Use only digits.");
            return;
        }

        if (group.players.some((p) => p.steamId === steamId)) {
            setAddMemberError("This player is already a member of this group.");
            return;
        }

        setAddMemberLoading(true);
        try {
            const result = await mutateApi({
                data: {
                    action: "addMember",
                    group: group.name,
                    steamId,
                },
            });
            if (result && "success" in result && result.success) {
                setNewMemberSteamId("");
                onRefresh();
            } else if (result && "error" in result) {
                setAddMemberError(result.error);
            }
        } catch (error) {
            if (error instanceof BackendApiError || error instanceof Error) {
                setAddMemberError(error.message);
            } else {
                setAddMemberError(JSON.stringify(error));
            }
        } finally {
            setAddMemberLoading(false);
        }
    };

    const handleRemoveMember = (steamId: string, playerName: string) => {
        openConfirmDialog({
            title: "Remove Member",
            actionLabel: "Remove",
            confirmBtnVariant: "destructive",
            message: (
                <p>
                    Are you sure you want to remove <strong>{playerName}</strong> from{" "}
                    <strong>{group.name}</strong>?
                </p>
            ),
            onConfirm: async () => {
                try {
                    const result = await mutateApi({
                        data: {
                            action: "removeMember",
                            group: group.name,
                            steamId,
                        },
                    });
                    if (result && "success" in result && result.success) {
                        onRefresh();
                    } else if (result && "error" in result) {
                        console.error("Failed to remove member:", result.error);
                    }
                } catch (error) {
                    console.error("Failed to remove member:", error);
                }
            },
        });
    };

    const handleDeleteGroup = () => {
        openConfirmDialog({
            title: "Delete Group",
            actionLabel: "Delete",
            confirmBtnVariant: "destructive",
            message: (
                <p>
                    Are you sure you want to delete <strong>{group.name}</strong>? This
                    action cannot be undone.
                </p>
            ),
            onConfirm: async () => {
                try {
                    const result = await deleteGroupApi({
                        data: {
                            action: "removeGroup",
                            group: group.name,
                        },
                    });
                    if (result && "success" in result && result.success) {
                        onGroupDeleted();
                    } else if (result && "error" in result) {
                        console.error("Failed to delete group:", result.error);
                    }
                } catch (error) {
                    console.error("Failed to delete group:", error);
                }
            },
        });
    };

    return (
        <div className="space-y-6">
            {/* Permissions Section */}
            <Card>
                <CardHeader>
                    <CardTitle>Permissions</CardTitle>
                    <CardDescription>
                        Manage permissions for this group
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <Input
                        placeholder="Search permissions..."
                        value={permSearchText}
                        onChange={(e) => setPermSearchText(e.target.value)}
                    />

                    <div className="space-y-4">
                        {permissionGroups.length === 0 ? (
                            <div className="text-center py-8 text-muted-foreground text-sm">
                                No permissions match your search.
                            </div>
                        ) : (
                            permissionGroups.map((group) => (
                                <PermissionGroup
                                    key={group.prefix}
                                    group={group}
                                    onToggle={handleTogglePermission}
                                />
                            ))
                        )}
                    </div>
                </CardContent>
            </Card>

            {/* Members Section */}
            <Card>
                <CardHeader>
                    <CardTitle>Members</CardTitle>
                    <CardDescription>
                        {group.players.length} player
                        {group.players.length !== 1 ? "s" : ""} in this group
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    {/* Add Member Input */}
                    <div className="space-y-2">
                        <label className="text-sm font-medium">Add Member by SteamID64</label>
                        <div className="flex gap-2">
                            <Input
                                placeholder="e.g., 76561198000000000"
                                value={newMemberSteamId}
                                onChange={(e) => setNewMemberSteamId(e.target.value)}
                                disabled={addMemberLoading}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                        handleAddMember();
                                    }
                                }}
                            />
                            <Button
                                onClick={handleAddMember}
                                disabled={
                                    addMemberLoading || !newMemberSteamId.trim()
                                }
                                size="sm"
                            >
                                {addMemberLoading ? (
                                    <Loader2Icon className="w-4 h-4 animate-spin" />
                                ) : (
                                    "Add"
                                )}
                            </Button>
                        </div>
                        {addMemberError && (
                            <div className="text-sm text-destructive">
                                {addMemberError}
                            </div>
                        )}
                    </div>

                    {/* Members List */}
                    {group.players.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground text-sm">
                            No members in this group yet.
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {group.players.map((player) => (
                                <div
                                    key={player.steamId}
                                    className="flex items-center justify-between p-3 rounded-lg border bg-background hover:bg-accent/50 transition-colors"
                                >
                                    <div className="flex-1 min-w-0">
                                        <div className="font-medium text-sm truncate">
                                            {player.name}
                                        </div>
                                        <div className="text-xs text-muted-foreground font-mono">
                                            {player.steamId}
                                        </div>
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() =>
                                            handleRemoveMember(
                                                player.steamId,
                                                player.name
                                            )
                                        }
                                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                                    >
                                        <TrashIcon className="w-4 h-4" />
                                    </Button>
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Delete Group Section */}
            <Card className="border-destructive/50 bg-destructive/5">
                <CardHeader>
                    <CardTitle className="text-destructive">Danger Zone</CardTitle>
                </CardHeader>
                <CardContent>
                    <Button
                        variant="destructive"
                        onClick={handleDeleteGroup}
                        className="w-full sm:w-auto"
                    >
                        <TrashIcon className="w-4 h-4 mr-2" />
                        Delete Group
                    </Button>
                </CardContent>
            </Card>
        </div>
    );
}

// Collapsible permission group
function PermissionGroup({
    group,
    onToggle,
}: {
    group: PermissionGroup;
    onToggle: (permission: string, hasPermission: boolean) => void;
}) {
    const [isExpanded, setIsExpanded] = useState(true);

    return (
        <div className="border rounded-lg overflow-hidden">
            <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="w-full p-3 flex items-center justify-between bg-secondary/30 hover:bg-secondary/50 transition-colors text-left"
            >
                <span className="font-semibold text-sm">{group.prefix}</span>
                <ChevronDownIcon
                    className={cn(
                        "w-4 h-4 transition-transform",
                        isExpanded ? "rotate-180" : ""
                    )}
                />
            </button>

            {isExpanded && (
                <div className="p-3 space-y-3 bg-background">
                    {group.permissions.map((perm) => (
                        <div
                            key={perm.name}
                            className="flex items-center justify-between p-2 rounded hover:bg-accent/50 transition-colors"
                        >
                            <label className="text-sm font-medium flex-1 cursor-pointer">
                                {perm.name}
                            </label>
                            <Switch
                                checked={perm.hasPermission}
                                onCheckedChange={() =>
                                    onToggle(perm.name, perm.hasPermission)
                                }
                            />
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

export default GroupDetails;
