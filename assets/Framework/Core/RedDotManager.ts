import { EventCenter } from '../Data/EventCenter';
import { FrameworkEvent } from './GameConst';
/** Derived counters only. Persistence and business rules belong to the project. */
export class RedDotManager {
    private static instance = new RedDotManager();
    static get Instance(): RedDotManager { return this.instance; }
    private values = new Map<string, number>();
    getValue(path: string): number {
        let total = this.values.get(path) ?? 0;
        for (const [key, value] of this.values) if (key.startsWith(path + '/')) total += value;
        return total;
    }
    setValue(path: string, value: number): void {
        if (!path || !Number.isFinite(value) || value < 0) throw new Error('Invalid counter');
        this.values.set(path, value);
        const parts = path.split('/');
        while (parts.length) {
            const current = parts.join('/');
            EventCenter.emit(FrameworkEvent.RED_DOT_UPDATE, { path: current, value: this.getValue(current) });
            parts.pop();
        }
    }
    dispose(): void { this.values.clear(); }
}
