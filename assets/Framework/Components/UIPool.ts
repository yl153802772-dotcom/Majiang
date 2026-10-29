import { Node, isValid } from 'cc';
import { runCleanups } from '../Kernel/Contracts';
/** Optional low-level UI node cache; UIManager owns its own asset handles and does not use this cache. */
export class UIPool {
    private static instance = new UIPool();
    static get Instance(): UIPool { return this.instance; }
    private pools = new Map<string, Node[]>();
    private retained = new WeakSet<Node>();
    constructor(private capacity = 4) {}
    get(name: string): Node | null {
        const pool = this.pools.get(name);
        let node = pool?.pop();
        while (node && !isValid(node)) node = pool?.pop();
        if (!node) return null;
        this.retained.delete(node); return node;
    }
    recycle(name: string, node: Node): void {
        if (!isValid(node)) return;
        if (this.retained.has(node)) throw new Error('Duplicate UI recycle');
        node.active = false; node.removeFromParent();
        const pool = this.pools.get(name) ?? [];
        if (pool.length >= this.capacity) { node.destroy(); return; }
        pool.push(node); this.retained.add(node); this.pools.set(name, pool);
    }
    clear(name?: string): void {
        const cleanups: Array<() => void> = [];
        for (const [key, pool] of this.pools) if (name === undefined || key === name) {
            this.pools.delete(key);
            for (const node of pool) {
                this.retained.delete(node);
                cleanups.push(() => { if (isValid(node)) node.destroy(); });
            }
        }
        runCleanups('UI pool cleanup failed', cleanups);
    }
}
