import { game, Game } from 'cc';
import { LifecycleScope } from '../Kernel/LifecycleScope';
import { PauseController } from '../Kernel/PauseController';
import { FrameworkError, runCleanups } from '../Kernel/Contracts';
import { TimerManager } from './TimerTool/TimerManager';
import { AudioSystem } from './AudioSystem';
export interface RuntimeLifecycleOptions {
    readonly pauses?: PauseController;
    readonly audio?: AudioSystem;
    readonly flush?: () => Promise<void>;
    readonly onError?: (error: unknown) => void;
}
/** Optional module: background/menu/ad pause reasons compose; persistence requires an explicitly supplied flush. */
export class RuntimeLifecycle {
    readonly dependencies = ['timers'];
    readonly pauses: PauseController;
    private scope?: LifecycleScope;
    private releaseTimer?: () => void;
    private flushing?: Promise<void>;
    private failure?: unknown;
    private background = false;
    private stopping?: Promise<void>;
    get lastError(): unknown { return this.failure; }
    constructor(private readonly options: RuntimeLifecycleOptions = {}) { this.pauses = options.pauses ?? new PauseController(); }
    init(): void {
        if (this.scope || this.stopping) throw new Error('Runtime lifecycle already initialized or disposed');
        const scope = this.scope = new LifecycleScope();
        try {
            scope.add(() => game.off(Game.EVENT_HIDE, this.hide, this)); game.on(Game.EVENT_HIDE, this.hide, this);
            scope.add(() => game.off(Game.EVENT_SHOW, this.show, this)); game.on(Game.EVENT_SHOW, this.show, this);
            scope.add(this.pauses.subscribe(() => this.apply()));
            scope.add(() => this.options.audio?.setSuspended(false));
            scope.add(() => { this.releaseTimer?.(); this.releaseTimer = undefined; });
            this.apply();
        } catch (error) { this.scope = undefined; scope.rollback(error); }
    }
    private apply(): void {
        if (this.pauses.isPaused) this.releaseTimer ??= TimerManager.Instance.holdPause('runtime');
        else { const release = this.releaseTimer; this.releaseTimer = undefined; release?.(); }
        this.options.audio?.setSuspended(this.pauses.isPaused);
    }
    setBackground(hidden: boolean): void {
        if (!this.scope?.isActive) return;
        const changed = this.background !== hidden; this.background = hidden;
        try { this.pauses.set('background', hidden); }
        finally { if (hidden && changed) void this.flush().catch(error => this.report(error)); }
    }
    private hide(): void { try { this.setBackground(true); } catch (error) { this.report(error); } }
    private show(): void { try { this.setBackground(false); } catch (error) { this.report(error); } }
    flush(): Promise<void> {
        if (this.flushing) return this.flushing;
        if (!this.options.flush) return Promise.resolve();
        const task = Promise.resolve().then(this.options.flush);
        this.flushing = task;
        const done = () => { if (this.flushing === task) this.flushing = undefined; };
        void task.then(done, done); return task;
    }
    private report(error: unknown): void {
        this.failure = error;
        try { this.options.onError?.(error); } catch (reporting) { this.failure = new FrameworkError('Lifecycle reporting failed', [error, reporting]); }
    }
    dispose(): Promise<void> { return this.stopping ??= this.finishDispose(); }
    private async finishDispose(): Promise<void> {
        const scope = this.scope; this.scope = undefined;
        let failure: unknown;
        try { runCleanups('Lifecycle cleanup failed', [() => scope?.dispose(), () => this.options.audio?.setSuspended(false), () => this.pauses.set('background', false)]); }
        catch (error) { failure = error; }
        try { await this.flush(); } catch (error) { failure = failure ? new FrameworkError('Lifecycle exit failed', [failure, error]) : error; }
        if (!this.options.pauses) this.pauses.dispose();
        if (failure) { this.report(failure); throw failure; }
    }
}
