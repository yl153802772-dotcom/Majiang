import type { LifecycleScope } from './LifecycleScope';
import type { Dispose } from './Contracts';
import { FrameworkError } from './Contracts';
export class OperationCanceledError extends Error {}
export class OperationTimeoutError extends Error {}
export interface OperationOptions { scope?: LifecycleScope; timeoutMs?: number; }
/** Cancellation belongs to each caller; late native callbacks cannot settle it a second time. */
export function asyncOperation<T>(start: (resolve: (value: T) => void, reject: (error: unknown) => void) => void | Dispose,
    options: OperationOptions = {}): Promise<T> {
    if (options.scope && !options.scope.isActive) return Promise.reject(new OperationCanceledError('Operation scope closed'));
    const timeout = options.timeoutMs ?? 15000;
    if (!Number.isFinite(timeout) || timeout <= 0) return Promise.reject(new Error('Invalid operation timeout'));
    return new Promise<T>((resolve, reject) => {
        let finished = false, cancelPhysical: void | Dispose, cancelPending = false, detach: Dispose | undefined;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const finish = (error: unknown, value?: T, cancel = false) => {
            if (finished) return; finished = true;
            if (timer !== undefined) clearTimeout(timer); detach?.();
            let failure = error;
            if (cancel) {
                cancelPending = true;
                try { cancelPhysical?.(); } catch (cleanup) { failure = new FrameworkError('Operation cancel failed', [error, cleanup]); }
            }
            if (failure !== undefined) reject(failure); else resolve(value as T);
        };
        detach = options.scope?.track(() => finish(new OperationCanceledError('Operation scope closed'), undefined, true));
        timer = setTimeout(() => finish(new OperationTimeoutError('Operation timed out'), undefined, true), timeout);
        try {
            cancelPhysical = start(value => finish(undefined, value), error => finish(error ?? new Error('Operation failed')));
            // Some APIs synchronously invoke a callback or close the caller scope before returning the task.
            if (cancelPending && cancelPhysical) { try { cancelPhysical(); } catch { /* caller already received cancellation */ } }
        } catch (error) { finish(error); }
    });
}
