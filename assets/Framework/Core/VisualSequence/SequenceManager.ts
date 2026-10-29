import { Node, Vec3 } from 'cc';
import { SequenceContext } from './SequenceContext';
import { SequenceTask } from './SequenceTask';
import type { ISequenceNode } from './ISequenceNode';
export class SequenceManager {
    private static tasks = new Map<number, SequenceTask>();
    static play(effect: ISequenceNode, dummyNodes: Node[], center: Vec3, onFinish?: () => void): SequenceContext {
        const context = new SequenceContext(center);
        const task = new SequenceTask([...dummyNodes], context, effect, completed => {
            this.tasks.delete(task.id); if (completed) onFinish?.();
        });
        this.tasks.set(task.id, task); task.start(); return context;
    }
    static cancelAll(): void {
        const errors: unknown[] = [];
        for (const task of Array.from(this.tasks.values())) try { task.cancel(); } catch (error) { errors.push(error); }
        this.tasks.clear();
        if (errors.length) throw Object.assign(new Error('Sequence cleanup failed'), { causes: errors });
    }
}
