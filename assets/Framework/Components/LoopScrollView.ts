import { _decorator, Component, ScrollView, Node, Prefab, instantiate, UITransform, Vec2 } from 'cc';
const { ccclass, property } = _decorator;
export interface ILoopItem { updateItem(data: unknown, index: number): void; }
/** Vertical fixed-size grid. Content anchor is top-center; cells need centered anchors. */
@ccclass('LoopScrollView')
export class LoopScrollView extends Component {
    @property(ScrollView) scrollView: ScrollView | null = null;
    @property(Prefab) itemPrefab: Prefab | null = null;
    @property columnCount = 1;
    @property itemWidth = 100;
    @property itemHeight = 100;
    @property spacingX = 0;
    @property spacingY = 0;
    @property buffer = 2;
    private data: readonly unknown[] = [];
    private visible = new Map<number, Node>();
    private idle: Node[] = [];
    private get content(): Node | null { return this.scrollView?.content ?? null; }
    protected onEnable(): void {
        this.scrollView?.node.on('scrolling', this.render, this);
        this.scrollView?.node.on(Node.EventType.SIZE_CHANGED, this.reset, this);
        this.reset();
    }
    protected onDisable(): void {
        this.scrollView?.node.off('scrolling', this.render, this);
        this.scrollView?.node.off(Node.EventType.SIZE_CHANGED, this.reset, this);
    }
    setData(data: readonly unknown[]): void {
        this.data = data; this.scrollView?.stopAutoScroll(); this.scrollView?.scrollToOffset(new Vec2(), 0); this.reset();
    }
    private reset(): void {
        for (const node of this.visible.values()) { node.active = false; this.idle.push(node); }
        this.visible.clear();
        const trans = this.content?.getComponent(UITransform);
        if (!trans || !this.scrollView || !this.itemPrefab) return;
        if (!Number.isInteger(this.columnCount) || this.columnCount < 1 || this.itemHeight <= 0 || this.itemWidth <= 0
            || this.spacingY < 0 || !Number.isInteger(this.buffer) || this.buffer < 0) throw new Error('Invalid virtual grid dimensions');
        trans.setAnchorPoint(0.5, 1);
        const rows = Math.ceil(this.data.length / this.columnCount);
        trans.setContentSize(trans.width, Math.max(0, rows * (this.itemHeight + this.spacingY) - this.spacingY));
        this.render();
    }
    private bind(node: Node, index: number): void {
        for (const component of node.getComponents(Component)) {
            const item = component as Component & Partial<ILoopItem>;
            if (item.updateItem) { item.updateItem(this.data[index], index); break; }
        }
    }
    private render(): void {
        const content = this.content, scroll = this.scrollView, prefab = this.itemPrefab;
        const trans = content?.getComponent(UITransform), viewport = scroll?.node.getComponent(UITransform);
        if (!content || !scroll || !prefab || !trans || !viewport || !this.enabledInHierarchy) return;
        const step = this.itemHeight + this.spacingY;
        const firstRow = Math.max(0, Math.floor(scroll.getScrollOffset().y / step) - this.buffer);
        const count = Math.ceil(viewport.height / step) + this.buffer * 2 + 1;
        if (count * this.columnCount > 2000) throw new Error('Virtual grid visibility limit exceeded');
        const first = Math.min(this.data.length, firstRow * this.columnCount);
        const end = Math.min(this.data.length, (firstRow + count) * this.columnCount);
        for (const [index, node] of this.visible) if (index < first || index >= end) {
            node.active = false; this.idle.push(node); this.visible.delete(index);
        }
        for (let i = first; i < end; i++) if (!this.visible.has(i)) {
            const node = this.idle.pop() ?? instantiate(prefab); node.setParent(content);
            node.setPosition(-trans.width / 2 + this.itemWidth / 2 + (i % this.columnCount) * (this.itemWidth + this.spacingX),
                -Math.floor(i / this.columnCount) * step - this.itemHeight / 2, 0);
            this.bind(node, i); node.active = true; this.visible.set(i, node);
        }
        const retained = Math.min(this.data.length, count * this.columnCount);
        while (this.idle.length + this.visible.size > retained && this.idle.length) this.idle.pop()!.destroy();
    }
    refreshAllItems(): void { for (const [i, node] of this.visible) this.bind(node, i); }
    protected onDestroy(): void { for (const node of this.idle) node.destroy(); for (const node of this.visible.values()) node.destroy(); this.idle = []; this.visible.clear(); }
}
