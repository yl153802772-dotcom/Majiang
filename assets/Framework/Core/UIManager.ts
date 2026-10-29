import { Node, Prefab, instantiate, UITransform, BlockInputEvents, Layers, Widget, isValid } from 'cc';
import { UIBase } from '../Components/UIBase';
import { ResManager } from './ResManager';
import { LifecycleScope } from '../Kernel/LifecycleScope';
import type { ResourceHandle } from '../Kernel/ResourceCache';
import { rollbackCleanups, runCleanups } from '../Kernel/Contracts';
export enum UILayer { Scene = 'Scene', Window = 'Window', Popup = 'Popup', Top = 'Top', Guide = 'Guide' }
export interface ViewConfig { path: string; bundle?: string; layer?: UILayer; cache?: 'destroy' | 'keep'; modal?: boolean; }
type View = { ui: UIBase; resource: ResourceHandle<Prefab>; config: ViewConfig; visible: boolean; mask?: Node; result?: (value: unknown) => void };
export class UIManager {
    private static instance = new UIManager();
    static get Instance(): UIManager { return this.instance; }
    private root?: Node;
    private layers = new Map<UILayer, Node>();
    private configs = new Map<string, ViewConfig>();
    private views = new Map<string, View>();
    private loading = new Map<string, { promise: Promise<UIBase>; scope: LifecycleScope }>();
    private stack: string[] = [];
    private scope = new LifecycleScope();
    private disposing = false;
    get opened(): readonly string[] { return [...this.stack]; }
    init(root: Node): void {
        if (this.root) { if (this.root !== root) throw new Error('UI root already configured'); return; }
        if (!isValid(root) || !root.getComponent(UITransform)) throw new Error('UI root needs UITransform');
        this.scope = new LifecycleScope(); this.root = root;
        try {
        for (const layer of Object.values(UILayer)) {
            const node = new Node(layer);
            this.scope.add(() => { if (!isValid(node)) return; node.removeFromParent(); node.destroy(); });
            this.layers.set(layer, node);
            node.layer = Layers.Enum.UI_2D; node.addComponent(UITransform);
            node.setParent(root); const widget = node.addComponent(Widget);
            widget.isAlignTop = widget.isAlignBottom = widget.isAlignLeft = widget.isAlignRight = true;
            widget.top = widget.bottom = widget.left = widget.right = 0;
        }
        } catch (error) {
            this.root = undefined; this.layers.clear();
            rollbackCleanups(error, 'UI initialization rollback failed', [() => this.scope.dispose()]);
        }
    }
    register(name: string, config: ViewConfig): void {
        if (this.configs.has(name)) throw new Error('Duplicate UI: ' + name);
        this.configs.set(name, { ...config });
    }
    openUI(name: string, path?: string, layer?: UILayer, data?: unknown, bundle?: string): Promise<UIBase> {
        if (!this.root || !this.scope.isActive || this.disposing) return Promise.reject(new Error('UI not initialized'));
        const existing = this.views.get(name);
        if (existing) {
            const owner = this.scope;
            try { this.present(name, existing, data); owner.assertActive(); return Promise.resolve(existing.ui); }
            catch (error) { return Promise.reject(error); }
        }
        const pending = this.loading.get(name);
        if (pending) return pending.promise;
        const config = path ? { path, layer, bundle } : this.configs.get(name);
        if (!config) return Promise.reject(new Error('UI not registered: ' + name));
        const scope = this.scope.child();
        const promise = this.load(name, config, data, scope);
        this.loading.set(name, { promise, scope });
        const cleanup = () => { if (this.loading.get(name)?.promise === promise) this.loading.delete(name); };
        void promise.then(cleanup, cleanup);
        return promise;
    }
    private async load(name: string, config: ViewConfig, data: unknown, scope: LifecycleScope): Promise<UIBase> {
        let handle: ResourceHandle<Prefab> | undefined, node: Node | undefined, ui: UIBase | null = null;
        const owner = this.scope;
        try {
            handle = await ResManager.Instance.acquire(config.path, Prefab, { bundle: config.bundle, timeoutMs: 15000, scope });
            scope.assertActive();
            node = instantiate(handle.value);
            ui = node.getComponent(UIBase);
            if (!ui) throw new Error('Prefab missing UIBase: ' + name);
            const parent = this.layers.get(config.layer ?? UILayer.Window);
            if (!parent || !isValid(parent)) throw new Error('UI layer disposed');
            node.setParent(parent);
            ui.lifetime.add(() => scope.dispose());
            ui.onInit(); scope.assertActive();
            ui.setCloseSelfCallback(value => this.closeUI(name, value));
            const view: View = { ui, resource: handle, config, visible: false };
            this.views.set(name, view);
            try { this.present(name, view, data); owner.assertActive(); }
            catch (error) { if (this.views.get(name) === view) this.views.delete(name); throw error; }
            return ui;
        } catch (error) {
            rollbackCleanups(error, 'UI loading rollback failed', [
                () => { if (node) node.active = false; }, () => ui?.onDestroyUI(),
                () => { node?.destroy(); }, () => handle?.release(), () => scope.dispose(),
            ]);
        }
    }
    private present(name: string, view: View, data: unknown): void {
        if (view.visible) return;
        let attemptedShow = false;
        try {
        if (view.config.modal) {
            const mask = new Node(name + ':mask'); mask.layer = Layers.Enum.UI_2D;
            view.mask = mask;
            mask.addComponent(UITransform); mask.addComponent(BlockInputEvents); mask.setParent(view.ui.node.parent);
            const widget = mask.addComponent(Widget);
            widget.isAlignTop = widget.isAlignBottom = widget.isAlignLeft = widget.isAlignRight = true;
            widget.top = widget.bottom = widget.left = widget.right = 0; widget.updateAlignment();
            mask.setSiblingIndex(view.ui.node.getSiblingIndex());
        }
        view.visible = true; this.stack.push(name);
        attemptedShow = true; view.ui.show(data);
        if (!view.visible) return;
        view.ui.node.setSiblingIndex(view.ui.node.parent!.children.length - 1);
        } catch (error) {
            view.visible = false; this.stack = this.stack.filter(id => id !== name);
            const mask = view.mask; view.mask = undefined;
            rollbackCleanups(error, 'UI show rollback failed', [
                () => { mask?.destroy(); },
                () => { if (attemptedShow) view.ui.hide(); else view.ui.node.active = false; },
            ]);
        }
    }
    async openDialog(name: string, data?: unknown): Promise<unknown> {
        if (this.views.get(name)?.visible || this.loading.has(name)) throw new Error('Dialog already open');
        const ui = await this.openUI(name, undefined, undefined, data);
        const view = this.views.get(name);
        if (!view || !view.visible || ui !== view.ui) return undefined;
        return new Promise(resolve => { view.result = resolve; });
    }
    closeUI(name: string, result?: unknown): void {
        const pending = this.loading.get(name); this.loading.delete(name);
        const view = this.views.get(name);
        if (!view || !view.visible) { pending?.scope.dispose(); return; }
        view.visible = false; this.stack = this.stack.filter(id => id !== name);
        const mask = view.mask; view.mask = undefined;
        const finish = view.result; view.result = undefined;
        runCleanups('UI closing failed', [
            // 中文注释：onShow可同步关闭自己；已发布的keep视图仍持有预制体，
            // 不能把尚未结算的open Promise误当成未创建实例而取消其资源。
            () => { mask?.destroy(); }, () => view.ui.hide(),
            () => finish?.(result), () => { if (view.config.cache !== 'keep') this.destroyUI(name); },
        ]);
    }
    destroyUI(name: string): void {
        const pending = this.loading.get(name); this.loading.delete(name);
        const view = this.views.get(name);
        if (!view) { pending?.scope.dispose(); return; }
        this.views.delete(name); this.stack = this.stack.filter(id => id !== name);
        const mask = view.mask, finish = view.result;
        view.mask = undefined; view.result = undefined; view.visible = false;
        runCleanups('UI destruction failed', [
            () => pending?.scope.dispose(), () => { if (mask && isValid(mask)) mask.destroy(); }, () => finish?.(undefined),
            () => { if (isValid(view.ui.node)) view.ui.node.active = false; }, () => view.ui.onDestroyUI(),
            () => { if (isValid(view.ui.node)) { view.ui.node.removeFromParent(); view.ui.node.destroy(); } }, () => view.resource.release(),
        ]);
    }
    closeTopPopup(): void { const name = this.stack[this.stack.length - 1]; if (name) this.closeUI(name); }
    getUI<T extends UIBase>(name: string): T | undefined { return this.views.get(name)?.ui as T | undefined; }
    dispose(): void {
        if (this.disposing) return;
        this.disposing = true;
        const pending = Array.from(this.loading.values()), names = Array.from(this.views.keys());
        this.loading.clear();
        try {
            // Disable/destroy instances before ending the parent asset scope.
            runCleanups('UI cleanup failed', [
                ...pending.map(item => () => item.scope.dispose()),
                ...names.map(name => () => this.destroyUI(name)), () => this.scope.dispose(),
            ]);
        } finally {
            this.views.clear(); this.layers.clear(); this.configs.clear();
            this.root = undefined; this.stack = []; this.disposing = false;
        }
    }
}
