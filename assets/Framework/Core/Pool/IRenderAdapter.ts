import { Node, RigidBody, SkeletalAnimation, Vec3 } from 'cc';
export interface IRenderAdapter { resetInstance(node: Node): void; disposeInstance(node: Node): void; }
/** Authored materials/colors are preserved. Projects may supply a specialized adapter. */
export class SpriteRenderAdapter implements IRenderAdapter {
    resetInstance(_node: Node): void {}
    disposeInstance(_node: Node): void {}
}
export class MeshRenderAdapter implements IRenderAdapter {
    resetInstance(node: Node): void {
        for (const body of node.getComponentsInChildren(RigidBody)) {
            body.clearForces(); body.setLinearVelocity(Vec3.ZERO); body.setAngularVelocity(Vec3.ZERO);
        }
        for (const animation of node.getComponentsInChildren(SkeletalAnimation)) animation.stop();
    }
    disposeInstance(_node: Node): void {}
}
