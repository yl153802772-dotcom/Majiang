import { TaskScheduler } from '../../Kernel/TaskScheduler';
import { PauseController } from '../../Kernel/PauseController';
export enum TimerGroup { GAME = 'game', UI = 'ui' }
export class TimerManager {
    private static instance = new TimerManager();
    static get Instance(): TimerManager { return this.instance; }
    readonly priority = 1000;
    private clock = new TaskScheduler();
    private owners = new Map<number, { target: unknown; tween: boolean }>();
    private groups = new Map<TimerGroup, { paused: boolean; scale: number }>();
    private pauses = new Map<TimerGroup, PauseController>();
    init(): void {}
    get timeScale(): number { return this.clock.timeScale; }
    set timeScale(value: number) { this.clock.timeScale = value; }
    get isPaused(): boolean { return this.clock.paused; }
    set isPaused(value: boolean) { this.clock.paused = value; }
    setGroupPaused(group: TimerGroup, paused: boolean): void {
        this.setPauseReason(group, 'legacy', paused);
    }
    private pauseController(group: TimerGroup): PauseController {
        let controller = this.pauses.get(group);
        if (!controller) {
            controller = new PauseController(); this.pauses.set(group, controller);
            controller.subscribe(state => this.applyPause(group, state.paused));
        }
        return controller;
    }
    setPauseReason(group: TimerGroup, reason: string, paused: boolean): void { this.pauseController(group).set(reason, paused); }
    holdPause(reason: string, group = TimerGroup.GAME): () => void { return this.pauseController(group).hold(reason); }
    getPauseReasons(group = TimerGroup.GAME): readonly string[] { return this.pauses.get(group)?.snapshot.reasons ?? []; }
    private applyPause(group: TimerGroup, paused: boolean): void {
        const options = this.groups.get(group) ?? { paused: false, scale: 1 };
        options.paused = paused; this.groups.set(group, options); this.clock.setGroup(group, paused, options.scale);
    }
    setGroupTimeScale(group: TimerGroup, scale: number): void {
        const options = this.groups.get(group) ?? { paused: false, scale: 1 };
        this.clock.setGroup(group, options.paused, scale); options.scale = scale; this.groups.set(group, options);
    }
    update(dt: number): void { this.clock.tick(dt); }
    private add(delay: number, repeat: number, callback: (dt: number) => void, target: unknown, group: TimerGroup, tween: boolean): number {
        let id = 0;
        id = this.clock.add(delay, dt => {
            if (repeat === 1) this.owners.delete(id);
            try { callback.call(target, dt); } catch (error) { this.owners.delete(id); throw error; }
        }, { repeat, group });
        this.owners.set(id, { target, tween }); return id;
    }
    doOnce(delay: number, callback: (dt: number) => void, target?: unknown, group = TimerGroup.GAME): number {
        return this.add(delay, 1, callback, target, group, false);
    }
    doLoop(delay: number, repeat: number, callback: (dt: number) => void, target?: unknown, group = TimerGroup.GAME): number {
        let remaining = repeat;
        let id = 0;
        id = this.add(delay, repeat, dt => { try { callback.call(target, dt); } finally { if (repeat > 0 && --remaining <= 0) this.owners.delete(id); } }, target, group, false);
        return id;
    }
    addTweenTask(callback: (dt: number) => void, target: unknown, group: TimerGroup): number { return this.add(0, 0, callback, target, group, true); }
    remove(id: number): void { this.clock.remove(id); this.owners.delete(id); }
    removeByTarget(target: unknown): void { for (const [id, owner] of this.owners) if (owner.target === target) this.remove(id); }
    removeTweensByTarget(target: unknown): void { for (const [id, owner] of this.owners) if (owner.target === target && owner.tween) this.remove(id); }
    getDebugInfo(): { tasks: number } { return { tasks: this.clock.size }; }
    dispose(): void { for (const pause of this.pauses.values()) pause.dispose(); this.pauses.clear(); this.clock.clear(); this.owners.clear(); this.groups.clear(); }
}
