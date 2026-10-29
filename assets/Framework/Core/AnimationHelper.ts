import { Node, SpriteAtlas, Sprite, isValid } from 'cc';
import { FrameAnimator } from '../Components/FrameAnimator';
import { ResManager } from './ResManager';
import { LifecycleScope } from '../Kernel/LifecycleScope';
import { rollbackCleanups, runCleanups } from '../Kernel/Contracts';
/** Caller must stop on recycle; scope cleanup also rejects late atlas responses. */
export class AnimationHelper {
    private static scopes = new Map<Node, LifecycleScope>();
    static async playAnimationFromAtlas(node: Node, path: string, prefix: string, count: number,
        interval = 0.1, loop = true, bundle?: string): Promise<boolean> {
        this.stopAnimation(node);
        if (!isValid(node) || !node.getComponent(Sprite)) return false;
        const scope = new LifecycleScope(); this.scopes.set(node, scope);
        try {
            const handle = await ResManager.Instance.acquire(path, SpriteAtlas, { bundle, scope, timeoutMs: 10000 });
            scope.assertActive();
            if (!isValid(node)) { this.stopAnimation(node); return false; }
            const frames = Array.from({ length: count }, (_, i) => handle.value.getSpriteFrame(prefix + String(i + 1).padStart(2, '0')));
            if (!count || frames.some(frame => !frame)) throw new Error('Missing animation frames');
            const animator = node.getComponent(FrameAnimator) ?? node.addComponent(FrameAnimator);
            scope.add(() => { if (isValid(animator)) animator.stop(); });
            animator.play(frames as import('cc').SpriteFrame[], interval, loop);
            return true;
        } catch (error) {
            rollbackCleanups(error, 'Animation cleanup failed', [
                () => { if (this.scopes.get(node) === scope) this.stopAnimation(node); },
            ]);
        }
    }
    static stopAnimation(node: Node): void {
        const scope = this.scopes.get(node); this.scopes.delete(node); scope?.dispose();
    }
    static clearAll(): void {
        runCleanups('Animation collection cleanup failed', Array.from(this.scopes.keys()).map(node => () => this.stopAnimation(node)));
    }
}
