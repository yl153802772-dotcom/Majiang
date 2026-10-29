import type { Dispose } from './Contracts';
import { rollbackCleanups, runCleanups } from './Contracts';
export interface PauseSnapshot { readonly paused: boolean; readonly reasons: readonly string[]; }
/** 中文注释：具名开关与独立租约分开计数，关闭帮助页不能撤掉后台或其他弹窗的暂停。 */
export class PauseController {
    private flags = new Set<string>();
    private leases = new Map<symbol, string>();
    private listeners = new Set<(state: PauseSnapshot) => void>();
    private closed = false;
    get snapshot(): PauseSnapshot {
        return Object.freeze({ paused: this.flags.size + this.leases.size > 0,
            reasons: Object.freeze(Array.from(new Set([...Array.from(this.flags), ...Array.from(this.leases.values())])).sort()) });
    }
    get isPaused(): boolean { return this.flags.size + this.leases.size > 0; }
    private validate(reason: string): void { if (!reason.trim() || reason.length > 128) throw new Error('Invalid pause reason'); }
    set(reason: string, paused: boolean): void {
        if (this.closed) throw new Error('Pause controller disposed');
        this.validate(reason);
        if (this.flags.has(reason) === paused) return;
        if (paused) this.flags.add(reason); else this.flags.delete(reason);
        this.notify();
    }
    hold(reason: string): Dispose {
        if (this.closed) throw new Error('Pause controller disposed');
        this.validate(reason); const key = Symbol(reason); this.leases.set(key, reason);
        // A failing observer must not leave an unreachable lease.
        try { this.notify(); } catch (error) { this.leases.delete(key); rollbackCleanups(error, 'Pause lease rollback failed', [() => this.notify()]); }
        return () => { if (!this.leases.delete(key) || this.closed) return; this.notify(); };
    }
    subscribe(listener: (state: PauseSnapshot) => void): Dispose {
        if (this.closed) throw new Error('Pause controller disposed');
        this.listeners.add(listener); return () => { this.listeners.delete(listener); };
    }
    private notify(): void {
        const state = this.snapshot;
        runCleanups('Pause observers failed', Array.from(this.listeners).map(listener => () => { if (this.listeners.has(listener)) listener(state); }));
    }
    dispose(): void { this.closed = true; this.listeners.clear(); this.flags.clear(); this.leases.clear(); }
}
