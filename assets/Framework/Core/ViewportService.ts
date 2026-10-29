import { Camera, Node, UITransform, screen, sys, view } from 'cc';
import { ViewportLayout } from '../Kernel/ViewportLayout';
import type { Rect2 } from '../Kernel/ViewportLayout';
import { LifecycleScope } from '../Kernel/LifecycleScope';
export interface ViewportSnapshot {
    readonly ui: ViewportLayout;
    readonly pixels: ViewportLayout;
    readonly physicalWidth: number;
    readonly physicalHeight: number;
    readonly devicePixelRatio: number;
}
/** Read-only view observer. Does not change project resolution, canvas, camera masks or global settings. */
export class ViewportService {
    private scope?: LifecycleScope;
    private state?: ViewportSnapshot;
    private listeners = new Set<(state: ViewportSnapshot) => void>();
    constructor(private readonly design: { width: number; height: number }, private readonly reservedTop: () => number = () => 0) {}
    get snapshot(): ViewportSnapshot { if (!this.state) throw new Error('Viewport service not started'); return this.state; }
    start(): void {
        if (this.scope) throw new Error('Viewport service already started');
        const scope = this.scope = new LifecycleScope();
        try {
            scope.add(() => view.off('canvas-resize', this.refresh, this)); view.on('canvas-resize', this.refresh, this);
            scope.add(() => screen.off('window-resize', this.refresh, this)); screen.on('window-resize', this.refresh, this);
            scope.add(() => screen.off('orientation-change', this.refresh, this)); screen.on('orientation-change', this.refresh, this);
            this.refresh();
        } catch (error) { this.scope = undefined; scope.rollback(error); }
    }
    refresh(): void {
        const visible = view.getVisibleSize(), origin = view.getVisibleOrigin(), safe = sys.getSafeAreaRect(false);
        const ui = new ViewportLayout(this.design, { x: origin.x, y: origin.y, width: visible.width, height: visible.height }, safe, this.reservedTop());
        const port = view.getViewportRect(), size = screen.windowSize;
        const sx = view.getScaleX(), sy = view.getScaleY();
        if (!Number.isFinite(sx) || sx <= 0 || !Number.isFinite(sy) || sy <= 0 || Math.abs(sx - sy) > Math.max(sx, sy) * 0.0001)
            throw new Error('Shared 2D/3D viewport requires uniform view scale');
        const toPixels = (r: Rect2): Rect2 => ({ x: port.x + r.x * sx, y: port.y + r.y * sy, width: r.width * sx, height: r.height * sy });
        // 中文注释：windowSize、viewportRect、scaleX/Y都采用物理像素；相机计算不可再单独除DPR。
        const pixels = new ViewportLayout(this.design, { x: 0, y: 0, width: size.width, height: size.height }, toPixels(ui.available));
        this.state = Object.freeze({ ui, pixels, physicalWidth: size.width, physicalHeight: size.height, devicePixelRatio: screen.devicePixelRatio });
        const errors: unknown[] = [];
        for (const listener of Array.from(this.listeners)) if (this.listeners.has(listener)) try { listener(this.state); } catch (error) { errors.push(error); }
        if (errors.length) throw Object.assign(new Error('Viewport listeners failed'), { causes: errors });
    }
    subscribe(listener: (state: ViewportSnapshot) => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
    applyContent(node: Node): void {
        const { ui } = this.snapshot, visible = ui.viewport;
        node.getComponent(UITransform)?.setContentSize(ui.design.width, ui.design.height);
        node.setScale(ui.scale, ui.scale, 1);
        node.setPosition(ui.content.x + ui.content.width / 2 - visible.x - visible.width / 2,
            ui.content.y + ui.content.height / 2 - visible.y - visible.height / 2, node.position.z);
    }
    applyCamera(camera: Camera, unitsPerPixel = 0.01): void {
        const projection = this.snapshot.pixels.camera(unitsPerPixel);
        camera.orthoHeight = projection.halfHeight;
        camera.node.setPosition(projection.x, projection.y, camera.node.position.z);
    }
    dispose(): void { const scope = this.scope; this.scope = undefined; this.state = undefined; this.listeners.clear(); scope?.dispose(); }
}
