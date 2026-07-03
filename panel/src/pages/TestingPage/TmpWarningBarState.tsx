import { Button } from "@/components/ui/button";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import useWarningBar from "@/hooks/useWarningBar";

export default function TmpWarningBarState() {
    const {
        offlineWarning, setOfflineWarning,
        txUpdateData, setTxUpdateData,
        serverUpdateData, setServerUpdateData,
    } = useWarningBar();

    return (
        <Card className="w-min">
            <CardHeader>
                <CardTitle>Warning Bar States</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="space-y-2 divide-y-2 rounded border p-2">
                    <div className="flex justify-start gap-3">
                        <Button size="sm" onClick={() => setOfflineWarning(false)}>
                            Socket On
                        </Button>
                        <Button size="sm" onClick={() => setOfflineWarning(true)}>
                            Socket Off
                        </Button>
                    </div>
                    <pre className="bg-muted p-2">
                        {JSON.stringify(offlineWarning, null, 2)}
                    </pre>
                </div>

                <div className="space-y-2 divide-y-2 rounded border p-2">
                    <div className="flex justify-start gap-3">
                        <Button size="sm" onClick={() => setTxUpdateData({
                            version: '7.0.1',
                            isImportant: false,
                        })}>
                            txa Minor Update
                        </Button>
                        <Button size="sm" onClick={() => setTxUpdateData({
                            version: '8.0.0',
                            isImportant: true,
                        })}>
                            txa Major Update
                        </Button>
                        <Button size="sm" onClick={() => setTxUpdateData(undefined)}>
                            txa No Update
                        </Button>
                    </div>
                    <pre className="bg-muted p-2">
                        {JSON.stringify(txUpdateData, null, 2)}
                    </pre>
                </div>

                <div className="space-y-2 divide-y-2 rounded border p-2">
                    <div className="flex justify-start gap-3">
                        <Button size="sm" onClick={() => setServerUpdateData({
                            version: '7.0.1',
                            isImportant: false,
                        })}>
                            Server Minor Update
                        </Button>
                        <Button size="sm" onClick={() => setServerUpdateData({
                            version: '8.0.0',
                            isImportant: true,
                        })}>
                            Server Major Update
                        </Button>
                        <Button size="sm" onClick={() => setServerUpdateData(undefined)}>
                            Server No Update
                        </Button>
                    </div>
                    <pre className="bg-muted p-2">
                        {JSON.stringify(serverUpdateData, null, 2)}
                    </pre>
                </div>
            </CardContent>
        </Card>
    );
}
