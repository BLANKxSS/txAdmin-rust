//NOTE: don't import anything at the root of this file or it breaks the type definitions

/**
 * MARK: txAdmin stuff
 */
type RefreshConfigFunc = import('@modules/ConfigStore/').RefreshConfigFunc;
interface GenericTxModuleInstance {
    public handleConfigUpdate?: RefreshConfigFunc;
    public handleShutdown?: () => void;
    public timers?: NodeJS.Timer[];
    // public measureMemory?: () => { [key: string]: number };
}
declare interface GenericTxModule<T> {
    new(): InstanceType<T> & GenericTxModuleInstance;
    static readonly configKeysWatched?: string[];
}

declare type TxConfigs = import('@modules/ConfigStore/schema').TxConfigs
declare const txConfig: TxConfigs;

declare type TxCoreType = import('./txAdmin').TxCoreType;
declare const txCore: TxCoreType;

declare type TxManagerType = import('./txManager').TxManagerType;
declare const txManager: TxManagerType;

declare type TxConsole = import('./lib/console').TxConsole;
declare namespace globalThis {
    interface Console extends TxConsole { }
}


//RUSTTODO: FXServer native functions removed for Rust standalone mode
// Removed: ExecuteCommand, GetConvar, GetCurrentResourceName, GetResourceMetadata,
// GetResourcePath, IsDuplicityVersion, PrintStructuredTrace, RegisterCommand, ScanResourceRoot
//
// RUSTTODO: The two below are still used by password auth (AdminStore + auth routes).
// The INTEGRATOR must provide global implementations (e.g. bcrypt-compatible) at boot,
// or those call sites must be migrated. Declarations kept so auth code still typechecks.
declare function GetPasswordHash(password: string): string;
declare function VerifyPasswordHash(password: string, hash: string): boolean;


/**
 * MARK: Fixes
 */
declare module 'unicode-emoji-json/data-ordered-emoji' {
    const emojis: string[];
    export = emojis;
}

//FIXME: checar se eu preciso disso
// interface ProcessEnv {
//     [x: string]: string | undefined;
// }
