import { getFsErrorMdMessage, getPathSubdirs } from '@lib/fs';


//Types
export type ServerDataContentType = [string, number | boolean][];
export type ServerDataConfigsType = [string, string][];


//RUSTTODO: Resource scanning - Rust server doesn't have FiveM-style resources
/**
 * Scans a server data folder and lists all files, up to the first level of each resource.
 * For Rust, this returns an empty list as Rust doesn't use resource folders.
 */
export const getServerDataContent = async (serverDataPath: string): Promise<ServerDataContentType> => {
    //RUSTTODO: Rust server doesn't have FiveM-style resources
    //Returning empty content to keep API compatibility
    return [];
}


//RUSTTODO: Config scanning - Rust server doesn't have FiveM-style resources
/**
 * Returns the content of all .cfg files based on a server data content scan.
 * For Rust, this returns empty results as there's no resource-based config scanning.
 */
export const getServerDataConfigs = async (serverDataPath: string, serverDataContent: ServerDataContentType): Promise<ServerDataConfigsType> => {
    //RUSTTODO: Rust server config scanning not applicable
    return [];
}


/**
 * Validate server data path.
 * For Rust, only checks that the path exists and is readable (no `resources` folder required).
 */
export const isValidServerDataPath = async (dataPath: string) => {
    //RUSTTODO: Rust server folder validation - only checking the path is a readable directory
    try {
        await getPathSubdirs(dataPath);
    } catch (err) {
        const error = err as Error;
        const msg = getFsErrorMdMessage(error, dataPath);
        throw new Error(msg);
    }
    return true;
};


/**
 * Look for a potential server data folder in/around the provided path.
 * RUSTTODO: FiveM-specific recovery heuristics removed - no reliable marker for a Rust server folder.
 */
export const findPotentialServerDataPaths = async (initialPath: string): Promise<string | false> => {
    //RUSTTODO: no FiveM `resources` marker to search for, so no recovery is attempted
    return false;
};
