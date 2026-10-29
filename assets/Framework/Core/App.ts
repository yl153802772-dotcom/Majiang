import { Node } from 'cc';
import { ModuleHost } from '../Kernel/ModuleHost';
import type { Module } from '../Kernel/Contracts';
import { TimerManager } from './TimerTool/TimerManager';
import { ResManager } from './ResManager';
import { ConfigManager } from './ConfigManager';
import { UIManager } from './UIManager';
import { AudioSystem } from './AudioSystem';
import { GameObjectPool } from './Pool/GameObjectPool';
import { SequenceManager } from './VisualSequence/SequenceManager';
import { AnimationHelper } from './AnimationHelper';
import { TweenUtil } from '../Utils/TweenUtil';
import { SpriteMaterialHelper } from '../Utils/SpriteMaterialHelper';
import { UIPool } from '../Components/UIPool';
import { PlatformRuntime } from './Platform/PlatformRuntime';
export interface AppOptions {
    uiRoot?: Node; audioRoot?: Node; resourceConcurrency?: number; idleResources?: number;
    platformRuntime?: boolean;
    modules?: ReadonlyArray<{ name: string; module: Module }>;
}
/** Composition facade; FrameworkBootstrap is the sole engine update driver. */
export class App {
    private static instance = new App();
    static get Instance(): App { return this.instance; }
    private host?: ModuleHost;
    private ready?: Promise<void>;
    private stopping?: Promise<void>;
    async init(options: AppOptions = {}): Promise<void> {
        if (this.stopping) throw new Error('App is disposing');
        if (this.ready) return this.ready;
        const host = new ModuleHost(); this.host = host;
        host.register('resources', { init: () => ResManager.Instance.init({ concurrency: options.resourceConcurrency, maxIdle: options.idleResources }),
            dispose: () => ResManager.Instance.dispose() });
        host.register('timers', TimerManager.Instance);
        if (options.platformRuntime !== false) host.register('platform-runtime', PlatformRuntime.Instance);
        host.register('config', { dependencies: ['resources'], dispose: () => ConfigManager.Instance.dispose() });
        host.register('presentation', { dependencies: ['resources', 'timers'], dispose: () => {
            const errors: unknown[] = [];
            for (const dispose of [() => SequenceManager.cancelAll(), () => AnimationHelper.clearAll(),
                () => TweenUtil.stopAll(), () => GameObjectPool.Instance.clearAll(),
                () => UIPool.Instance.clear(), () => SpriteMaterialHelper.clearCache()])
                try { dispose(); } catch (error) { errors.push(error); }
            if (errors.length) throw Object.assign(new Error('Presentation cleanup failed'), { causes: errors });
        } });
        if (options.uiRoot) host.register('ui', { dependencies: ['resources'],
            init: () => UIManager.Instance.init(options.uiRoot!), dispose: () => UIManager.Instance.dispose() });
        if (options.audioRoot) host.register('audio', { dependencies: ['resources'],
            init: () => AudioSystem.Instance.init(options.audioRoot!), dispose: () => AudioSystem.Instance.dispose() });
        for (const item of options.modules ?? []) host.register(item.name, item.module);
        this.ready = host.init(); return this.ready;
    }
    async start(): Promise<void> {
        if (!this.host || this.stopping) throw new Error('App not initialized or disposing');
        await this.host.start();
    }
    update(dt: number): void { this.host?.update(dt); }
    dispose(): Promise<void> {
        if (this.stopping) return this.stopping;
        const host = this.host;
        this.stopping = (async () => {
            try { await host?.dispose(); } finally { this.host = undefined; this.ready = undefined; this.stopping = undefined; }
        })();
        return this.stopping;
    }
}
