import consoleFactory from '@lib/console';
import { UpdateConfigKeySet } from '@modules/ConfigStore/utils';

const console = consoleFactory('RustRcon');

type MessageListener = (line: { type: string; message: string }) => void;
type StatusChangeListener = (connected: boolean) => void;

type PendingCommand = {
    resolve: (value: string) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
};

/**
 * Manages WebSocket connection to Rust RCon server and handles command execution
 */
export default class RustRcon {
    static readonly configKeysWatched = ['server.rconPort', 'server.rconPassword'];

    private ws: WebSocket | null = null;
    private nextIdentifier = 1;
    private pendingCommands = new Map<number, PendingCommand>();
    private messageListeners: MessageListener[] = [];
    private statusChangeListeners: StatusChangeListener[] = [];
    private reconnectTimer: NodeJS.Timeout | null = null;
    private isConnecting = false;
    private shouldReconnect = false;

    constructor() {
        // Empty constructor - connect is called explicitly
    }

    /**
     * Returns whether the WebSocket is currently connected
     */
    get isConnected(): boolean {
        return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
    }

    /**
     * Sends a command to the Rust server and waits for the response
     * @param command The command to send
     * @param timeoutMs Timeout in milliseconds (default 10000)
     */
    async sendCommand(command: string, timeoutMs = 10_000): Promise<string> {
        if (!this.isConnected) {
            throw new Error('RCon is not connected');
        }

        const identifier = this.nextIdentifier++;
        const message = JSON.stringify({
            Identifier: identifier,
            Message: command,
            Name: 'txAdmin',
        });

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pendingCommands.delete(identifier);
                reject(new Error(`Command timeout after ${timeoutMs}ms`));
            }, timeoutMs);

            this.pendingCommands.set(identifier, { resolve, reject, timeout });

            try {
                this.ws!.send(message);
            } catch (error) {
                this.pendingCommands.delete(identifier);
                clearTimeout(timeout);
                reject(new Error(`Failed to send command: ${(error as any).message}`));
            }
        });
    }

    /**
     * Register a listener for unsolicited console messages
     */
    onMessage(listener: MessageListener): void {
        this.messageListeners.push(listener);
    }

    /**
     * Register a listener for connection status changes
     */
    onStatusChange(listener: StatusChangeListener): void {
        this.statusChangeListeners.push(listener);
    }

    /**
     * Handle config updates that might affect RCON settings
     */
    handleConfigUpdate(updatedConfigs: UpdateConfigKeySet) {
        // If RCON settings changed, reconnect with the new settings
        if (updatedConfigs.hasMatch(RustRcon.configKeysWatched)) {
            const wasActive = this.shouldReconnect;
            this.disconnect();
            if (wasActive) {
                console.log('RCON configuration changed, reconnecting.');
                this.connect();
            }
        }
    }

    /**
     * Starts the WebSocket connection and auto-reconnect loop
     */
    connect(): void {
        if (this.shouldReconnect) return; // Already connecting/reconnecting
        this.shouldReconnect = true;
        this.attemptConnect();
    }

    /**
     * Stops the auto-reconnect loop and closes the WebSocket
     */
    disconnect(): void {
        this.shouldReconnect = false;
        this.clearReconnectTimer();
        this.closeWebSocket();
        this.rejectAllPendingCommands(new Error('RCon disconnected'));
    }

    /**
     * Attempts to establish a WebSocket connection
     */
    private attemptConnect(): void {
        if (this.isConnected || this.isConnecting) return;
        if (!this.shouldReconnect) return;

        this.isConnecting = true;

        try {
            const rconPort = txConfig.server.rconPort;
            const rconPassword = txConfig.server.rconPassword;

            if (!rconPort || !rconPassword) {
                throw new Error('Missing RCon configuration (port or password)');
            }

            const url = `ws://127.0.0.1:${rconPort}/${rconPassword}`;
            console.verbose.debug(`Attempting to connect to RCon: ${url}`);

            this.ws = new WebSocket(url);

            this.ws.addEventListener('open', this.handleSocketOpen.bind(this));
            this.ws.addEventListener('message', this.handleSocketMessage.bind(this));
            this.ws.addEventListener('error', this.handleSocketError.bind(this));
            this.ws.addEventListener('close', this.handleSocketClose.bind(this));
        } catch (error) {
            this.isConnecting = false;
            console.verbose.error(`RCon connection error: ${(error as any).message}`);
            this.scheduleReconnect();
        }
    }

    /**
     * Handles WebSocket open event
     */
    private handleSocketOpen(): void {
        this.isConnecting = false;
        console.log('RCon connected successfully');
        this.clearReconnectTimer();
        this.emitStatusChange(true);
    }

    /**
     * Handles incoming WebSocket messages
     */
    private handleSocketMessage(event: Event): void {
        const wsEvent = event as any;
        let data: any;

        try {
            data = JSON.parse(wsEvent.data);
        } catch (error) {
            console.verbose.warn(`Failed to parse RCon message: ${(error as any).message}`);
            return;
        }

        const { Identifier, Message, Type } = data;

        // Check if this is a response to a pending command
        if (typeof Identifier === 'number' && this.pendingCommands.has(Identifier)) {
            const pending = this.pendingCommands.get(Identifier)!;
            this.pendingCommands.delete(Identifier);
            clearTimeout(pending.timeout);

            if (Message !== undefined) {
                pending.resolve(Message);
            } else {
                pending.reject(new Error('Empty response from RCon'));
            }
        } else {
            // Unsolicited message (console broadcast)
            const type = typeof Type === 'string' ? Type.toLowerCase() : 'generic';
            this.emitMessage({ type, message: Message || '' });
        }
    }

    /**
     * Handles WebSocket error event
     */
    private handleSocketError(event: Event): void {
        const wsEvent = event as any;
        console.verbose.error(`RCon error: ${wsEvent.message || 'Unknown error'}`);
    }

    /**
     * Handles WebSocket close event
     */
    private handleSocketClose(): void {
        this.isConnecting = false;
        this.closeWebSocket();
        this.rejectAllPendingCommands(new Error('WebSocket closed'));
        this.emitStatusChange(false);

        if (this.shouldReconnect) {
            this.scheduleReconnect();
        }
    }

    /**
     * Closes the WebSocket connection
     */
    private closeWebSocket(): void {
        if (!this.ws) return;
        try {
            if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
                this.ws.close();
            }
        } catch (error) {
            console.verbose.error(`Error closing WebSocket: ${(error as any).message}`);
        } finally {
            this.ws = null;
        }
    }

    /**
     * Schedules a reconnection attempt in 10 seconds
     */
    private scheduleReconnect(): void {
        this.clearReconnectTimer();
        this.reconnectTimer = setTimeout(() => {
            this.attemptConnect();
        }, 10_000);
    }

    /**
     * Clears the reconnection timer
     */
    private clearReconnectTimer(): void {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }

    /**
     * Rejects all pending commands
     */
    private rejectAllPendingCommands(error: Error): void {
        for (const [, pending] of this.pendingCommands) {
            clearTimeout(pending.timeout);
            pending.reject(error);
        }
        this.pendingCommands.clear();
    }

    /**
     * Emits a message to all registered listeners
     */
    private emitMessage(line: { type: string; message: string }): void {
        for (const listener of this.messageListeners) {
            try {
                listener(line);
            } catch (error) {
                console.verbose.error(`Error in message listener: ${(error as any).message}`);
            }
        }
    }

    /**
     * Emits a status change to all registered listeners
     */
    private emitStatusChange(connected: boolean): void {
        for (const listener of this.statusChangeListeners) {
            try {
                listener(connected);
            } catch (error) {
                console.verbose.error(`Error in status change listener: ${(error as any).message}`);
            }
        }
    }
}
