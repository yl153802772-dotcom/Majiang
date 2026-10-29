import { _decorator, Component, Asset } from 'cc';
import { LifecycleScope } from '../Kernel/LifecycleScope';
import { ResManager } from '../Core/ResManager';
import type { AssetType } from '../Core/ResManager';
import { rollbackCleanups } from '../Kernel/Contracts';
const { ccclass } = _decorator;
@ccclass('UIBase')
export class UIBase extends Component {
    /** Lifetime references survive a cached hide; showScope ends on each hide. */
    readonly lifetime = new LifecycleScope();
    protected showScope = new LifecycleScope();
    private closeAction?: (result?: unknown) => void;
    private uiDestroyed = false;
    onInit(): void {}
    onShow(_data?: unknown): void {}
    onHide(): void {}
    show(data?: unknown): void {
        this.showScope.dispose(); this.showScope = this.lifetime.child();
        try { this.node.active = true; this.onShow(data); }
        catch (error) {
            rollbackCleanups(error, 'UI show cleanup failed', [
                () => this.showScope.dispose(), () => { this.node.active = false; },
            ]);
        }
    }
    hide(): void {
        const errors: unknown[] = [];
        try { this.onHide(); } catch (error) { errors.push(error); }
        try { this.showScope.dispose(); } catch (error) { errors.push(error); }
        try { this.node.active = false; } catch (error) { errors.push(error); }
        if (errors.length) throw Object.assign(new Error('UI hide cleanup failed'), { causes: errors });
    }
    setCloseSelfCallback(callback: (result?: unknown) => void): void { this.closeAction = callback; }
    close(result?: unknown): void { this.closeAction?.(result); }
    async loadAsset<T extends Asset>(path: string, type: AssetType<T>, bundle?: string): Promise<T> {
        const handle = await ResManager.Instance.acquire(path, type, { bundle, scope: this.lifetime });
        return handle.value;
    }
    onDestroyUI(): void {
        if (this.uiDestroyed) return;
        this.uiDestroyed = true;
        const errors: unknown[] = [];
        try { this.showScope.dispose(); } catch (error) { errors.push(error); }
        try { this.lifetime.dispose(); } catch (error) { errors.push(error); }
        this.closeAction = undefined;
        if (errors.length) throw Object.assign(new Error('UI lifetime cleanup failed'), { causes: errors });
    }
    protected onDestroy(): void { this.onDestroyUI(); }
}
