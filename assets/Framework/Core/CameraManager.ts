import { Camera, Node, Vec3, UITransform } from 'cc';
/** Project supplies cameras; this service does not change visibility masks or scene hierarchy. */
export class CameraManager {
    private static instance = new CameraManager();
    static get Instance(): CameraManager { return this.instance; }
    mainCamera: Camera | null = null;
    uiCamera: Camera | null = null;
    uiCanvasNode: Node | null = null;
    init(options: { main?: Camera; ui?: Camera; canvas?: Node } = {}): void {
        this.mainCamera = options.main ?? null; this.uiCamera = options.ui ?? null; this.uiCanvasNode = options.canvas ?? null;
    }
    private screen = new Vec3();
    private world = new Vec3();
    worldToUINodeSpace(position: Vec3, parent: Node, out: Vec3): boolean {
        const transform = parent.getComponent(UITransform);
        if (!transform || !this.mainCamera || !this.uiCamera) return false;
        this.mainCamera.worldToScreen(position, this.screen); this.uiCamera.screenToWorld(this.screen, this.world);
        transform.convertToNodeSpaceAR(this.world, out); return true;
    }
    dispose(): void { this.mainCamera = this.uiCamera = null; this.uiCanvasNode = null; }
}
