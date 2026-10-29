import type { Dispose } from '../../Kernel/Contracts';
export interface GuideStep { show(): Dispose; }
/** Project supplies guide steps and records completion; no fixed table, UI or pause policy. */
export class GuideManager {
    private static instance = new GuideManager();
    static get Instance(): GuideManager { return this.instance; }
    private steps: readonly GuideStep[] = [];
    private index = -1;
    private cleanup?: Dispose;
    start(steps: readonly GuideStep[]): void { this.stopAll(); this.steps = steps; this.index = 0; this.present(); }
    next(): void { if (this.index < 0) return; this.cleanup?.(); this.cleanup = undefined; this.index++; this.present(); }
    private present(): void {
        if (this.index >= this.steps.length) { this.stopAll(); return; }
        this.cleanup = this.steps[this.index]?.show();
    }
    stopAll(): void {
        const cleanup = this.cleanup; this.cleanup = undefined; this.steps = []; this.index = -1; cleanup?.();
    }
}
