//RUSTTODO: FXServer version parsing is not applicable for the Rust standalone build.
//This trivial stub is kept only because @modules/Metrics/playerDrop still imports it.

/**
 * Parses a fxserver version convar into a number.
 * RUSTTODO: always returns an "invalid" result in the Rust standalone build.
 */
export const parseFxserverVersion = (version: any): ParseFxserverVersionResult => {
    return {
        valid: false,
        branch: null,
        build: null,
        platform: null,
    };
};

type ParseFxserverVersionResult = {
    valid: true;
    branch: string;
    build: number;
    platform: string;
} | {
    valid: false;
    branch: null;
    build: null;
    platform: 'windows' | 'linux' | null;
};
