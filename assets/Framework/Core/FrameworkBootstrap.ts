import { _decorator, Component, Node, game, Game, director, JsonAsset } from 'cc';
import { App } from './App';
import { LifecycleScope } from '../Kernel/LifecycleScope';
import { ResManager } from './ResManager';
import { Logger, LogModule } from './Logger';
import { TimerManager, TimerGroup } from './TimerTool/TimerManager';
import { FrameworkError, rollbackCleanups, runCleanups } from '../Kernel/Contracts';
const { ccclass, property } = _decorator;
export type FrameworkStartupState = 'idle' | 'starting' | 'running' | 'failed' | 'destroyed';
@ccclass('FrameworkBootstrap')
export class FrameworkBootstrap extends Component {
    @property(Node) uiRoot: Node | null = null;
    @property(Node) audioRoot: Node | null = null;
    @property runSelfCheck = false;
    private static owner: FrameworkBootstrap | null = null;
    private static shutdownTask: Promise<void> = Promise.resolve();
    private owns = false;
    private ownsApp = false;
    private lifetime = new LifecycleScope();
    private startupTask?: Promise<void>;
    private cleanupTask?: Promise<void>;
    private generation = 0;
    private hidden = false;
    private phase: FrameworkStartupState = 'idle';
    private error?: unknown;
    get startupState(): FrameworkStartupState { return this.phase; }
    get lastError(): unknown { return this.error; }
    protected onLoad(): void {
        if (FrameworkBootstrap.owner) { this.enabled = false; Logger.error(LogModule.APP, 'Duplicate framework driver'); return; }
        FrameworkBootstrap.owner = this; this.owns = true;
        // Engine callbacks cannot await a Promise. retry() remains observable to a
        // project-owned error/retry UI; this catch only terminates the engine entry.
        void this.retry().catch(() => { /* lastError/state retain the reported failure */ });
    }
    retry(): Promise<void> {
        if (!this.owns || this.phase === 'destroyed') return Promise.reject(new Error('Framework driver is not active'));
        if (this.startupTask) return this.startupTask;
        if (this.phase === 'running') return Promise.resolve();
        this.phase = 'starting'; this.error = undefined;
        const task = this.startAttempt(++this.generation);
        this.startupTask = task;
        const clear = () => { if (this.startupTask === task) this.startupTask = undefined; };
        void task.then(clear, clear);
        return task;
    }
    private isCurrent(generation: number): boolean {
        return this.owns && this.phase !== 'destroyed' && this.generation === generation;
    }
    private async startAttempt(generation: number): Promise<void> {
        try {
            // A replacement component must not initialize into a disposing App.
            await FrameworkBootstrap.shutdownTask;
            if (!this.isCurrent(generation)) return;
            const scope = this.lifetime = new LifecycleScope();
            scope.add(() => director.removePersistRootNode(this.node));
            director.addPersistRootNode(this.node);
            scope.add(() => game.off(Game.EVENT_HIDE, this.hide, this));
            game.on(Game.EVENT_HIDE, this.hide, this);
            scope.add(() => game.off(Game.EVENT_SHOW, this.show, this));
            game.on(Game.EVENT_SHOW, this.show, this);
            this.ownsApp = true;
            await App.Instance.init({ uiRoot: this.uiRoot ?? undefined, audioRoot: this.audioRoot ?? undefined });
            if (!this.isCurrent(generation)) return;
            await App.Instance.start();
            if (!this.isCurrent(generation)) return;
            TimerManager.Instance.setPauseReason(TimerGroup.GAME, 'background', this.hidden);
            if (this.runSelfCheck) {
                // Both consumers are scoped even if Promise.all rejects early.
                const [a, b] = await Promise.all([
                    ResManager.Instance.acquire('framework-smoke/config', JsonAsset, { scope, timeoutMs: 10000 }),
                    ResManager.Instance.acquire('framework-smoke/config', JsonAsset, { scope, timeoutMs: 10000 }),
                ]);
                const release = [() => a.release(), () => b.release(), () => ResManager.Instance.clearExpiredLRU()];
                try {
                    if (a.value !== b.value || a.value.json?.framework !== 'generic-v1') throw new Error('Engine resource self-check failed');
                } catch (error) { rollbackCleanups(error, 'Framework self-check rollback failed', release); }
                runCleanups('Framework self-check cleanup failed', release);
                if (!this.isCurrent(generation)) return;
                Logger.info(LogModule.APP, 'Engine resource self-check passed');
            }
            if (!this.isCurrent(generation)) return;
            Logger.info(LogModule.APP, 'Framework ready (Cocos 3.8.8 target)');
            this.phase = 'running';
        } catch (cause) {
            let failure = cause;
            try { await this.cleanupAttempt(); }
            catch (cleanup) { failure = new FrameworkError('Framework startup rollback failed', [cause, cleanup]); }
            if (this.isCurrent(generation)) this.phase = 'failed';
            this.report(failure);
            throw failure;
        }
    }
    private cleanupAttempt(): Promise<void> {
        if (this.cleanupTask) return this.cleanupTask;
        const scope = this.lifetime, ownsApp = this.ownsApp;
        this.ownsApp = false;
        const task = (async () => {
            const errors: unknown[] = [];
            try {
                runCleanups('Framework host cleanup failed', [
                    () => scope.dispose(),
                    () => game.off(Game.EVENT_HIDE, this.hide, this),
                    () => game.off(Game.EVENT_SHOW, this.show, this),
                    () => director.removePersistRootNode(this.node),
                    () => { if (ownsApp) TimerManager.Instance.setPauseReason(TimerGroup.GAME, 'background', false); },
                ]);
            } catch (error) { errors.push(error); }
            try { if (ownsApp) await App.Instance.dispose(); else await Promise.resolve(); }
            catch (error) { errors.push(error); }
            if (errors.length) throw new FrameworkError('Framework cleanup failed', errors);
        })();
        this.cleanupTask = task;
        // Keep the barrier fulfilled even after reported cleanup failures.
        FrameworkBootstrap.shutdownTask = task.then(() => {}, () => {});
        const clear = () => { if (this.cleanupTask === task) this.cleanupTask = undefined; };
        void task.then(clear, clear);
        return task;
    }
    private report(error: unknown): void {
        this.error = error;
        try { Logger.error(LogModule.APP, 'Framework lifecycle failed', error); }
        catch (sinkError) {
            this.error = new FrameworkError('Framework error reporting failed', [error, sinkError]);
            try { console.error(this.error); } catch { /* lastError remains observable */ }
        }
    }
    private hide(): void { this.hidden = true; TimerManager.Instance.setPauseReason(TimerGroup.GAME, 'background', true); }
    private show(): void { this.hidden = false; TimerManager.Instance.setPauseReason(TimerGroup.GAME, 'background', false); }
    protected update(dt: number): void { if (this.owns && this.phase === 'running') App.Instance.update(Math.min(dt, 0.25)); }
    protected onDestroy(): void {
        if (!this.owns) return;
        this.owns = false; ++this.generation; this.phase = 'destroyed';
        if (FrameworkBootstrap.owner === this) FrameworkBootstrap.owner = null;
        void this.cleanupAttempt().catch(error => this.report(error));
    }
}
