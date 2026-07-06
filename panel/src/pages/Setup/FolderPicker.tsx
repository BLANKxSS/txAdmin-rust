import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useBackendApi } from '@/hooks/fetch';
import { FolderIcon, HardDriveIcon, CornerLeftUpIcon, Loader2Icon } from 'lucide-react';

type Entry = { name: string; path: string };
type BrowseResp = { success: boolean; message?: string; current: string; parent: string | null; folders: Entry[] };

export default function FolderPicker({
    open,
    onClose,
    onSelect,
    title = 'Select a folder',
}: {
    open: boolean;
    onClose: () => void;
    onSelect: (path: string) => void;
    title?: string;
}) {
    const [current, setCurrent] = useState('');
    const [parent, setParent] = useState<string | null>(null);
    const [folders, setFolders] = useState<Entry[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const browseApi = useBackendApi<BrowseResp>({
        method: 'POST',
        path: '/setup/browseFolder',
        throwGenericErrors: false,
    });

    const load = async (target: string) => {
        setLoading(true);
        setError(null);
        try {
            const res = await browseApi({ data: { path: target } });
            if (res?.success) {
                setCurrent(res.current);
                setParent(res.parent);
                setFolders(res.folders);
            } else {
                setError(res?.message || 'Could not open folder.');
            }
        } catch {
            setError('Could not open folder.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (open) load(''); //start at the drive list
    }, [open]);

    const atRoot = current === '';

    return (
        <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                </DialogHeader>

                {/* Current path */}
                <div className="text-xs font-mono text-muted-foreground truncate bg-muted rounded px-2 py-1">
                    {current || 'This PC'}
                </div>

                {/* Folder list */}
                <div className="h-72 overflow-y-auto rounded border divide-y">
                    {loading ? (
                        <div className="flex items-center justify-center h-full text-muted-foreground">
                            <Loader2Icon className="w-5 h-5 animate-spin" />
                        </div>
                    ) : error ? (
                        <div className="p-3 text-sm text-destructive">{error}</div>
                    ) : (
                        <>
                            {!atRoot && (
                                <button
                                    className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted text-left"
                                    onClick={() => load(parent ?? '')}
                                >
                                    <CornerLeftUpIcon className="w-4 h-4 text-muted-foreground" /> ..
                                </button>
                            )}
                            {folders.length === 0 && atRoot === false && (
                                <div className="p-3 text-sm text-muted-foreground">No subfolders here.</div>
                            )}
                            {folders.map((f) => (
                                <button
                                    key={f.path}
                                    className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted text-left"
                                    onClick={() => load(f.path)}
                                >
                                    {atRoot
                                        ? <HardDriveIcon className="w-4 h-4 text-primary" />
                                        : <FolderIcon className="w-4 h-4 text-primary" />}
                                    <span className="truncate">{f.name}</span>
                                </button>
                            ))}
                        </>
                    )}
                </div>

                <DialogFooter className="gap-2">
                    <Button variant="ghost" onClick={onClose}>Cancel</Button>
                    <Button
                        disabled={atRoot}
                        onClick={() => { onSelect(current); onClose(); }}
                    >
                        Select this folder
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
