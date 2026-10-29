import { director, Node } from 'cc';
import { ResManager } from '../ResManager';
import { GameObjectPool } from '../Pool/GameObjectPool';
/** Bounded samples. Scene traversal runs once per second, never every frame. */
export class PerformanceMonitor {
    private static instance = new PerformanceMonitor();
    static get Instance(): PerformanceMonitor { return this.instance; }
    private elapsed = 0;
    private frames = 0;
    private fps = 0;
    private nodes = 0;
    private history: Array<{ fps: number; nodes: number }> = [];
    private timings = new Map<string, number[]>();
    init(): void { this.dispose(); }
    update(dt: number): void {
        if (!Number.isFinite(dt) || dt < 0) return;
        this.elapsed += dt; this.frames++;
        if (this.elapsed < 1) return;
        this.fps = this.frames / this.elapsed; this.frames = 0; this.elapsed = 0;
        const scene = director.getScene(), stack: Node[] = scene ? [scene] : [];
        this.nodes = 0;
        while (stack.length) { const node = stack.pop()!; this.nodes++; stack.push(...node.children); }
        this.history.push({ fps: this.fps, nodes: this.nodes });
        if (this.history.length > 60) this.history.shift();
    }
    record(name: string, ms: number): void {
        if (!Number.isFinite(ms) || ms < 0) return;
        if (!this.timings.has(name) && this.timings.size >= 32) throw new Error('Timing series limit reached');
        const samples = this.timings.get(name) ?? [];
        samples.push(ms); if (samples.length > 240) samples.shift(); this.timings.set(name, samples);
    }
    getTiming(name: string): { count: number; p95: number; max: number } {
        const sorted = [...(this.timings.get(name) ?? [])].sort((a, b) => a - b);
        return { count: sorted.length, p95: sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0, max: sorted[sorted.length - 1] ?? 0 };
    }
    getFPS(): number { return this.fps; }
    getNode(): number { return this.nodes; }
    getAverageFPS(): number { return this.history.reduce((n, s) => n + s.fps, 0) / (this.history.length || 1); }
    getTrend(): { fps: number[]; node: number[] } { return { fps: this.history.map(s => s.fps), node: this.history.map(s => s.nodes) }; }
    getResInfo(): ReturnType<ResManager['getDebugInfo']> { return ResManager.Instance.getDebugInfo(); }
    getPoolInfo(): ReturnType<GameObjectPool['getDebugInfo']> { return GameObjectPool.Instance.getDebugInfo(); }
    dispose(): void { this.history = []; this.timings.clear(); this.elapsed = this.frames = this.fps = this.nodes = 0; }
}
