import { _decorator, Component, Widget, sys, view } from 'cc';
const { ccclass, property, requireComponent } = _decorator;
@ccclass('SafeAreaAdapter')
@requireComponent(Widget)
export class SafeAreaAdapter extends Component {
    @property adaptTop = true;
    @property adaptBottom = true;
    @property adaptLeft = true;
    @property adaptRight = true;
    private top = 0;
    private bottom = 0;
    private left = 0;
    private right = 0;
    private captured = false;
    protected onEnable(): void {
        const widget = this.getComponent(Widget);
        if (widget && !this.captured) { this.top = widget.top; this.bottom = widget.bottom; this.left = widget.left; this.right = widget.right; this.captured = true; }
        view.on('canvas-resize', this.applySafeArea, this); this.applySafeArea();
    }
    applySafeArea(): void {
        const widget = this.getComponent(Widget); if (!widget) return;
        // getSafeAreaRect() returns design-resolution coordinates in Creator 3.8.
        const safe = sys.getSafeAreaRect(false), visible = view.getVisibleSize(), origin = view.getVisibleOrigin();
        widget.top = this.top + (this.adaptTop ? Math.max(0, origin.y + visible.height - safe.yMax) : 0);
        widget.bottom = this.bottom + (this.adaptBottom ? Math.max(0, safe.yMin - origin.y) : 0);
        widget.left = this.left + (this.adaptLeft ? Math.max(0, safe.xMin - origin.x) : 0);
        widget.right = this.right + (this.adaptRight ? Math.max(0, origin.x + visible.width - safe.xMax) : 0);
        widget.updateAlignment();
    }
    protected onDisable(): void {
        view.off('canvas-resize', this.applySafeArea, this);
        const widget = this.getComponent(Widget); if (widget && this.captured) { widget.top = this.top; widget.bottom = this.bottom; widget.left = this.left; widget.right = this.right; widget.updateAlignment(); }
    }
}
