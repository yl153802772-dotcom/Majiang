import { Vec3 } from 'cc';
import { runCleanups } from '../../Kernel/Contracts';
export class SequenceContext {
    readonly center: Vec3;
    private canceled = false;
    private listeners = new Set<() => void>();
    payload: unknown;
    constructor(center: Vec3) { this.center = center.clone(); }
    get isCanceled(): boolean { return this.canceled; }
    onCancel(callback: () => void): () => void {
        if (this.canceled) { callback(); return () => {}; }
        this.listeners.add(callback); return () => { this.listeners.delete(callback); };
    }
    cancel(): void {
        if (this.canceled) return;
        this.canceled = true;
        const callbacks = Array.from(this.listeners); this.listeners.clear();
        runCleanups('Sequence cancellation failed', callbacks);
    }
    setPayload(data: unknown): void { this.payload = data; }
    getPayload<T>(): T { return this.payload as T; }
    updateCenter(position: Vec3): void { this.center.set(position); }
}
