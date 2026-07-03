import ConsoleLineEnum from './ConsoleLineEnum';
import { prefixMultiline, splitFirstLine, stripLastEol } from './fxsLoggerUtils';
import chalk, { ChalkInstance } from 'chalk';


//Types
export type MultiBuffer = {
    webBuffer: string;
    stdoutBuffer: string;
    fileBuffer: string;
}

type StylesLibrary = {
    [key in ConsoleLineEnum]: StyleConfig | null;
};
type StyleConfig = {
    web: StyleChannelConfig;
    stdout: StyleChannelConfig | false;
}
type StyleChannelConfig = {
    prefix?: ChalkInstance;
    line?: ChalkInstance;
}


//Precalculating some styles
const chalkToStr = (color: ChalkInstance) => color('\x00').split('\x00')[0];
const precalcMarkerAdminCmd = chalkToStr(chalk.bgAnsi256(180).black);
const precalcMarkerSystemCmd = chalkToStr(chalk.bgAnsi256(237).ansi256(252));
const precalcMarkerInfo = chalkToStr(chalk.bgBlueBright.black);
const ANSI_RESET = '\x1B[0m';
const ANSI_ERASE_LINE = '\x1b[K';

const STYLES = {
    [ConsoleLineEnum.StdOut]: null, //fully shortcircuited
    [ConsoleLineEnum.StdErr]: {
        web: {
            prefix: chalk.bgRedBright.bold.black,
            line: chalk.bold.redBright,
        },
        stdout: {
            prefix: chalk.bgRedBright.bold.black,
            line: chalk.bold.redBright,
        },
    },
    [ConsoleLineEnum.MarkerAdminCmd]: {
        web: {
            prefix: chalk.bold,
            line: x => `${precalcMarkerAdminCmd}${x}${ANSI_ERASE_LINE}${ANSI_RESET}`,
        },
        stdout: false,
    },
    [ConsoleLineEnum.MarkerSystemCmd]: {
        web: {
            prefix: chalk.bold,
            line: x => `${precalcMarkerSystemCmd}${x}${ANSI_ERASE_LINE}${ANSI_RESET}`,
        },
        stdout: false,
    },
    [ConsoleLineEnum.MarkerInfo]: {
        web: {
            prefix: chalk.bold,
            line: x => `${precalcMarkerInfo}${x}${ANSI_ERASE_LINE}${ANSI_RESET}`,
        },
        stdout: {
            prefix: chalk.bgBlueBright.black,
            line: chalk.bgBlueBright.black,
        },
    },
} as StylesLibrary;

export const FORCED_EOL = '\u21A9\n'; //used in test file only

//NOTE: [jan/2025] Changed from [] to make it easier to find tx stdin in the log files
const prefixChar = '║' //Alternatives: | & ┇
const getConsoleLinePrefix = (prefix: string) => prefixChar + prefix.padStart(20, ' ') + prefixChar;

//NOTE: the \n must come _after_ the color so LiveConsolePage.tsx can know when it's an incomplete line
const colorLines = (str: string, color: ChalkInstance | undefined) => {
    if (!color) return str;
    const stripped = stripLastEol(str);
    return color(stripped.str) + stripped.eol;
};


/**
 * Colorizes and tags Rust server output based on line category.
 * Patterns checked in order: errors, warnings, chat, plugin/script messages, else server.
 */
const RUST_TAGS = {
    error: chalk.bgRedBright.black(' ERROR '),
    warn: chalk.bgYellowBright.black(' WARN  '),
    chat: chalk.bgGreenBright.black(' CHAT  '),
    plugin: chalk.bgCyanBright.black(' PLUGIN'),
    server: chalk.bgAnsi256(238).ansi256(250)(' SERVER'),
} as const;

