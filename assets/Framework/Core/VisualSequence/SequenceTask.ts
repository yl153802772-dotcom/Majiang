import { Node } from 'cc';
import { SequenceContext } from './SequenceContext';
import type { ISequenceNode } from './ISequenceNode';
import { GameObjectPool } from '../Pool/GameObjectPool';
import { rollbackCleanups, runCleanups } from '../../Kernel/Contracts';
export class SequenceTask {
    private static nextId = 0;
    readonly id = ++SequenceTask.nextId;
    private finished = false;
    private phase = 0;
    private detach: () => void;
    constructor(private nodes: Node[], private context: SequenceContext, private effect: ISequenceNode,
        private settled: (completed: boolean) => void) { this.detach = context.onCancel(() => this.cancel()); }
    start(): void {
        if (this.finished) return;
        try {
            this.effect.playPhase1(this.nodes, this.context, () => {
                if (this.finished || this.phase !== 0) return;
                this.phase = 1;
                try {
                    this.recycle();
                    this.effect.playPhase2(this.context, () => { if (!this.finished) this.finish(true); });
                } catch (error) { rollbackCleanups(error, 'Sequence phase rollback failed', [() => this.cancel()]); }
            });
        } catch (error) { rollbackCleanups(error, 'Sequence start rollback failed', [() => this.cancel()]); }
    }
    private recycle(): void {
        const nodes = this.nodes.splice(0);
        const errors: unknown[] = [];
        for (const node of nodes) if (node.isValid) try { GameObjectPool.Instance.recycle(node); } catch (error) { errors.push(error); }
        if (errors.length) throw Object.assign(new Error('Effect dummy recycling failed'), { causes: errors });
    }
    private finish(completed: boolean): void {
        if (this.finished) return;
        this.finished = true; this.detach(); this.settled(completed);
    }
    cancel(): void {
        if (this.finished) return;
        this.finished = true;
        runCleanups('Sequence cleanup failed', [
            () => this.detach(), () => this.context.cancel(),
            () => this.effect.cancel?.(this.nodes), () => this.recycle(), () => this.settled(false),
        ]);
    }
}
