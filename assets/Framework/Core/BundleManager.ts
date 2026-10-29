import { assetManager, resources, AssetManager } from 'cc';
import { asyncOperation } from '../Kernel/AsyncOperation';
import type { OperationOptions } from '../Kernel/AsyncOperation';
export interface BundleSource { readonly source: string; readonly version?: string; readonly timeoutMs?: number; readonly retries?: number; }
/** Bundle lifetime is controlled by ResManager; removing a bundle does not force-release assets. */
export class BundleManager {
    private static pending = new Map<string, Promise<AssetManager.Bundle>>();
    private static sources = new Map<string, Readonly<BundleSource>>();
    private static resolved = new Map<string, AssetManager.Bundle>();
    private static known = new Map<string, AssetManager.Bundle>();
    static register(name: string, descriptor: BundleSource): void {
        if (!/^[a-zA-Z0-9_-]+$/.test(name) || ['resources', 'main', 'internal', 'start-scene'].includes(name)) throw new Error('Invalid custom bundle name');
        if (!/^https:\/\/[^\s?#]+$/.test(descriptor.source) && !/^[a-zA-Z0-9_-]+$/.test(descriptor.source)) throw new Error('Bundle source must be a local name or HTTPS URL');
        if (descriptor.version !== undefined && !/^[a-zA-Z0-9_-]+$/.test(descriptor.version)) throw new Error('Invalid bundle version');
        if (descriptor.timeoutMs !== undefined && (!Number.isFinite(descriptor.timeoutMs) || descriptor.timeoutMs <= 0)) throw new Error('Invalid bundle timeout');
        if (descriptor.retries !== undefined && (!Number.isInteger(descriptor.retries) || descriptor.retries < 0 || descriptor.retries > 2)) throw new Error('Invalid bundle retry count');
        if (this.sources.has(name) || this.pending.has(name) || this.getLoadedBundle(name)) throw new Error('Bundle already registered or active: ' + name);
        for (const source of this.sources.values()) if (source.source === descriptor.source) throw new Error('One bundle source cannot have multiple aliases');
        this.sources.set(name, Object.freeze({ ...descriptor }));
    }
    static unregister(name: string): void {
        if (this.pending.has(name) || this.getLoadedBundle(name)) throw new Error('Release bundle before changing its source');
        const known = this.known.get(name);
        if (known && (assetManager.getBundle(known.name) === known || Array.from(this.resolved.values()).includes(known)))
            throw new Error('Bundle is still active through another alias');
        this.known.delete(name); this.sources.delete(name);
    }
    static loadBundle(name: string): Promise<AssetManager.Bundle> {
        if (name === 'resources') return Promise.resolve(resources);
        const loaded = this.getLoadedBundle(name);
        if (loaded) { this.resolved.set(name, loaded); if (this.sources.has(name)) this.known.set(name, loaded); return Promise.resolve(loaded); }
        const existing = this.pending.get(name);
        if (existing) return existing;
        const task = new Promise<AssetManager.Bundle>((resolve, reject) => {
            const descriptor = this.sources.get(name);
            const done = (error: Error | null, bundle: AssetManager.Bundle) => {
                if (error) reject(error); else { this.resolved.set(name, bundle); if (descriptor) this.known.set(name, bundle); resolve(bundle); }
            };
            if (descriptor) assetManager.loadBundle(descriptor.source, { version: descriptor.version,
                xhrTimeout: descriptor.timeoutMs ?? 15000, maxRetryCount: descriptor.retries ?? 0 }, done);
            else assetManager.loadBundle(name, done);
        });
        this.pending.set(name, task);
        void task.then(() => this.pending.delete(name), () => this.pending.delete(name));
        return task;
    }
    static isBundleLoading(name: string): boolean { return this.pending.has(name); }
    static getLoadedBundle(name: string): AssetManager.Bundle | undefined { return this.resolved.get(name) ?? assetManager.getBundle(name) ?? undefined; }
    static waitForBundle(name: string, options: OperationOptions = {}): Promise<AssetManager.Bundle> {
        return asyncOperation<AssetManager.Bundle>((resolve, reject) => { void this.loadBundle(name).then(resolve, reject); }, options);
    }
    static releaseBundle(name: string): void {
        if (name === 'resources') return;
        if (this.pending.has(name)) throw new Error('Bundle still loading: ' + name);
        const bundle = this.getLoadedBundle(name);
        // Another logical name may resolve to the same engine Bundle. Dropping one
        // alias must not unload resources still held through the other name.
        if (bundle && !Array.from(this.resolved.entries()).some(([alias, other]) => alias !== name && other === bundle)) assetManager.removeBundle(bundle);
        this.resolved.delete(name);
    }
}
