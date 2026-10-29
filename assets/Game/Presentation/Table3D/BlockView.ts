/**
 * 单块白膜视图：真实有厚度的 Mesh，只展示快照，不写规则状态。
 */

import { Layers, Material, Mesh, MeshRenderer, Node, Vec3 } from 'cc';
import type { BoardBlockSnapshot } from '../../Application/GameSnapshot';
import type { BlockDefinition, BlockID } from '../../Domain/BlockTypes';
import { BLOCK_3D, BLOCK_VISUALS } from '../../Config/PresentationConfig';
import type { TableProjector } from '../TableProjector';

export class BlockView {
    readonly node: Node;
    private readonly renderer: MeshRenderer;
    private readonly normalMaterial: Material;
    private readonly dimMaterial: Material;
    private readonly edgeNode: Node;
    private blockId: BlockID | null = null;

    constructor(parent: Node, mesh: Mesh, normalMaterial: Material, dimMaterial: Material, edgeMaterial: Material) {
        this.normalMaterial = normalMaterial;
        this.dimMaterial = dimMaterial;
        this.node = new Node('Tile');
        this.node.layer = Layers.Enum.DEFAULT;
        parent.addChild(this.node);
        this.renderer = this.node.addComponent(MeshRenderer);
        this.renderer.mesh = mesh;
        this.renderer.shadowCastingMode = MeshRenderer.ShadowCastingMode.OFF;
        this.renderer.receiveShadow = MeshRenderer.ShadowReceivingMode.OFF;
        this.node.setRotationFromEuler(BLOCK_3D.tiltDegrees, 0, 0);
        this.node.active = false;

        this.edgeNode = new Node('TileEdge');
        this.edgeNode.layer = Layers.Enum.DEFAULT;
        this.node.addChild(this.edgeNode);
        const edgeRenderer = this.edgeNode.addComponent(MeshRenderer);
        edgeRenderer.mesh = mesh;
        edgeRenderer.shadowCastingMode = MeshRenderer.ShadowCastingMode.OFF;
        edgeRenderer.receiveShadow = MeshRenderer.ShadowReceivingMode.OFF;
        edgeRenderer.setSharedMaterial(edgeMaterial, 0);
        this.edgeNode.setScale(new Vec3(1.06, 1.05, 0.9));
        this.edgeNode.setPosition(0, 0, -0.05);
    }

    bind(blockId: BlockID, definition: BlockDefinition): void {
        this.blockId = blockId;
        this.node.name = 'Tile-' + blockId + '-' + definition.kind;
    }

    render(entry: BoardBlockSnapshot, projector: TableProjector): void {
        if (this.blockId === null) throw new Error('BlockView.render called before bind');
        this.node.active = true;
        this.edgeNode.active = entry.selectable;
        const designWidth = entry.definition.cards.length === 2 ? BLOCK_VISUALS.doubleWidth : BLOCK_VISUALS.singleWidth;
        const width = projector.logicalToWorldScale(designWidth);
        const height = projector.logicalToWorldScale(BLOCK_VISUALS.height);
        const depth = projector.logicalToWorldScale(BLOCK_3D.thickness);
        const layerSpacing = projector.logicalToWorldScale(BLOCK_3D.layerSpacing);
        const art = projector.logicalToArt(entry.placement.x, entry.placement.y);
        const world = projector.designToWorld(
            art.x,
            art.y,
            (entry.placement.layer - 1) * layerSpacing,
        );
        this.node.setPosition(world.x, world.y, world.z);
        this.node.setScale(new Vec3(width, height, depth));
        this.renderer.setSharedMaterial(entry.selectable ? this.normalMaterial : this.dimMaterial, 0);
    }

    reset(): void {
        this.node.active = false;
        this.edgeNode.active = false;
    }

    dispose(): void {
        this.node.destroy();
    }
}
