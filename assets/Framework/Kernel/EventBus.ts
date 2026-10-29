import type { Dispose } from './Contracts';
type Listener = { invoke: (value: unknown) => void; active: boolean; once: boolean };
/** Synchronous, ordered notifications. Listener errors are reported after all listeners run. */
export class EventBus<Events extends object> {
    private listeners = new Map<keyof Events, Listener[]>();
    constructor(private readonly onError?: (errors: readonly unknown[]) => void) {}
    on<K extends keyof Events>(key: K, callback: (value: Events[K]) => void): Dispose {
        return this.subscribe(key, callback, false);
    }
    once<K extends keyof Events>(key: K, callback: (value: Events[K]) => void): Dispose {
        return this.subscribe(key, callback, true);
    }
    private subscribe<K extends keyof Events>(key: K, callback: (value: Events[K]) => void, once: boolean): Dispose {
        const item: Listener = { invoke: callback as (value: unknown) => void, active: true, once };
        const list = this.listeners.get(key) ?? [];
        list.push(item);
        this.listeners.set(key, list);
        return () => this.remove(key, item);
    }
    private remove(key: keyof Events, item: Listener): void {
        if (!item.active) return;
        item.active = false;
        const list = this.listeners.get(key);
        if (!list) return;
        const i = list.indexOf(item);
        if (i >= 0) list.splice(i, 1);
        if (!list.length) this.listeners.delete(key);
    }
    emit<K extends keyof Events>(key: K, ...args: Events[K] extends void ? [value?: Events[K]] : [value: Events[K]]): void {
        const errors: unknown[] = [];
        for (const item of [...(this.listeners.get(key) ?? [])]) {
            if (!item.active) continue;
            if (item.once) this.remove(key, item);
            try { item.invoke(args[0]); } catch (error) { errors.push(error); }
        }
        if (errors.length) {
            if (this.onError) this.onError(errors);
            else {
                const error = new Error('Event listeners failed: ' + String(key));
                Object.assign(error, { causes: errors });
                throw error;
            }
        }
    }
    count(key?: keyof Events): number {
        return key === undefined ? Array.from(this.listeners.values()).reduce((n, list) => n + list.length, 0)
            : (this.listeners.get(key)?.length ?? 0);
    }
    clear(): void {
        for (const list of this.listeners.values()) for (const item of list) item.active = false;
        this.listeners.clear();
    }
}
