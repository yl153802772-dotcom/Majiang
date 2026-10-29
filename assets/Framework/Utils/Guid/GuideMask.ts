import { _decorator, Component, Node, UITransform, BlockInputEvents, Graphics, Color, Vec3, Rect, Layers } from 'cc';
const { ccclass, requireComponent } = _decorator;
/** Axis-aligned UI hole in this node's local coordinates; refresh after layout changes. */
@ccclass('GuideMask')
@requireComponent(Graphics)
export class GuideMask extends Component {
    private blockers: Node[] = [];
    focusOn(targets: readonly Node[], padding = 10): Rect {
        this.removeMask();
        const transform = this.getComponent(UITransform), graphics = this.getComponent(Graphics);
        if (!transform || !graphics || !targets.length) return new Rect();
        let left = Infinity, right = -Infinity, bottom = Infinity, top = -Infinity;
        for (const node of targets) {
            const bounds = node.getComponent(UITransform)?.getBoundingBoxToWorld();
            if (!bounds) continue;
            for (const point of [new Vec3(bounds.xMin, bounds.yMin), new Vec3(bounds.xMin, bounds.yMax),
                new Vec3(bounds.xMax, bounds.yMin), new Vec3(bounds.xMax, bounds.yMax)]) {
                const local = transform.convertToNodeSpaceAR(point);
                left = Math.min(left, local.x); right = Math.max(right, local.x);
                bottom = Math.min(bottom, local.y); top = Math.max(top, local.y);
            }
        }
        if (!Number.isFinite(left)) return new Rect();
        left -= padding; right += padding; bottom -= padding; top += padding;
        const x0 = -transform.width * transform.anchorX, x1 = x0 + transform.width;
        const y0 = -transform.height * transform.anchorY, y1 = y0 + transform.height;
        const areas = [[x0, top, x1 - x0, Math.max(0, y1 - top)],
            [x0, y0, x1 - x0, Math.max(0, bottom - y0)],
            [x0, bottom, Math.max(0, left - x0), top - bottom],
            [right, bottom, Math.max(0, x1 - right), top - bottom]];
        graphics.fillColor = new Color(0, 0, 0, 180);
        for (const [x, y, w, h] of areas) {
            graphics.rect(x, y, w, h);
            const node = new Node('GuideBlocker'); node.layer = Layers.Enum.UI_2D; node.setParent(this.node);
            const rect = node.addComponent(UITransform); rect.setContentSize(w, h);
            node.setPosition(x + w / 2, y + h / 2); node.addComponent(BlockInputEvents); this.blockers.push(node);
        }
        graphics.fill(); return new Rect(left, bottom, right - left, top - bottom);
    }
    removeMask(): void { this.getComponent(Graphics)?.clear(); for (const node of this.blockers) node.destroy(); this.blockers = []; }
    protected onDisable(): void { this.removeMask(); }
}
