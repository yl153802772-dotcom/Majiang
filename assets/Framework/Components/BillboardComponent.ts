import { _decorator, Component, Vec3, Camera, Quat } from 'cc';
const { ccclass, property } = _decorator;
@ccclass('BillboardComponent')
export class BillboardComponent extends Component {
    @property(Camera) targetCamera: Camera | null = null;
    @property lockY = false;
    @property(Vec3) offsetEuler = new Vec3();
    private target = new Vec3();
    private offset = new Quat();
    private rotation = new Quat();
    protected lateUpdate(): void {
        if (!this.targetCamera?.node.isValid) return;
        this.target.set(this.targetCamera.node.worldPosition);
        if (this.lockY) this.target.y = this.node.worldPosition.y;
        if (Vec3.squaredDistance(this.target, this.node.worldPosition) < 0.000001) return;
        this.node.lookAt(this.target);
        if (this.offsetEuler.lengthSqr()) {
            Quat.fromEuler(this.offset, this.offsetEuler.x, this.offsetEuler.y, this.offsetEuler.z);
            Quat.multiply(this.rotation, this.node.worldRotation, this.offset); this.node.setWorldRotation(this.rotation);
        }
    }
}
