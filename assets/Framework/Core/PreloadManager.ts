import { LifecycleScope } from '../Kernel/LifecycleScope';
import type { PreloadItem, PreloadReport } from './PreloadConfigTypes';
import { ResManager } from './ResManager';
/** Preloads are owned by the caller; releasing the returned batch disposes every handle. */
export class PreloadManager {
    private static instance = new PreloadManager();
    static get Instance(): PreloadManager { return this.instance; }
    async load(items: readonly PreloadItem[], scope: LifecycleScope,
        onProgress?: (done: number, total: number) => void): Promise<PreloadReport> {
        const ids = new Set<string>();
        for (const item of items) { if (ids.has(item.id)) throw new Error('Duplicate preload ID'); ids.add(item.id); }
        const batch = scope.child();
        const report: PreloadReport = { completed: [], failed: [] };
        let done = 0;
        await Promise.all(items.map(async item => {
            try {
                await ResManager.Instance.acquire(item.path, item.type, { bundle: item.bundle, scope: batch, timeoutMs: 15000 });
                report.completed.push(item.id);
            } catch (error) { report.failed.push({ id: item.id, error }); }
            finally { done++; try { onProgress?.(done, items.length); } catch (error) { report.failed.push({ id: '@progress', error }); } }
        }));
        if (!batch.isActive || report.failed.some(failure => items.find(item => item.id === failure.id)?.critical !== false)) {
            batch.dispose(); throw Object.assign(new Error('Preload batch incomplete'), { report });
        }
        return report;
    }
}
