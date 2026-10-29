import { EventBus } from '../Kernel/EventBus';
import type { Dispose } from '../Kernel/Contracts';
import type { EventPayloadMap } from '../Core/GameConst';
/** Framework notification facade. Games create their own EventBus<GameEvents>. */
export class EventCenter {
    private static bus = new EventBus<EventPayloadMap>();
    private static subscriptions = new Map<keyof EventPayloadMap, Map<unknown, Dispose>>();
    static init(): void { this.clear(); }
    static on<K extends keyof EventPayloadMap>(key: K, callback: (value: EventPayloadMap[K]) => void): Dispose {
        this.off(key, callback);
        const cancel = this.bus.on(key, callback);
        const list = this.subscriptions.get(key) ?? new Map<unknown, Dispose>();
        list.set(callback, cancel); this.subscriptions.set(key, list);
        return () => this.off(key, callback);
    }
    static once<K extends keyof EventPayloadMap>(key: K, callback: (value: EventPayloadMap[K]) => void): Dispose {
        this.off(key, callback);
        const cancel = this.bus.once(key, value => { this.off(key, callback); callback(value); });
        const list = this.subscriptions.get(key) ?? new Map<unknown, Dispose>();
        list.set(callback, cancel); this.subscriptions.set(key, list);
        return () => this.off(key, callback);
    }
    static off<K extends keyof EventPayloadMap>(key: K, callback: (value: EventPayloadMap[K]) => void): void {
        const list = this.subscriptions.get(key);
        list?.get(callback)?.(); list?.delete(callback);
        if (!list?.size) this.subscriptions.delete(key);
    }
    static emit<K extends keyof EventPayloadMap>(key: K, value: EventPayloadMap[K]): void { this.bus.emit(key, value); }
    static clear(): void { this.bus.clear(); this.subscriptions.clear(); }
}
