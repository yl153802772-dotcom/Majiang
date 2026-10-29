import { director, Scene } from 'cc';
import { LifecycleScope } from '../Kernel/LifecycleScope';
/** Optional serialized scene transitions. Configure releases through a per-scene scope. */
export class SceneManager {
    private scope = new LifecycleScope();
    private busy = false;
    private closed = false;
    async load(name: string, configure?: (scene: Scene, scope: LifecycleScope) => void): Promise<void> {
        if (this.busy || this.closed) throw new Error('Scene transition unavailable');
        this.busy = true;
        try {
            await new Promise<void>((resolve, reject) => director.preloadScene(name, error => error ? reject(error) : resolve()));
            if (this.closed) throw new Error('Scene manager disposed');
            const scene = await new Promise<Scene>((resolve, reject) => {
                const accepted = director.loadScene(name, (error, scene) => error || !scene ? reject(error ?? new Error('No scene returned')) : resolve(scene));
                if (!accepted) reject(new Error('Scene load not accepted: ' + name));
            });
            const previous = this.scope; this.scope = new LifecycleScope();
            previous.dispose();
            if (this.closed) { this.scope.dispose(); return; }
            try { configure?.(scene, this.scope); } catch (error) { this.scope.dispose(); throw error; }
        } finally { this.busy = false; }
    }
    dispose(): void { this.closed = true; this.scope.dispose(); }
}
