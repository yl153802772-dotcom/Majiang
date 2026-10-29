import { _decorator, Camera, Canvas, Color, Component, Graphics, JsonAsset, Label, Layers, Material, MeshRenderer, Node, primitives, ResolutionPolicy, UITransform, utils, view } from 'cc';
import { App } from '../Framework/Core/App';
import { ResManager } from '../Framework/Core/ResManager';
import { RuntimeLifecycle } from '../Framework/Core/RuntimeLifecycle';
import { ViewportService } from '../Framework/Core/ViewportService';
import { PlatformRuntime } from '../Framework/Core/Platform/PlatformRuntime';
import { UIManager, UILayer } from '../Framework/Core/UIManager';
import { LifecycleScope } from '../Framework/Kernel/LifecycleScope';
import { FrameworkError } from '../Framework/Kernel/Contracts';
import { box, button, label, place } from './DemoUi';
const { ccclass } = _decorator;
/** Standalone example only. Never attaches to Main or imports game rules/assets. */
@ccclass('FrameworkDemo')
export class FrameworkDemo extends Component {
    private lifetime = new LifecycleScope();
    private runtime?: RuntimeLifecycle;
    private viewport?: ViewportService;
    private status?: Label;
    private cube?: Node;
    private ready = false;
    private closed = false;
    private ownsApp = false;
    private stopping?: Promise<void>;
    private restarting?: Promise<void>;
    private generation = 0;
    private ticks = 0;
    private elapsed = 0;
    private angle = 0;
    private round = 0;
    private pauseRelease?: () => void;
    protected onLoad(): void { void this.startDemo().catch(error => this.fail(error)); }
    private async startDemo(): Promise<void> {
        const epoch = ++this.generation; this.ticks = 0; this.elapsed = 0; this.pauseRelease = undefined;
        // Scene-local choice only; no project/global design-resolution file is changed.
        view.setDesignResolutionSize(720, 1280, ResolutionPolicy.SHOW_ALL);
        const root = new Node('FrameworkDemoRoot'); this.node.addChild(root); this.lifetime.add(() => { if (!root.isValid) return; root.active = false; root.removeFromParent(); root.destroy(); });
        const worldCamera = this.camera(root, 'WorldCamera', 0, Camera.ClearFlag.SOLID_COLOR, Layers.Enum.DEFAULT, 20);
        worldCamera.clearColor = new Color(12, 20, 29, 255);
        const overlayCamera = this.camera(root, 'OverlayCamera', 1, Camera.ClearFlag.DEPTH_ONLY, Layers.Enum.UI_2D, 1000);
        const canvasNode = box(root, 'Canvas', 720, 1280), canvas = canvasNode.addComponent(Canvas);
        canvas.cameraComponent = overlayCamera; canvas.alignCanvasWithScreen = true;
        const content = box(canvasNode, 'DemoContent', 720, 1280);
        place(label(content, '通用框架 · 独立验证示例', 680, 80, 34).node, 360, 95);
        this.status = label(content, '正在启动…', 660, 180, 23); place(this.status.node, 360, 245);
        const probe = box(content, 'ProjectionProbe', 92, 116), graphics = probe.addComponent(Graphics);
        graphics.strokeColor = new Color(72, 221, 168); graphics.lineWidth = 3; graphics.rect(-46, -58, 92, 116); graphics.stroke(); place(probe, 360, 540);
        place(label(content, '白块应居于绿框内 · 2D / 3D共用映射', 680, 60, 22).node, 360, 655);
        const mesh = utils.createMesh(primitives.box({ width: .64, height: .88, length: .16 })); this.lifetime.add(() => { if (mesh.isValid) mesh.destroy(); });
        const material = new Material(); this.lifetime.add(() => { if (material.isValid) material.destroy(); });
        material.initialize({ effectName: 'builtin-unlit' }); material.setProperty('mainColor', new Color(240, 236, 212));
        const cube = this.cube = new Node('Cube3D'); root.addChild(cube); cube.layer = Layers.Enum.DEFAULT;
        const renderer = cube.addComponent(MeshRenderer); renderer.mesh = mesh; renderer.setMaterial(material, 0);
        this.lifetime.add(() => { if (!renderer.isValid) return; renderer.mesh = null; renderer.setMaterial(null, 0); });
        const runtime = this.runtime = new RuntimeLifecycle();
        const viewport = this.viewport = new ViewportService({ width: 720, height: 1280 }, () => {
            const metrics = PlatformRuntime.Instance.readWindow();
            return metrics?.menu ? Math.max(0, metrics.menu.top + metrics.menu.height + 8 - (metrics.safeArea?.top ?? 0)) * view.getVisibleSize().height / metrics.height : 0;
        });
        this.lifetime.add(() => viewport.dispose());
        this.lifetime.add(viewport.subscribe(state => {
            viewport.applyContent(content); viewport.applyCamera(worldCamera);
            const point = state.ui.toWorld({ x: 360, y: 540 }); cube.setPosition(point.x, point.y, 0);
        }));
        viewport.start();
        button(content, '暂停 / 继续', 180, 820, () => {
            if (!this.ready) return;
            if (this.pauseRelease) { this.pauseRelease(); this.pauseRelease = undefined; } else this.pauseRelease = runtime.pauses.hold('demo-menu');
            this.refreshStatus();
        });
        button(content, '打开模态窗口', 540, 820, () => {
            if (this.ready) void UIManager.Instance.openUI('demo-dialog', undefined, undefined, runtime.pauses).catch(error => this.fail(error));
        });
        button(content, '重复加载 · 验证共享资源', 360, 930, () => { if (this.ready) void this.loadConfig(epoch).catch(error => this.fail(error)); }, 590);
        button(content, '重建示例 · 验证生命周期', 360, 1040, () => { if (this.ready) void this.restart().catch(error => this.fail(error)); }, 590);
        place(label(content, '无需Game / UI素材 / 网络 / 广告ID\n本示例不代表微信真机验收', 680, 110, 22).node, 360, 1180);
        this.ownsApp = true;
        await App.Instance.init({ uiRoot: canvasNode, modules: [{ name: 'demo-runtime', module: runtime }] });
        if (this.closed || epoch !== this.generation) return;
        UIManager.Instance.register('demo-dialog', { path: 'DemoDialog', bundle: 'framework-demo', modal: true, cache: 'keep', layer: UILayer.Popup });
        await App.Instance.start(); if (this.closed || epoch !== this.generation) return;
        await this.loadConfig(epoch); if (this.closed || epoch !== this.generation) return;
        this.ready = true; ++this.round; viewport.refresh(); this.refreshStatus();
        this.scheduleOnce(() => { if (!this.closed && epoch === this.generation) viewport.refresh(); }, 0);
    }
    private async loadConfig(epoch: number): Promise<void> {
        const scope = this.lifetime.child();
        try {
            const [a, b] = await Promise.all([0, 1].map(() => ResManager.Instance.acquire('demo-config', JsonAsset, { bundle: 'framework-demo', scope, timeoutMs: 10000 })));
            if (a.value !== b.value || a.value.json?.framework !== 'generic-v2') throw new Error('Demo shared-resource check failed');
            if (!this.closed && epoch === this.generation) this.refreshStatus();
        } finally { scope.dispose(); }
    }
    private refreshStatus(): void {
        if (!this.status?.isValid || !this.viewport) return;
        const state = this.viewport.snapshot, res = ResManager.Instance.getDebugInfo(), reasons = this.runtime?.pauses.snapshot.reasons ?? [];
        this.status.string = `重建轮次 ${this.round} · 帧驱动计数 ${this.ticks}\n${reasons.length ? '暂停：' + reasons.join('、') : '运行中'}\n`
            + `可见 ${Math.round(state.ui.viewport.width)}×${Math.round(state.ui.viewport.height)} · DPR ${state.devicePixelRatio}\n`
            + `资源owner ${res.owners} · 缓存 ${res.entries} · 单一App驱动`;
    }
    protected update(dt: number): void {
        if (!this.ready) return; App.Instance.update(Math.min(dt, .25));
        if (!this.runtime?.pauses.isPaused) { this.ticks++; this.angle += dt * 20; this.cube?.setRotationFromEuler(0, 0, Math.sin(this.angle / 20) * 4); }
        this.elapsed += dt; if (this.elapsed >= .25) { this.elapsed = 0; this.refreshStatus(); }
    }
    private camera(parent: Node, name: string, priority: number, clear: number, visibility: number, z: number): Camera {
        const node = new Node(name); parent.addChild(node); node.setPosition(0, 0, z);
        const camera = node.addComponent(Camera); camera.projection = Camera.ProjectionType.ORTHO;
        camera.priority = priority; camera.clearFlags = clear; camera.visibility = visibility; camera.near = .1; camera.far = 2000; return camera;
    }
    private restart(): Promise<void> {
        if (this.restarting) return this.restarting;
        const task = (async () => { await this.stop(); if (this.closed) return; this.lifetime = new LifecycleScope(); await this.startDemo(); })();
        this.restarting = task; const done = () => { if (this.restarting === task) this.restarting = undefined; }; void task.then(done, done); return task;
    }
    private stop(): Promise<void> {
        if (this.stopping) return this.stopping;
        this.ready = false; ++this.generation; const owns = this.ownsApp; this.ownsApp = false; const scope = this.lifetime;
        const task = (async () => {
            let failure: unknown;
            try { if (owns) await App.Instance.dispose(); } catch (error) { failure = error; }
            try { scope.dispose(); } catch (error) { failure = failure ? new FrameworkError('Demo exit failed', [failure, error]) : error; }
            if (failure) throw failure;
        })();
        this.stopping = task; const done = () => { if (this.stopping === task) this.stopping = undefined; }; void task.then(done, done); return task;
    }
    private fail(error: unknown): void { console.error('[FrameworkDemo]', error); if (this.status?.isValid) this.status.string = '示例失败：' + String(error); void this.stop().catch(cleanup => console.error('[FrameworkDemo] cleanup', cleanup)); }
    protected onDestroy(): void { this.closed = true; this.ready = false; void this.stop().catch(error => console.error('[FrameworkDemo] exit', error, (error as { causes?: unknown }).causes)); }
}