const colorizeRustLine = (chunk: string, isLineStart = true): string => {
    if (!chunk) return chunk;
    //continuation of a partial line: category unknown, never tag mid-line
    if (!isLineStart) return chunk;

    const stripped = stripLastEol(chunk);
    const lines = stripped.str.split('\n');

    const colored = lines.map((line) => {
        if (!line) return line; // empty line, return as-is

        // errors → red
        if (/exception|\berror\b|failed|fatal|NullReference|^\s+at\s|stacktrace/i.test(line)) {
            return `${RUST_TAGS.error} ${chalk.redBright(line)}`;
        }
        // warnings → yellow
        else if (/\bwarn(ing)?\b/i.test(line)) {
            return `${RUST_TAGS.warn} ${chalk.yellowBright(line)}`;
        }
        // chat → green
        else if (/^\[(chat|better ?chat)\]/i.test(line)) {
            return `${RUST_TAGS.chat} ${chalk.greenBright(line)}`;
        }
        // plugin/script messages → cyan
        else if (/^(\[[\w .-]+\]|Loaded plugin|Unloaded plugin|Calling '|\[Oxide\])/i.test(line)) {
            return `${RUST_TAGS.plugin} ${chalk.cyan(line)}`;
        }
        // everything else is main server output
        return `${RUST_TAGS.server} ${line}`;
    });

    return colored.join('\n') + stripped.eol;
};


/**
 * Handles fxserver stdio and turns it into a cohesive textual output
 */
export default class ConsoleTransformer {
    public lastEol = true;
    private lastSrc = '0:undefined';
    private lastMarkerTs = 0; //in seconds
    private STYLES = STYLES;
    private PREFIX_SYSTEM = getConsoleLinePrefix('TXADMIN');
    private PREFIX_STDERR = getConsoleLinePrefix('STDERR');

    public process(type: ConsoleLineEnum, data: string, context?: string): MultiBuffer {
        //Shortcircuiting for empty strings
        if (!data.length) return { webBuffer: '', stdoutBuffer: '', fileBuffer: '' };
        const src = `${type}:${context}`;
        if (data === '\n' || data === '\r\n') {
            this.lastEol = true;
            this.lastSrc = src;
            return { webBuffer: '\n', stdoutBuffer: '\n', fileBuffer: '\n' };
        }
        let webBuffer = '';
        let stdoutBuffer = '';
        let fileBuffer = '';

        //incomplete
        if (!this.lastEol) {
            //diff source
            if (src !== this.lastSrc) {
                webBuffer += FORCED_EOL;
                stdoutBuffer += FORCED_EOL;
                fileBuffer += FORCED_EOL;
                const prefixed = this.prefixChunk(type, data, context);
                webBuffer += this.getTimeMarker() + prefixed.webBuffer;
                stdoutBuffer += prefixed.stdoutBuffer;
                fileBuffer += prefixed.fileBuffer;
                this.lastEol = data[data.length - 1] === '\n';
                this.lastSrc = src;
                return { webBuffer, stdoutBuffer, fileBuffer };
            }
            //same source
            const parts = splitFirstLine(data);
            fileBuffer += parts.first;
            const style = this.STYLES[type];
            if (style === null) {
                webBuffer += colorizeRustLine(parts.first, false);
                stdoutBuffer += parts.first;
            } else {
                webBuffer += colorLines(
                    parts.first,
                    style.web.line,
                );
                stdoutBuffer += style.stdout ? colorLines(
                    parts.first,
                    style.stdout.line,
                ) : '';
            }
            if (parts.rest) {
                const prefixed = this.prefixChunk(type, parts.rest, context);
                webBuffer += this.getTimeMarker() + prefixed.webBuffer;
                stdoutBuffer += prefixed.stdoutBuffer;
                fileBuffer += prefixed.fileBuffer;
            }
            this.lastEol = parts.eol;
            return { webBuffer, stdoutBuffer, fileBuffer };
        }

        //complete
        const prefixed = this.prefixChunk(type, data, context);
        webBuffer += this.getTimeMarker() + prefixed.webBuffer;
        stdoutBuffer += prefixed.stdoutBuffer;
        fileBuffer += prefixed.fileBuffer;
        this.lastEol = data[data.length - 1] === '\n';
        this.lastSrc = src;

        return { webBuffer, stdoutBuffer, fileBuffer };
    }

    private getTimeMarker() {
        const currMarkerTs = Math.floor(Date.now() / 1000);
        if (currMarkerTs !== this.lastMarkerTs) {
            this.lastMarkerTs = currMarkerTs;
            return `{§${currMarkerTs.toString(16)}}`
        }
        return '';
    }

    private prefixChunk(type: ConsoleLineEnum, chunk: string, context?: string): MultiBuffer {
        //NOTE: as long as stdout is shortcircuited, the other ones don't need to be micro-optimized
        const style = this.STYLES[type];
        if (style === null) {
            return {
                webBuffer: colorizeRustLine(chunk),
                stdoutBuffer: chunk,
                fileBuffer: chunk,
            };
        }

        //selecting prefix and color
        let prefix = '';
        if (type === ConsoleLineEnum.StdErr) {
            prefix = this.PREFIX_STDERR;
        } else if (type === ConsoleLineEnum.MarkerAdminCmd) {
            prefix = getConsoleLinePrefix(context ?? '?');
        } else if (type === ConsoleLineEnum.MarkerSystemCmd) {
            prefix = this.PREFIX_SYSTEM;
        } else if (type === ConsoleLineEnum.MarkerInfo) {
            prefix = this.PREFIX_SYSTEM;
        }

        const webPrefix = style.web.prefix ? style.web.prefix(prefix) : prefix;
        const webBuffer = colorLines(
            prefixMultiline(chunk, webPrefix + ' '),
            style.web.line,
        );

        let stdoutBuffer = '';
        if (style.stdout) {
            const stdoutPrefix = style.stdout.prefix ? style.stdout.prefix(prefix) : prefix;
            stdoutBuffer = colorLines(
                prefixMultiline(chunk, stdoutPrefix + ' '),
                style.stdout.line,
            );
        }
        const fileBuffer = prefixMultiline(chunk, prefix + ' ');

        return { webBuffer, stdoutBuffer, fileBuffer };
    }
};
