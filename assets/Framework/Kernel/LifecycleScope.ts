import { FrameworkError } from './Contracts';
import type { Dispose } from './Contracts';
/** A scope is one-shot. Create a new scope for each activation or pooled spawn. */
export class LifecycleScope {
    private cleanups = new Set<Dispose>();
    private closed = false;
    get isActive(): boolean { return !this.closed; }
    get size(): number { return this.cleanups.size; }
    add(cleanup: Dispose): Dispose {
        if (this.closed) { cleanup(); return () => {}; }
        let active = true;
        const once = () => {
            if (!active) return;
            active = false;
            this.cleanups.delete(once);
            cleanup();
        };
        this.cleanups.add(once);
        return once;
    }
    /** Stop tracking without invoking the cleanup (e.g. a completed request). */
    track(cleanup: Dispose): Dispose {
        if (this.closed) { cleanup(); return () => {}; }
        this.cleanups.add(cleanup);
        return () => { this.cleanups.delete(cleanup); };
    }
    child(): LifecycleScope {
        const child = new LifecycleScope();
        const detach = this.track(() => child.dispose());
        child.track(detach);
        return child;
    }
    assertActive(): void { if (this.closed) throw new Error('Scope disposed'); }
    /** Synchronous construction failed: unwind acquired owners, preserving both failures. */
    rollback(cause: unknown): never {
        try { this.dispose(); }
        catch (cleanupError) { throw new FrameworkError('Construction rollback failed', [cause, cleanupError]); }
        throw cause;
    }
    dispose(): void {
        if (this.closed) return;
        this.closed = true;
        const errors: unknown[] = [];
        for (const cleanup of Array.from(this.cleanups).reverse()) {
            this.cleanups.delete(cleanup);
            try { cleanup(); } catch (error) { errors.push(error); }
        }
        if (errors.length) {
            const error = new Error('Scope cleanup failed');
            Object.assign(error, { causes: errors });
            throw error;
        }
    }
}
