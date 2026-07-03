import { useState } from "react";
import { useBackendApi, BackendApiError } from "@/hooks/fetch";
import { useAdminPerms } from "@/hooks/auth";
import { useOpenConfirmDialog } from "@/hooks/dialogs";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, Loader2Icon, TrashIcon, UsersIcon } from "lucide-react";
import useSWR from "swr";
import { Alert, AlertDescription } from "@/components/ui/alert";
import GroupsList from "./GroupsList";
import GroupDetails from "./GroupDetails";

type OxideGroupsData = {
    rconOk: boolean;
    allPermissions: string[];
    groups: Array<{
        name: string;
        permissions: string[];
        players: Array<{
            steamId: string;
            name: string;
        }>;
    }>;
};

type OxideGroupsPageInnerProps = {};

function OxideGroupsPageInner({}: OxideGroupsPageInnerProps) {
    const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
    const [newGroupName, setNewGroupName] = useState("");
    const [isCreatingGroup, setIsCreatingGroup] = useState(false);
    const [createError, setCreateError] = useState<string | null>(null);

    const { hasPerm } = useAdminPerms();
    const openConfirmDialog = useOpenConfirmDialog();

    // API hooks
    const getDataApi = useBackendApi<OxideGroupsData>({
        method: "GET",
        path: "/oxideGroups",
        throwGenericErrors: true,
    });

    const createGroupApi = useBackendApi<{ success: boolean } | { error: string }>({
        method: "POST",
        path: "/oxideGroups",
        throwGenericErrors: false,
    });

    // SWR for data fetching
    const swr = useSWR("/oxideGroups", async () => {
        const data = await getDataApi({});
        if (!data) throw new Error("No data returned");
        return data;
    });

    const handleCreateGroup = async () => {
        setCreateError(null);
        if (!newGroupName.trim()) {
            setCreateError("Group name is required.");
            return;
        }

        setIsCreatingGroup(true);
        try {
            const result = await createGroupApi({
                data: {
                    action: "createGroup",
                    group: newGroupName.trim(),
                },
            });
            if (result && "success" in result && result.success) {
                setNewGroupName("");
                setSelectedGroup(newGroupName.trim());
                await swr.mutate();
            } else if (result && "error" in result) {
                setCreateError(result.error);
            }
        } catch (error) {
            if (error instanceof BackendApiError || error instanceof Error) {
                setCreateError(error.message);
            } else {
                setCreateError(JSON.stringify(error));
            }
        } finally {
            setIsCreatingGroup(false);
        }
    };

    if (!hasPerm("server.groups")) {
        return (
            <div className="flex items-center justify-center h-screen">
                <p className="text-lg text-muted-foreground">
                    You don't have permission to access groups.
                </p>
            </div>
        );
    }

    const data = swr.data;
    const selectedGroupData = data?.groups.find((g) => g.name === selectedGroup);

    return (
        <div className="w-full max-w-screen-xl mx-auto space-y-6 pb-8">
            {/* Page Header */}
            <PageHeader
                title="Groups & Permissions"
                description="Manage Oxide groups and player permissions for your Rust server"
            />

            {/* Server Offline Warning */}
            {!data?.rconOk && (
                <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                        The Rust server is currently offline. Changes to groups will be queued but
                        not applied to players until the server is back online.
                    </AlertDescription>
                </Alert>
            )}

            {/* Main Layout: Left sidebar (groups) + Right content (details) */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Left Column: Groups List */}
                <div className="lg:col-span-1">
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <UsersIcon className="w-5 h-5" />
                                Groups
                            </CardTitle>
                            <CardDescription>
                                {data?.groups.length ?? 0} group
                                {(data?.groups.length ?? 0) !== 1 ? "s" : ""}
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {/* Create Group Input */}
                            <div className="space-y-2">
                                <div className="flex gap-2">
                                    <Input
                                        placeholder="New group name"
                                        value={newGroupName}
                                        onChange={(e) => setNewGroupName(e.target.value)}
                                        disabled={isCreatingGroup || swr.isLoading}
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter") {
                                                handleCreateGroup();
                                            }
                                        }}
                                    />
                                    <Button
                                        onClick={handleCreateGroup}
                                        disabled={
                                            isCreatingGroup ||
                                            swr.isLoading ||
                                            !newGroupName.trim()
                                        }
                                        size="sm"
                                    >
                                        {isCreatingGroup ? (
                                            <Loader2Icon className="w-4 h-4 animate-spin" />
                                        ) : (
                                            "Create"
                                        )}
                                    </Button>
                                </div>
                                {createError && (
                                    <div className="text-sm text-destructive">
                                        {createError}
                                    </div>
                                )}
                            </div>

                            {/* Groups List */}
                            {!data ? (
                                <div className="text-center py-8 text-muted-foreground">
                                    <Loader2Icon className="w-6 h-6 animate-spin mx-auto mb-2" />
                                    Loading...
                                </div>
                            ) : data.groups.length === 0 ? (
                                <div className="text-center py-8 text-muted-foreground text-sm">
                                    No groups yet. Create one to get started.
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    {data.groups.map((group) => (
                                        <button
                                            key={group.name}
                                            onClick={() => setSelectedGroup(group.name)}
                                            className={`w-full text-left p-3 rounded-lg border transition-colors ${
                                                selectedGroup === group.name
                                                    ? "bg-secondary border-secondary-foreground/50"
                                                    : "bg-background border-border hover:bg-accent hover:border-accent-foreground/50"
                                            }`}
                                        >
                                            <div className="font-semibold text-sm truncate">
                                                {group.name}
                                            </div>
                                            <div className="text-xs text-muted-foreground mt-1">
                                                {group.players.length} player
                                                {group.players.length !== 1 ? "s" : ""}
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>

                {/* Right Column: Group Details */}
                <div className="lg:col-span-2">
                    {!data ? (
                        <Card>
                            <CardContent className="flex items-center justify-center h-96">
                                <Loader2Icon className="w-8 h-8 animate-spin text-muted-foreground" />
                            </CardContent>
                        </Card>
                    ) : !selectedGroup ? (
                        <Card>
                            <CardContent className="flex items-center justify-center h-96">
                                <p className="text-muted-foreground text-center">
                                    Select a group to view and manage its permissions and
                                    members.
                                </p>
                            </CardContent>
                        </Card>
                    ) : !selectedGroupData ? (
                        <Card>
                            <CardContent className="flex items-center justify-center h-96">
                                <p className="text-destructive text-center">
                                    Group not found.
                                </p>
                            </CardContent>
                        </Card>
                    ) : (
                        <GroupDetails
                            group={selectedGroupData}
                            allPermissions={data.allPermissions}
                            rconOk={data.rconOk}
                            onRefresh={() => swr.mutate()}
                            onGroupDeleted={() => {
                                setSelectedGroup(null);
                                swr.mutate();
                            }}
                        />
                    )}
                </div>
            </div>
        </div>
    );
}

export default function OxideGroupsPage() {
    return <OxideGroupsPageInner />;
}
