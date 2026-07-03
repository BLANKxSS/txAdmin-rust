/**
 * Standalone shims for functions that were provided by the FXServer runtime.
 * Must be imported before any module that uses them (AdminStore, auth routes).
 */
import bcrypt from 'bcryptjs';

//The web live console renders ANSI colors, but chalk disables itself when stdout
//is piped (no TTY) - force it on so console coloring works when run as a service.
if (process.env.FORCE_COLOR === undefined) {
    process.env.FORCE_COLOR = '3';
}

//FXServer natives GetPasswordHash/VerifyPasswordHash were bcrypt-based
(globalThis as any).GetPasswordHash = (password: string): string => {
    return bcrypt.hashSync(password, 10);
};

(globalThis as any).VerifyPasswordHash = (password: string, hash: string): boolean => {
    try {
        return bcrypt.compareSync(password, hash);
    } catch {
        return false;
    }
};
