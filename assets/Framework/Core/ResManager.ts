import { Asset } from 'cc';
import { ResourceCache, ResourceCanceledError } from '../Kernel/ResourceCache';
import type { ResourceHandle } from '../Kernel/ResourceCache';
import { LifecycleScope } from '../Kernel/LifecycleScope';
import { BundleManager } from './BundleManager';
import { rollbackCleanups } from '../Kernel/Contracts';
export { ResourceCanceledError };
export type AssetType<T extends Asset> = new () => T;
type Descriptor = { path: string; bundle: string; type: AssetType<Asset> };
type Loaded = { asset: Asset; key: string; bundle: string };
export class ResManager {
    private static instance = new ResManager();
    static get Instance(): ResManager { return this.instance; }
    private cache?: ResourceCache<Loaded>;
    private descriptors = new Map<string, Descriptor>();
    private types = new Map<AssetType<Asset>, number>();
    private bundles = new Map<string, number>();
    private failure?: unknown;
    /** Includes late failures from disposed cache generations; not an active-state flag. */
    get lastError(): unknown { return this.failure; }
    init(options: { concurrency?: number; maxIdle?: number } = {}): void {
        if (this.cache) return;
        // A disposed cache may still finish physical loads. Capture its own map so
        // late success/failure cannot delete descriptors belonging to a new cache.
        const descriptors = new Map<string, Descriptor>();
        this.descriptors = descriptors;
        this.types = new Map<AssetType<Asset>, number>();
        this.cache = new ResourceCache<Loaded>({
            load: async key => {
                const info = descriptors.get(key);
                if (!info) throw new Error('Unknown resource: ' + key);
                this.bundles.set(info.bundle, (this.bundles.get(info.bundle) ?? 0) + 1);
                try {
                    const bundle = await BundleManager.loadBundle(info.bundle);
                    const asset = await new Promise<Asset>((resolve, reject) =>
                        bundle.load(info.path, info.type, (error, result) => error ? reject(error) : resolve(result)));
                    return { asset, key, bundle: info.bundle };
                } catch (error) {
                    this.dropBundle(info.bundle); descriptors.delete(key); throw error;
                }
            },
            retain: loaded => {
                const references = loaded.asset.refCount;
                try { loaded.asset.addRef(); }
                catch (error) {
                    // 中文注释：Cocos适配器负责撤回addRef的部分副作用，
                    // 纯缓存不能猜测外部driver是否已经取得所有权。
                    rollbackCleanups(error, 'Asset retain rollback failed', [
                        () => { if (loaded.asset.refCount > references) loaded.asset.decRef(); },
                        () => { descriptors.delete(loaded.key); this.dropBundle(loaded.bundle); },
                    ]);
                }
            },
            release: loaded => {
                descriptors.delete(loaded.key);
                try { loaded.asset.decRef(); } finally { this.dropBundle(loaded.bundle); }
            },
            onError: error => { this.failure = error; },
        }, options.concurrency ?? 4, options.maxIdle ?? 16);
    }
    private dropBundle(name: string): void {
        const count = (this.bundles.get(name) ?? 1) - 1;
        if (count > 0) this.bundles.set(name, count); else this.bundles.delete(name);
    }
    async acquire<T extends Asset>(path: string, type: AssetType<T>, options: {
        bundle?: string; scope?: LifecycleScope; timeoutMs?: number;
    } = {}): Promise<ResourceHandle<T>> {
        if (options.scope && !options.scope.isActive) throw new ResourceCanceledError('Resource scope closed');
        if (!this.cache) this.init();
        if (!path || path.startsWith('/') || path.includes('..')) throw new Error('Invalid bundle resource path');
        const bundle = options.bundle ?? 'resources';
        const ctor = type as AssetType<Asset>;
        if (!this.types.has(ctor)) this.types.set(ctor, this.types.size + 1);
        const key = JSON.stringify([bundle, path, this.types.get(ctor)]);
        this.descriptors.set(key, { path, bundle, type: ctor });
        const handle = await this.cache!.acquire(key, options);
        return { value: handle.value.asset as T, get released() { return handle.released; }, release: () => handle.release() };
    }
    async loadBundle(name: string): Promise<import('cc').AssetManager.Bundle> { return BundleManager.loadBundle(name); }
    releaseBundle(name: string): boolean {
        this.cache?.clearIdle();
        if (this.bundles.has(name) || BundleManager.isBundleLoading(name)) return false;
        BundleManager.releaseBundle(name); return true;
    }
    clearExpiredLRU(): void { this.cache?.clearIdle(); }
    getDebugInfo(): { entries: number; owners: number; loading: number; queued: number; peakConcurrency: number } {
        return this.cache?.stats() ?? { entries: 0, owners: 0, loading: 0, queued: 0, peakConcurrency: 0 };
    }
    dispose(): void {
        if (this.cache && this.cache.stats().owners > 0) throw new Error('Resources still owned; close scopes first');
        try { this.cache?.dispose(); }
        finally { this.cache = undefined; this.descriptors.clear(); this.types.clear(); }
    }
}
