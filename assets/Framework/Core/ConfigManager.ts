import { JsonAsset } from 'cc';
import { ResManager } from './ResManager';
import type { ResourceHandle } from '../Kernel/ResourceCache';
import { LifecycleScope } from '../Kernel/LifecycleScope';
import { rollbackCleanups, runCleanups } from '../Kernel/Contracts';
type Table = { index: Map<string | number, unknown>; handle: ResourceHandle<JsonAsset>; scope: LifecycleScope };
export class ConfigManager {
    private static instance = new ConfigManager();
    static get Instance(): ConfigManager { return this.instance; }
    private tables = new Map<string, Table>();
    private loading = new Map<string, { task: Promise<void>; scope: LifecycleScope }>();
    init(): void {}
    private key(name: string, bundle = 'resources'): string { return JSON.stringify([bundle, name]); }
    loadTables(names: string[], bundle = 'resources'): Promise<void[]> { return Promise.all(names.map(name => this.loadTable(name, bundle))); }
    loadTable(name: string, bundle = 'resources'): Promise<void> {
        const key = this.key(name, bundle);
        if (this.tables.has(key)) return Promise.resolve();
        const pending = this.loading.get(key);
        if (pending) return pending.task;
        const scope = new LifecycleScope();
        const task = this.build(key, name, bundle, scope);
        this.loading.set(key, { task, scope });
        const finish = () => { if (this.loading.get(key)?.task === task) this.loading.delete(key); };
        void task.then(finish, finish); return task;
    }
    private async build(key: string, name: string, bundle: string, scope: LifecycleScope): Promise<void> {
        let handle: ResourceHandle<JsonAsset> | undefined;
        try {
            handle = await ResManager.Instance.acquire(name, JsonAsset, { bundle, timeoutMs: 15000, scope });
            scope.assertActive();
            const data: unknown = handle.value.json;
            const index = new Map<string | number, unknown>();
            const rows = Array.isArray(data) ? data.map((row: unknown, i) => {
                const id = row && typeof row === 'object' && 'id' in row ? (row as { id: unknown }).id : i;
                if (typeof id !== 'string' && typeof id !== 'number') throw new Error('Invalid config row ID');
                return [id, row] as const;
            }) : data && typeof data === 'object' ? Object.entries(data) : null;
            if (!rows) throw new Error('Config must be an array or record');
            for (let i = 0; i < rows.length; i++) {
                const [id, row] = rows[i];
                if (index.has(id)) throw new Error('Duplicate config row: ' + id);
                index.set(id, row);
                if (i && i % 500 === 0) { await new Promise<void>(resolve => setTimeout(resolve, 0)); scope.assertActive(); }
            }
            scope.assertActive(); this.tables.set(key, { index, handle, scope });
        } catch (error) {
            rollbackCleanups(error, 'Config loading rollback failed', [() => handle?.release(), () => scope.dispose()]);
        }
    }
    query<T>(name: string, id: string | number, bundle = 'resources'): T | undefined { return this.tables.get(this.key(name, bundle))?.index.get(id) as T | undefined; }
    getAll<T>(name: string, bundle = 'resources'): readonly T[] { return Array.from(this.tables.get(this.key(name, bundle))?.index.values() ?? []) as T[]; }
    unloadTable(name: string, bundle = 'resources'): void {
        const key = this.key(name, bundle), pending = this.loading.get(key), table = this.tables.get(key);
        this.loading.delete(key); this.tables.delete(key);
        runCleanups('Config table cleanup failed', [
            () => pending?.scope.dispose(), () => table?.scope.dispose(), () => table?.handle.release(),
        ]);
    }
    dispose(): void {
        const pending = Array.from(this.loading.values()), tables = Array.from(this.tables.values());
        this.loading.clear(); this.tables.clear();
        runCleanups('Config collection cleanup failed', [
            ...pending.map(item => () => item.scope.dispose()),
            ...tables.flatMap(table => [() => table.scope.dispose(), () => table.handle.release()]),
        ]);
    }
}
