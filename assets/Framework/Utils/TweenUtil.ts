import { Node, Vec3, isValid } from 'cc';
import { TimerManager, TimerGroup } from '../Core/TimerTool/TimerManager';
export const TweenGroup = TimerGroup;
export type TweenGroup = TimerGroup;
export class TweenUtil {
    private static running = new Map<number, Node>();
    static pauseGroup(group: TimerGroup): void { TimerManager.Instance.setGroupPaused(group, true); }
    static resumeGroup(group: TimerGroup): void { TimerManager.Instance.setGroupPaused(group, false); }
    static setGroupTimeScale(group: TimerGroup, scale: number): void { TimerManager.Instance.setGroupTimeScale(group, scale); }
    static safeTo(target: Node, duration: number, to: { position?: Vec3; scale?: Vec3 }, complete?: () => void,
        delay = 0, group = TimerGroup.GAME): () => void {
        const fromPosition = target.position.clone(), fromScale = target.scale.clone(), out = new Vec3();
        return this.safeCustom(target, duration, ratio => {
            if (to.position) { Vec3.lerp(out, fromPosition, to.position, ratio); target.setPosition(out); }
            if (to.scale) { Vec3.lerp(out, fromScale, to.scale, ratio); target.setScale(out); }
        }, complete, delay, group);
    }
    static safeCustom(target: Node, duration: number, update: (ratio: number) => void, complete?: () => void,
        delay = 0, group = TimerGroup.GAME): () => void {
        if (!Number.isFinite(duration) || duration < 0 || !Number.isFinite(delay) || delay < 0) throw new Error('Invalid tween duration');
        let elapsed = 0, id = 0;
        const cancel = () => { TimerManager.Instance.remove(id); this.running.delete(id); };
        id = TimerManager.Instance.addTweenTask(dt => {
            if (!isValid(target) || !target.activeInHierarchy) { cancel(); return; }
            elapsed += dt; if (elapsed < delay) return;
            const ratio = duration === 0 ? 1 : Math.min(1, (elapsed - delay) / duration);
            try { update(ratio); } catch (error) { cancel(); throw error; }
            if (ratio === 1) { cancel(); complete?.(); }
        }, target, group);
        this.running.set(id, target); return cancel;
    }
    static stop(target: Node): void { for (const [id, owner] of this.running) if (owner === target) { TimerManager.Instance.remove(id); this.running.delete(id); } }
    static stopAll(): void { for (const id of this.running.keys()) TimerManager.Instance.remove(id); this.running.clear(); }
    static onSceneUnload(): void { this.stopAll(); }
}
