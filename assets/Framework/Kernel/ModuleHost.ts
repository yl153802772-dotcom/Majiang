import { FrameworkError } from './Contracts';
import type { Module } from './Contracts';
type HostState = 'idle' | 'initializing' | 'ready' | 'starting' | 'running' | 'failed' | 'disposing' | 'disposed';
export class ModuleHost {
    private modules = new Map<string, Module>();
    private ordered: Module[] = [];
    private entered: Module[] = [];
    private initializing?: Promise<void>;
    private starting?: Promise<void>;
    private disposing?: Promise<void>;
    private phase: HostState = 'idle';
    private disposeRequested = false;
    get state(): HostState { return this.phase; }
    register(name: string, module: Module): this {
        if (this.phase !== 'idle') throw new Error('Registration is closed');
        if (!name || this.modules.has(name)) throw new Error('Duplicate or empty module: ' + name);
        this.modules.set(name, module);
        return this;
    }
    getModule<T extends Module>(name: string): T {
        const module = this.modules.get(name);
        if (!module) throw new Error('Missing module: ' + name);
        return module as T;
    }
    private sort(): Module[] {
        const output: Module[] = [], visiting = new Set<string>(), done = new Set<string>();
        const visit = (name: string) => {
            if (done.has(name)) return;
            if (visiting.has(name)) throw new Error('Cyclic module dependency: ' + name);
            const module = this.modules.get(name);
            if (!module) throw new Error('Missing module dependency: ' + name);
            visiting.add(name);
            for (const dependency of module.dependencies ?? []) visit(dependency);
            visiting.delete(name); done.add(name); output.push(module);
        };
        Array.from(this.modules.keys()).sort((a, b) =>
            (this.modules.get(b)?.priority ?? 0) - (this.modules.get(a)?.priority ?? 0)).forEach(visit);
        return output;
    }
    init(): Promise<void> {
        if (this.initializing) return this.initializing;
        if (this.phase !== 'idle') return Promise.reject(new Error('Host cannot initialize: ' + this.phase));
        this.phase = 'initializing';
        this.initializing = this.initialize();
        return this.initializing;
    }
    private async initialize(): Promise<void> {
        try {
            this.ordered = this.sort();
            for (const module of this.ordered) {
                if (this.disposeRequested) break;
                this.entered.push(module);
                await module.init?.();
            }
            this.phase = 'ready';
        } catch (error) {
            const cleanup = await this.cleanup();
            this.phase = 'failed';
            throw new FrameworkError('Module initialization failed', [error, ...cleanup]);
        }
    }
    start(): Promise<void> {
        if (this.starting) return this.starting;
        if (this.disposing || this.phase === 'disposed') return Promise.reject(new Error('Host disposed'));
        this.starting = this.startAll();
        return this.starting;
    }
    private async startAll(): Promise<void> {
        await this.init();
        if (this.disposeRequested) return;
        this.phase = 'starting';
        try {
            for (const module of this.ordered) { if (this.disposeRequested) break; await module.start?.(); }
            this.phase = 'running';
        } catch (error) {
            const cleanup = await this.cleanup();
            this.phase = 'failed';
            throw new FrameworkError('Module start failed', [error, ...cleanup]);
        }
    }
    update(dt: number): void {
        if (this.phase !== 'running' || this.disposing) return;
        if (!Number.isFinite(dt) || dt < 0) throw new Error('Invalid delta time');
        for (const module of this.ordered) {
            if (this.disposing) break;
            module.update?.(dt);
        }
    }
    dispose(): Promise<void> {
        if (this.disposing) return this.disposing;
        this.disposeRequested = true;
        this.disposing = this.finishDispose();
        return this.disposing;
    }
    private async finishDispose(): Promise<void> {
        try { await (this.starting ?? this.initializing); } catch { /* rollback already executed */ }
        this.phase = 'disposing';
        const errors = await this.cleanup();
        this.modules.clear(); this.ordered = []; this.phase = 'disposed';
        if (errors.length) throw new FrameworkError('Module disposal failed', errors);
    }
    private async cleanup(): Promise<unknown[]> {
        const errors: unknown[] = [];
        const modules = this.entered.splice(0).reverse();
        for (const module of modules) try { await module.dispose?.(); } catch (error) { errors.push(error); }
        return errors;
    }
}
