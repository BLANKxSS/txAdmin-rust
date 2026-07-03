import { UpdateDataType } from '@shared/otherTypes';
import { UpdateAvailableEventType } from '@shared/socketioTypes';
import { atom, useAtom, useSetAtom } from 'jotai';


/**
 * Atoms
 */
const offlineWarningAtom = atom(false);
//RUSTTODO: Rust server update check (backend does not check Rust version currently)
const serverUpdateDataAtom = atom<UpdateDataType>(window.txConsts.fxsOutdated);
const txUpdateDataAtom = atom<UpdateDataType>(window.txConsts.txaOutdated);


/**
 * Hooks
 */
export default function useWarningBar() {
    const [offlineWarning, setOfflineWarning] = useAtom(offlineWarningAtom);
    const [serverUpdateData, setServerUpdateData] = useAtom(serverUpdateDataAtom);
    const [txUpdateData, setTxUpdateData] = useAtom(txUpdateDataAtom);

    return {
        offlineWarning, setOfflineWarning,
        serverUpdateData, setServerUpdateData,
        txUpdateData, setTxUpdateData,
    };
}

//Marks the socket as offline or online
export const useSetOfflineWarning = () => {
    return useSetAtom(offlineWarningAtom);
}

export const useProcessUpdateAvailableEvent = () => {
    const setServerUpdateData = useSetAtom(serverUpdateDataAtom);
    const setTxUpdateData = useSetAtom(txUpdateDataAtom);

    return (event: UpdateAvailableEventType) => {
        setServerUpdateData(event.fxserver);
        setTxUpdateData(event.txadmin);

        //Hacky override to prevent sticky update warnings after updating
        //NOTE: after adding the version check on socket handshake, i'm not sure if this is still required
        window.txConsts.fxsOutdated = event.fxserver;
        window.txConsts.txaOutdated = event.txadmin;
    }
};
