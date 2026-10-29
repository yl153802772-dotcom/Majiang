export interface TimerOptions { group?: string; repeat?: number; }
type Task = { id: number; delay: number; elapsed: number; remaining: number; group: string; callback: (dt: number) => void };
/** Callbacks added during tick start next tick; max four catch-up callbacks per timer/tick. */
export class TaskScheduler {
    private tasks = new Map<number, Task>();
    private nextId = 0;
    private groups = new Map<string, { paused: boolean; scale: number }>();
    public paused = false;
    public timeScale = 1;
    get size(): number { return this.tasks.size; }
    add(delay: number, callback: (dt: number) => void, options: TimerOptions = {}): number {
        const repeat = options.repeat ?? 1;
        if (!Number.isFinite(delay) || delay < 0 || !Number.isInteger(repeat) || repeat < 0)
            throw new Error('Invalid timer options');
        const id = ++this.nextId;
        this.tasks.set(id, { id, delay, elapsed: 0, remaining: repeat || Infinity, group: options.group ?? 'game', callback });
        return id;
    }
    remove(id: number): void { this.tasks.delete(id); }
    setGroup(name: string, paused: boolean, scale = 1): void {
        if (!Number.isFinite(scale) || scale < 0) throw new Error('Invalid timer scale');
        this.groups.set(name, { paused, scale });
    }
    tick(dt: number): void {
        if (!Number.isFinite(dt) || dt < 0 || !Number.isFinite(this.timeScale) || this.timeScale < 0) throw new Error('Invalid clock');
        if (this.paused) return;
        const errors: unknown[] = [];
        for (const task of Array.from(this.tasks.values())) {
            if (!this.tasks.has(task.id)) continue;
            const group = this.groups.get(task.group);
            if (group?.paused) continue;
            const delta = dt * (task.group === 'ui' ? 1 : this.timeScale) * (group?.scale ?? 1);
            if (delta === 0) continue;
            task.elapsed += delta;
            let count = 0;
            while (task.elapsed >= task.delay && this.tasks.has(task.id) && count++ < 4) {
                if (task.delay) task.elapsed -= task.delay;
                if (--task.remaining <= 0) this.tasks.delete(task.id);
                try { task.callback(delta); } catch (error) { this.tasks.delete(task.id); errors.push(error); }
                if (!task.delay) break;
            }
            if (task.delay && count > 4) task.elapsed %= task.delay;
        }
        if (errors.length) { const error = new Error('Timer callbacks failed'); Object.assign(error, { causes: errors }); throw error; }
    }
    clear(): void { this.tasks.clear(); this.groups.clear(); this.paused = false; this.timeScale = 1; }
}
