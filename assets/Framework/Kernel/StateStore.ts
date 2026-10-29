import type { Dispose } from './Contracts';
type Watch<T> = (value: T, previous: T | undefined) => void;
export class StateStore<Schema extends object = Record<string, unknown>> {
    private values = new Map<keyof Schema, unknown>();
    private watchers = new Map<keyof Schema, Set<Watch<unknown>>>();
    get<K extends keyof Schema>(key: K): Schema[K] | undefined { return this.values.get(key) as Schema[K] | undefined; }
    set<K extends keyof Schema>(key: K, value: Schema[K]): void {
        const previous = this.get(key);
        if (Object.is(value, previous)) return;
        this.values.set(key, value);
        const errors: unknown[] = [];
        for (const callback of Array.from(this.watchers.get(key) ?? []))
            try { callback(value, previous); } catch (error) { errors.push(error); }
        if (errors.length) { const error = new Error('State watchers failed'); Object.assign(error, { causes: errors }); throw error; }
    }
    watch<K extends keyof Schema>(key: K, callback: Watch<Schema[K]>): Dispose {
        const callbacks = this.watchers.get(key) ?? new Set<Watch<unknown>>();
        const listener = callback as Watch<unknown>;
        callbacks.add(listener); this.watchers.set(key, callbacks);
        return () => { callbacks.delete(listener); if (!callbacks.size) this.watchers.delete(key); };
    }
    clear(): void { this.values.clear(); this.watchers.clear(); }
}
