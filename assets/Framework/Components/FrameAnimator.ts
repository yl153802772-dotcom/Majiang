import { _decorator, Component, Sprite, SpriteFrame } from 'cc';
import { TimerManager, TimerGroup } from '../Core/TimerTool/TimerManager';
const { ccclass, requireComponent } = _decorator;
@ccclass('FrameAnimator')
@requireComponent(Sprite)
export class FrameAnimator extends Component {
    private timer?: number;
    private sprite: Sprite | null = null;
    get isPlaying(): boolean { return this.timer !== undefined; }
    play(frames: readonly SpriteFrame[], interval = 0.1, loop = true, group = TimerGroup.GAME): void {
        this.stop();
        if (!frames.length || !Number.isFinite(interval) || interval <= 0) throw new Error('Invalid frame sequence');
        this.sprite = this.getComponent(Sprite);
        if (!this.sprite) throw new Error('FrameAnimator requires Sprite');
        let index = 0; this.sprite.spriteFrame = frames[0];
        this.timer = TimerManager.Instance.doLoop(interval, 0, () => {
            index++;
            if (index >= frames.length) { if (!loop) { this.stop(false); return; } index = 0; }
            if (this.sprite) this.sprite.spriteFrame = frames[index];
        }, this, group);
    }
    stop(clear = true): void {
        if (this.timer !== undefined) TimerManager.Instance.remove(this.timer);
        this.timer = undefined;
        if (clear && this.sprite) this.sprite.spriteFrame = null;
    }
    protected onDisable(): void { this.stop(); }
    protected onDestroy(): void { this.stop(); }
}
