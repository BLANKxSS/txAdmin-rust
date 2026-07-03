import { z } from "zod";
import { typeDefinedConfig, typeNullableConfig } from "./utils";
import { SYM_FIXER_DEFAULT, SYM_FIXER_FATAL } from "@lib/symbols";


const dataPath = typeDefinedConfig({
    name: 'Server Data Path',
    default: '', //empty = not set up yet, triggers the setup wizard
    validator: z.string(),
    fixer: SYM_FIXER_FATAL,
});

const cfgPath = typeDefinedConfig({
    name: 'CFG File Path',
    default: 'server/main/cfg/server.cfg',
    validator: z.string().min(1),
    fixer: SYM_FIXER_FATAL,
});

const startupArgs = typeDefinedConfig({
    name: 'Startup Arguments',
    default: [],
    validator: z.string().array(),
    fixer: SYM_FIXER_DEFAULT,
});

const serverExe = typeDefinedConfig({
    name: 'Server Executable',
    default: 'RustDedicated.exe',
    validator: z.string().min(1),
    fixer: SYM_FIXER_FATAL,
});

const identity = typeDefinedConfig({
    name: 'Server Identity',
    default: 'main',
    validator: z.string().min(1),
    fixer: SYM_FIXER_DEFAULT,
});

const gamePort = typeDefinedConfig({
    name: 'Game Port',
    default: 28015,
    validator: z.number().int().min(1).max(65535),
    fixer: SYM_FIXER_DEFAULT,
});

const queryPort = typeDefinedConfig({
    name: 'Query Port',
    default: 28017,
    validator: z.number().int().min(1).max(65535),
    fixer: SYM_FIXER_DEFAULT,
});

const rconPort = typeDefinedConfig({
    name: 'RCON Port',
    default: 28016,
    validator: z.number().int().min(1).max(65535),
    fixer: SYM_FIXER_DEFAULT,
});

const rconPassword = typeDefinedConfig({
    name: 'RCON Password',
    default: 'change-me',
    validator: z.string().min(1),
    fixer: SYM_FIXER_DEFAULT,
});

const autoStart = typeDefinedConfig({
    name: 'Autostart',
    default: true,
    validator: z.boolean(),
    fixer: SYM_FIXER_DEFAULT,
});

const quiet = typeDefinedConfig({
    name: 'Quiet Mode',
    default: false,
    validator: z.boolean(),
    fixer: SYM_FIXER_DEFAULT,
});

const shutdownNoticeDelayMs = typeDefinedConfig({
    name: 'Shutdown Notice Delay',
    default: 5000,
    validator: z.number().int().min(0).max(60_000),
    fixer: SYM_FIXER_DEFAULT,
});

const restartSpawnDelayMs = typeDefinedConfig({
    name: 'Restart Spawn Delay',
    default: 500,
    validator: z.number().int().min(0).max(15_000),
    fixer: SYM_FIXER_DEFAULT,
});


export default {
    dataPath,
    cfgPath,
    startupArgs,
    serverExe,
    identity,
    gamePort,
    queryPort,
    rconPort,
    rconPassword,
    autoStart,
    quiet,
    shutdownNoticeDelayMs,
    restartSpawnDelayMs,
} as const;
