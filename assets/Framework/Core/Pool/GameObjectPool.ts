import { Node, Prefab, Component, instantiate, isValid } from 'cc';
import type { IRenderAdapter } from './IRenderAdapter';
import type { IPoolObject } from './IPoolObject';
export enum RenderType { Sprite2D, Mesh3D }
type Pool = { prefab: Prefab; idle: Node[]; active: Set<Node>; capacity: number; adapter?: IRenderAdapter; closed: boolean; released: boolean; cleaning: number };
type Member = { pool: Pool; checkedOut: boolean };
export class GameObjectPool {
    private static instance = new GameObjectPool();
    static get Instance(): GameObjectPool { return this.instance; }
    private pools = new Map<string, Pool>();
    private members = new WeakMap<Node, Member>();
    registerPrefab(key: string, prefab: Prefab, options: { capacity?: number; adapter?: IRenderAdapter } = {}): void {
        if (this.pools.has(key)) throw new Error('Duplicate pool: ' + key);
        const capacity = options.capacity ?? 32;
        if (!Number.isInteger(capacity) || capacity < 0) throw new Error('Invalid pool capacity');
        prefab.addRef(); this.pools.set(key, { prefab, idle: [], active: new Set(), capacity, adapter: options.adapter, closed: false, released: false, cleaning: 0 });
    }
    private callbacks(node: Node): IPoolObject[] {
        return node.getComponentsInChildren(Component).filter(component => {
            const candidate = component as Component & IPoolObject;
            return typeof candidate.onSpawn === 'function' || typeof candidate.onRecycle === 'function';
        }) as Array<Component & IPoolObject>;
    }
    spawn(key: string, data?: unknown): Node {
        const pool = this.pools.get(key);
        if (!pool || pool.closed) throw new Error('Unknown pool: ' + key);
        let node = pool.idle.pop();
        while (node && !isValid(node)) node = pool.idle.pop();
        if (!node) { node = instantiate(pool.prefab); this.members.set(node, { pool, checkedOut: false }); }
        const member = this.members.get(node)!; member.checkedOut = true; pool.active.add(node);
        node.active = false;
        try {
            pool.adapter?.resetInstance(node);
            for (const callback of this.callbacks(node)) callback.onSpawn?.(data);
            node.active = true; return node;
        } catch (error) {
            try { this.recycleNode(node, true); } catch (cleanup) {
                throw Object.assign(new Error('Pool spawn and rollback failed'), { causes: [error, cleanup] });
            }
            throw error;
        }
    }
    recycle(node: Node): void { this.recycleNode(node, false); }
    private recycleNode(node: Node, discard: boolean): void {
        const member = this.members.get(node);
        if (!member || !member.checkedOut) throw new Error('Unknown or already recycled node');
        member.checkedOut = false; const pool = member.pool; pool.active.delete(node);
        const errors: unknown[] = [];
        pool.cleaning++;
        try {
            if (isValid(node)) {
                try {
                    for (const callback of this.callbacks(node)) try { callback.onRecycle?.(); } catch (error) { errors.push(error); }
                } catch (error) { errors.push(error); }
                try { node.active = false; } catch (error) { errors.push(error); }
                try { node.removeFromParent(); } catch (error) { errors.push(error); }
                if (!discard && !pool.closed && !errors.length && isValid(node) && pool.idle.length < pool.capacity) pool.idle.push(node);
                else this.destroyNode(pool, node, errors);
            } else this.members.delete(node);
        } finally {
            pool.cleaning--;
            try { this.finish(pool); } catch (error) { errors.push(error); }
        }
        if (errors.length) { const error = new Error('Pool cleanup failed'); Object.assign(error, { causes: errors }); throw error; }
    }
    clear(key: string): void {
        const pool = this.pools.get(key); if (!pool) return;
        this.pools.delete(key); pool.closed = true;
        const errors: unknown[] = [];
        pool.cleaning++;
        try {
            for (const node of pool.idle.splice(0)) this.destroyNode(pool, node, errors);
            for (const node of Array.from(pool.active)) try { this.recycle(node); } catch (error) { errors.push(error); }
        } finally {
            pool.cleaning--;
            try { this.finish(pool); } catch (error) { errors.push(error); }
        }
        if (errors.length) throw Object.assign(new Error('Pool clear failed'), { causes: errors });
    }
    private destroyNode(pool: Pool, node: Node, errors: unknown[]): void {
        this.members.delete(node);
        if (!isValid(node)) return;
        try { node.active = false; } catch (error) { errors.push(error); }
        try { node.removeFromParent(); } catch (error) { errors.push(error); }
        try { pool.adapter?.disposeInstance(node); } catch (error) { errors.push(error); }
        // Renderer cleanup errors must not skip the engine destruction request.
        try { node.destroy(); } catch (error) { errors.push(error); }
    }
    private finish(pool: Pool): void {
        if (pool.closed && !pool.active.size && !pool.idle.length && !pool.cleaning && !pool.released) {
            pool.released = true; pool.prefab.decRef();
        }
    }
    clearAll(): void {
        const errors: unknown[] = [];
        for (const key of Array.from(this.pools.keys())) try { this.clear(key); } catch (error) { errors.push(error); }
        if (errors.length) throw Object.assign(new Error('Pool collection cleanup failed'), { causes: errors });
    }
    getDebugInfo(): { pools: number; idle: number; active: number } {
        let idle = 0, active = 0; for (const pool of this.pools.values()) { idle += pool.idle.length; active += pool.active.size; }
        return { pools: this.pools.size, idle, active };
    }
}
