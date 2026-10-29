import { Sprite, Material } from 'cc';
import { rollbackCleanups, runCleanups } from '../Kernel/Contracts';
/** Each binding owns its material instance; release before recycling or destroying the sprite. */
export class SpriteMaterialHelper {
    private static bindings = new Map<Sprite, { original: Material | null; instance: Material }>();
    static bind(sprite: Sprite, source: Material, configure?: (material: Material) => void): () => void {
        this.onEntityRecycle(sprite);
        const instance = new Material(), original = sprite.customMaterial;
        try {
            instance.copy(source); configure?.(instance);
            this.bindings.set(sprite, { original, instance }); sprite.customMaterial = instance;
        } catch (error) {
            this.bindings.delete(sprite);
            rollbackCleanups(error, 'Material binding rollback failed', [
                () => { if (sprite.isValid) sprite.customMaterial = original; }, () => { instance.destroy(); },
            ]);
        }
        return () => { if (this.bindings.get(sprite)?.instance === instance) this.onEntityRecycle(sprite); };
    }
    static onEntityRecycle(sprite: Sprite): void {
        const binding = this.bindings.get(sprite); if (!binding) return;
        this.bindings.delete(sprite);
        runCleanups('Material binding cleanup failed', [
            () => { if (sprite.isValid) sprite.customMaterial = binding.original; },
            () => { binding.instance.destroy(); },
        ]);
    }
    static clearCache(): void {
        runCleanups('Material collection cleanup failed', Array.from(this.bindings.keys()).map(sprite => () => this.onEntityRecycle(sprite)));
    }
}
