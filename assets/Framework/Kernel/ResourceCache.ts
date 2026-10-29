import type { LifecycleScope } from './LifecycleScope';
import { FrameworkError, runCleanups } from './Contracts';
export interface ResourceDriver<T> {
    load(key: string): Promise<T>;
    /** Must be atomic: if retaining throws, the driver unwinds partial side effects. */
    retain(value: T): void;
    release(value: T): void;
    /** Optional diagnostics for failures after all consumers have left. Must not throw. */
    onError?(error: unknown): void;
}
export interface ResourceHandle<T> { readonly value: T; readonly released: boolean; release(): void; }
export interface AcquireOptions { scope?: LifecycleScope; timeoutMs?: number; }
type Entry<T> = { key: string; users: number; value?: T; retained: boolean; ready: Promise<T>; lastUsed: number; };
export class ResourceCanceledError extends Error {}
/** One engine reference per cached entry. Consumer ownership is tracked separately. */
export class ResourceCache<T> {
    private entries = new Map<string, Entry<T>>();
    private queue: Array<() => void> = [];
    private active = 0;
    private closed = false;
    private peak = 0;
    private failure?: unknown;
    get lastError(): unknown { return this.failure; }
    constructor(private driver: ResourceDriver<T>, private concurrency = 4, private maxIdle = 16,
        private now: () => number = Date.now) {
        if (!Number.isInteger(concurrency) || concurrency < 1 || !Number.isInteger(maxIdle) || maxIdle < 0)
            throw new Error('Invalid resource cache limits');
    }
    async acquire(key: string, options: AcquireOptions = {}): Promise<ResourceHandle<T>> {
        if (this.closed || (options.scope && !options.scope.isActive)) throw new ResourceCanceledError('Resource scope closed');
        if (!key) throw new Error('Empty resource key');
        if (options.timeoutMs !== undefined && (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0))
            throw new Error('Invalid resource timeout');
        let entry = this.entries.get(key);
        if (!entry) {
            entry = { key, users: 0, retained: false, ready: Promise.resolve(undefined as T), lastUsed: this.now() };
            this.entries.set(key, entry);
            const current = entry;
            current.ready = this.schedule(() => this.driver.load(key)).then(value => {
                this.driver.retain(value);
                current.value = value; current.retained = true;
                if (this.closed) throw new ResourceCanceledError('Cache disposed');
                this.trim();
                return value;
            }).catch(error => {
                if (this.entries.get(key) === current) this.entries.delete(key);
                // No consumer has received a handle before ready resolves. A retain
                // or eviction failure therefore rolls back this pending entry only.
                if (current.retained) {
                    try { this.releaseEntry(current); }
                    catch (cleanup) { throw new FrameworkError('Resource load rollback failed', [error, cleanup]); }
                }
                throw error;
            });
            // A scope can cancel all consumers before the physical request completes.
            void current.ready.catch(error => {
                this.failure = error;
                try { this.driver.onError?.(error); }
                catch (reporting) { this.failure = new FrameworkError('Resource error reporting failed', [error, reporting]); }
            });
        }
        const current = entry;
        current.users++;
        let returned = false, detach: (() => void) | undefined, timeout: ReturnType<typeof setTimeout> | undefined;
        const release = () => {
            if (returned) return;
            returned = true;
            detach?.();
            if (timeout !== undefined) clearTimeout(timeout);
            current.users--;
            current.lastUsed = this.now();
            this.trim();
        };
        try {
            const value = await new Promise<T>((resolve, reject) => {
                const cancel = (reason: ResourceCanceledError, fromScope: boolean) => {
                    try { release(); }
                    catch (cleanup) {
                        reject(new FrameworkError('Resource cancellation cleanup failed', [reason, cleanup]));
                        if (fromScope) throw cleanup;
                        return;
                    }
                    reject(reason);
                };
                detach = options.scope?.track(() => cancel(new ResourceCanceledError('Load abandoned: ' + key), true));
                if (options.timeoutMs !== undefined)
                    timeout = setTimeout(() => cancel(new ResourceCanceledError('Load timed out: ' + key), false), options.timeoutMs);
                current.ready.then(resolve, reject);
            });
            if (returned || this.closed || (options.scope && !options.scope.isActive)) throw new ResourceCanceledError('Load abandoned: ' + key);
            if (timeout !== undefined) clearTimeout(timeout);
            detach?.();
            const handle: ResourceHandle<T> = { value, get released() { return returned; }, release };
            detach = options.scope?.track(release);
            return handle;
        } catch (error) {
            try { release(); }
            catch (cleanup) { throw new FrameworkError('Resource acquisition cleanup failed', [error, cleanup]); }
            throw error;
        }
    }
    private schedule(load: () => Promise<T>): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            const run = () => {
                if (this.closed) { reject(new ResourceCanceledError('Cache disposed')); return; }
                this.active++; this.peak = Math.max(this.peak, this.active);
                Promise.resolve().then(load).then(resolve, reject).finally(() => {
                    this.active--;
                    this.queue.shift()?.();
                });
            };
            if (this.active < this.concurrency) run(); else this.queue.push(run);
        });
    }
    private evict(entry: Entry<T>): void {
        if (entry.users || !entry.retained) return;
        if (this.entries.get(entry.key) === entry) this.entries.delete(entry.key);
        this.releaseEntry(entry);
    }
    private releaseEntry(entry: Entry<T>): void {
        if (!entry.retained) return;
        const value = entry.value as T;
        entry.retained = false; entry.value = undefined;
        this.driver.release(value);
    }
    trim(maxIdle = this.maxIdle): void {
        if (!Number.isInteger(maxIdle) || maxIdle < 0) throw new Error('Invalid idle resource limit');
        const idle = Array.from(this.entries.values()).filter(e => e.users === 0 && e.retained)
            .sort((a, b) => a.lastUsed - b.lastUsed);
        runCleanups('Resource eviction failed', idle.slice(0, Math.max(0, idle.length - maxIdle)).map(entry => () => this.evict(entry)));
    }
    clearIdle(): void { this.trim(0); }
    stats(): { entries: number; owners: number; loading: number; queued: number; peakConcurrency: number } {
        return { entries: this.entries.size, owners: Array.from(this.entries.values()).reduce((n, e) => n + e.users, 0),
            loading: this.active, queued: this.queue.length, peakConcurrency: this.peak };
    }
    dispose(): void {
        if (Array.from(this.entries.values()).some(e => e.users > 0)) throw new Error('Resources still owned; close scopes first');
        this.closed = true;
        runCleanups('Resource cache disposal failed', [
            () => this.clearIdle(),
            () => { for (const run of this.queue.splice(0)) run(); },
            () => { for (const [key, entry] of this.entries) if (!entry.retained) this.entries.delete(key); },
        ]);
    }
}
