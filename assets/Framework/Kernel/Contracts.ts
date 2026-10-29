export type Dispose = () => void;
export type MaybePromise<T> = T | Promise<T>;
export interface Disposable { dispose(): void; }
export interface Module {
    readonly dependencies?: readonly string[];
    readonly priority?: number;
    init?(): MaybePromise<void>;
    start?(): MaybePromise<void>;
    update?(dt: number): void;
    dispose?(): MaybePromise<void>;
}
export class FrameworkError extends Error {
    constructor(message: string, public readonly causes: readonly unknown[] = []) {
        super(message + (causes.length ? ': ' + causes.map(cause => String(cause)).join('; ') : ''));
        this.name = 'FrameworkError';
    }
}

/** 中文注释：同步收尾必须逐项尝试；错误统一交给调用方，不能中途跳出。 */
export function runCleanups(message: string, actions: readonly Dispose[]): void {
    const errors: unknown[] = [];
    for (const action of actions) try { action(); } catch (error) { errors.push(error); }
    if (errors.length) throw new FrameworkError(message, errors);
}

/** Preserve the original failure as well as any rollback failures. */
export function rollbackCleanups(cause: unknown, message: string, actions: readonly Dispose[]): never {
    try { runCleanups(message, actions); }
    catch (cleanup) { throw new FrameworkError(message, [cause, cleanup]); }
    throw cause;
}
