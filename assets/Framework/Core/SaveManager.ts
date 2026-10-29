import { StorageStore } from '../Kernel/StorageStore';
import { PlatformManager } from './Platform/PlatformManager';
/** Optional persistence. Project must provide a unique namespace and explicitly flush. */
export class SaveManager {
    private static instance = new SaveManager();
    static get Instance(): SaveManager { return this.instance; }
    private store?: StorageStore;
    async init(namespace: string): Promise<void> {
        if (this.store) throw new Error('SaveManager already initialized');
        const store = new StorageStore(PlatformManager.Instance.adapter, namespace);
        await store.init(); this.store = store;
    }
    private requireStore(): StorageStore { if (!this.store) throw new Error('Persistence not configured'); return this.store; }
    get<T>(key: string, fallback: T): T { return this.requireStore().get(key, fallback); }
    set(key: string, value: unknown): void { this.requireStore().set(key, value); }
    remove(key: string): void { this.requireStore().remove(key); }
    saveToDisk(): Promise<void> { return this.requireStore().flush(); }
    async dispose(): Promise<void> { if (this.store) { await this.store.flush(); this.store = undefined; } }
}
