import { asyncOperation } from '../../Kernel/AsyncOperation';
import type { OperationOptions } from '../../Kernel/AsyncOperation';
import { LifecycleScope } from '../../Kernel/LifecycleScope';
import { PlatformRuntime } from './PlatformRuntime';
import type { SubpackageProgress, SubpackageTask } from './PlatformRuntime';
type Pending = { ready: Promise<void>; listeners: Set<(progress: SubpackageProgress) => void> };
/** Native code-subpackages only. Cocos asset subpackages continue to use BundleManager/loadBundle. */
export class SubpackageLoader {
    private pending = new Map<string, Pending>();
    private loaded = new Set<string>();
    private closed = false;
    private scope = new LifecycleScope();
    private failure?: unknown;
    get lastError(): unknown { return this.failure; }
    constructor(private readonly runtime = PlatformRuntime.Instance) {}
    load(name: string, options: OperationOptions & { onProgress?: (progress: SubpackageProgress) => void } = {}): Promise<void> {
        if (this.closed || !/^[a-zA-Z0-9_-]+$/.test(name)) return Promise.reject(new Error('Subpackage unavailable or invalid name'));
        if (options.scope && !options.scope.isActive) return Promise.reject(new Error('Subpackage scope closed'));
        if (options.timeoutMs !== undefined && (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)) return Promise.reject(new Error('Invalid subpackage timeout'));
        if (this.loaded.has(name)) return Promise.resolve();
        let item = this.pending.get(name);
        if (!item) {
            const wx = this.runtime.backend(); if (!wx?.loadSubpackage) return Promise.reject(new Error('Subpackage capability unsupported'));
            const listeners = new Set<(progress: SubpackageProgress) => void>();
            let task: SubpackageTask | undefined, finished = false;
            const progress = (value: SubpackageProgress) => {
                if (finished || this.closed) return;
                const safe = Object.freeze({ progress: Math.min(100, Math.max(0, Number.isFinite(value.progress) ? value.progress : 0)),
                    totalBytesWritten: Number.isFinite(value.totalBytesWritten) ? Math.max(0, value.totalBytesWritten) : 0,
                    totalBytesExpectedToWrite: Number.isFinite(value.totalBytesExpectedToWrite) ? Math.max(0, value.totalBytesExpectedToWrite) : 0 });
                for (const listener of Array.from(listeners)) listener(safe);
            };
            const ready = new Promise<void>((resolve, reject) => {
                const finish = (error?: unknown) => {
                    if (finished) return; finished = true;
                    try { task?.offProgressUpdate?.(progress); } catch (cleanup) { this.failure = cleanup; }
                    listeners.clear(); if (error !== undefined) reject(error); else resolve();
                };
                try {
                    task = wx.loadSubpackage!({ name, success: () => finish(), fail: error => finish(error ?? new Error('Subpackage load failed')) });
                    if (!finished && task.onProgressUpdate) task.onProgressUpdate(progress);
                } catch (error) { finish(error); }
            });
            item = { ready, listeners }; this.pending.set(name, item);
            const current = item;
            void ready.then(() => { if (!this.closed) this.loaded.add(name); if (this.pending.get(name) === current) this.pending.delete(name); },
                error => { this.failure = error; if (this.pending.get(name) === current) this.pending.delete(name); });
        }
        const current = item;
        const scope = this.scope.child();
        if (options.scope) scope.add(options.scope.track(() => scope.dispose()));
        const result = asyncOperation<void>((resolve, reject) => {
            const detach = () => { current.listeners.delete(onProgress); };
            const onProgress = (value: SubpackageProgress) => { try { options.onProgress?.(value); } catch (error) { detach(); reject(error); } };
            current.listeners.add(onProgress);
            void current.ready.then(() => { detach(); if (this.closed) reject(new Error('Subpackage loader disposed')); else resolve(); }, error => { detach(); reject(error); });
            return detach;
        }, { ...options, scope });
        const cleanup = () => scope.dispose(); void result.then(cleanup, cleanup);
        return result;
    }
    getDebugInfo(): { pending: number; loaded: number } { return { pending: this.pending.size, loaded: this.loaded.size }; }
    dispose(): void { if (this.closed) return; this.closed = true; this.loaded.clear(); this.scope.dispose(); for (const item of this.pending.values()) item.listeners.clear(); }
}
