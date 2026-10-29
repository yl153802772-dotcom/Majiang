import { _decorator, Camera, Component, Node, UITransform, view } from 'cc';
import { ViewportService } from '../../../Framework/Core/ViewportService';

const { ccclass, property } = _decorator;

/** 仅用于 UI-SKY-02 独立美术预览；节点及资源引用均保存在场景/预制体中。 */
@ccclass('SkyWhitePreview')
export class SkyWhitePreview extends Component {
    @property(Node) safeContentRoot: Node | null = null;
    @property(Node) backgroundImage: Node | null = null;
    @property(Node) backgroundCanvas: Node | null = null;
    @property(Node) overlayCanvas: Node | null = null;
    @property(Camera) backgroundCamera: Camera | null = null;
    @property(Camera) boardCamera: Camera | null = null;
    @property(Camera) overlayCamera: Camera | null = null;

    private viewport: ViewportService | null = null;
    private unsubscribe: (() => void) | null = null;

    protected onEnable(): void {
        const viewport = this.viewport = new ViewportService({ width: 720, height: 1280 });
        this.unsubscribe = viewport.subscribe(() => this.refreshLayout());
        try {
            viewport.start();
            console.info('[UI-SKY-02] 独立美术预览；第一/第三层，第二层未接入；按钮禁用，示例数字非游戏数据。');
        } catch (error) {
            this.releaseViewport();
            throw error;
        }
    }

    private refreshLayout(): void {
        const viewport = this.viewport;
        if (!viewport || !this.safeContentRoot || !this.backgroundImage) return;
        const state = viewport.snapshot;
        const width = state.physicalWidth / view.getScaleX();
        const height = state.physicalHeight / view.getScaleY();
        viewport.applyContent(this.safeContentRoot);
        for (const canvas of [this.backgroundCanvas, this.overlayCanvas]) {
            canvas?.getComponent(UITransform)?.setContentSize(width, height);
        }
        for (const camera of [this.backgroundCamera, this.boardCamera, this.overlayCamera]) {
            if (camera) camera.orthoHeight = height / 2;
        }
        // 背景独立 cover，核心按同一套 ViewportService 保持完整且等比。
        const cover = Math.max(width / 940, height / 1672);
        this.backgroundImage.setScale(cover, cover, 1);
        console.info(`[UI-SKY-02] viewport=${width}x${height}, coreScale=${viewport.snapshot.ui.scale}`);
    }

    private releaseViewport(): void {
        this.unsubscribe?.();
        this.unsubscribe = null;
        this.viewport?.dispose();
        this.viewport = null;
    }

    protected onDisable(): void { this.releaseViewport(); }
    protected onDestroy(): void { this.releaseViewport(); }
}
