/**
 * 桌面白膜层：32 个有厚度的 3D 牌块 + 2D 系统字体牌面 + 可选描边。
 * 双重表达只读快照；文字遮挡只是显示裁剪，不改变 blockedBy。
 */

import {
    Color,
    Director,
    Graphics,
    Label,
    Layers,
    Material,
    Mesh,
    Node,
    UITransform,
    UIOpacity,
    director,
    primitives,
    utils,
} from 'cc';
import { LifecycleScope } from '../../../Framework/Kernel/LifecycleScope';
import type { BoardBlockSnapshot, GameSnapshot } from '../../Application/GameSnapshot';
import type { BlockID } from '../../Domain/BlockTypes';
import { LEVEL_888 } from '../../Config/Level888';
import { BLOCK_VISUALS, COLORS } from '../../Config/PresentationConfig';
import type { TableProjector } from '../TableProjector';
import { BlockView } from './BlockView';

function colorFromHex(hex: string): Color {
    return new Color().fromHEX(hex);
}

function makeUnlitMaterial(hex: string): Material {
    const material = new Material();
    const construction = new LifecycleScope();
    const transferred = construction.track(() => material.destroy());
    try {
        material.initialize({ effectName: 'builtin-unlit' });
        material.setProperty('mainColor', colorFromHex(hex));
        transferred();
        return material;
    } catch (error) {
        return construction.rollback(error);
    }
}

export interface BoardResourceCounts {
    readonly liveMeshes: number;
    readonly liveMaterials: number;
    readonly createdMeshes: number;
    readonly createdMaterials: number;
    readonly releasedMeshes: number;
    readonly releasedMaterials: number;
}

/**
 * 场景拥有的白膜共享资源。BoardView 只使用，不负责销毁；
 * 场景 owner 在节点销毁后延迟到帧末释放，避开场景 teardown 的引擎缓存竞争。
 */
export class BoardResources {
    private static liveMeshes = 0;
    private static liveMaterials = 0;
    private static createdMeshes = 0;
    private static createdMaterials = 0;
    private static releasedMeshes = 0;
    private static releasedMaterials = 0;

    readonly mesh: Mesh;
    readonly normalMaterial: Material;
    readonly dimMaterial: Material;
    readonly edgeMaterial: Material;
    private released = false;
    private readonly lifetime = new LifecycleScope();

    constructor() {
        try {
            this.mesh = utils.MeshUtils.createMesh(primitives.box({ width: 1, height: 1, length: 1 }));
            BoardResources.liveMeshes++;
            BoardResources.createdMeshes++;
            this.lifetime.add(() => {
                if (this.mesh.isValid) this.mesh.destroy();
                BoardResources.liveMeshes--;
                BoardResources.releasedMeshes++;
            });
            this.normalMaterial = this.acquireMaterial(COLORS.blockFace);
            this.dimMaterial = this.acquireMaterial(COLORS.lockedOverlay);
            this.edgeMaterial = this.acquireMaterial(COLORS.blockEdge);
        } catch (error) {
            throw this.lifetime.rollback(error);
        }
    }

    private acquireMaterial(hex: string): Material {
        const material = makeUnlitMaterial(hex);
        BoardResources.liveMaterials++;
        BoardResources.createdMaterials++;
        this.lifetime.add(() => {
            if (material.isValid) material.destroy();
            BoardResources.liveMaterials--;
            BoardResources.releasedMaterials++;
        });
        return material;
    }

    static counts(): BoardResourceCounts {
        return {
            liveMeshes: BoardResources.liveMeshes,
            liveMaterials: BoardResources.liveMaterials,
            createdMeshes: BoardResources.createdMeshes,
            createdMaterials: BoardResources.createdMaterials,
            releasedMeshes: BoardResources.releasedMeshes,
            releasedMaterials: BoardResources.releasedMaterials,
        };
    }

    release(): void {
        if (this.released) return;
        this.released = true;
        const releaseNow = (): void => {
            try { this.lifetime.dispose(); }
            catch (error) { console.error('[R03] shared board resource cleanup failed', error); }
        };
        try {
            if (director.getScene()) director.once(Director.EVENT_END_FRAME, releaseNow);
            else releaseNow();
        } catch (error) {
            console.error('[R03] frame-end release scheduling failed; releasing now', error);
            releaseNow();
        }
    }
}

function suitGlyph(suit: string): string {
    if (suit === 'wan') return '万';
    if (suit === 'tong') return '筒';
    return '条';
}

function suitColor(suit: string): Color {
    if (suit === 'wan') return colorFromHex(COLORS.wanText);
    if (suit === 'tong') return colorFromHex(COLORS.tongText);
    return colorFromHex(COLORS.tiaoText);
}

function createFaceLabel(parent: Node, name: string): Label {
    const node = new Node(name);
    node.layer = Layers.Enum.UI_2D;
    parent.addChild(node);
    const transform = node.addComponent(UITransform);
    transform.setContentSize(60, 78);
    const label = node.addComponent(Label);
    label.string = '';
    label.fontSize = 20;
    label.lineHeight = 22;
    label.fontFamily = 'Arial';
    label.horizontalAlign = Label.HorizontalAlign.CENTER;
    label.verticalAlign = Label.VerticalAlign.CENTER;
    label.overflow = Label.Overflow.SHRINK;
    label.enableWrapText = false;
    node.addComponent(UIOpacity);
    node.active = false;
    return label;
}

function placeAtDesign(projector: TableProjector, node: Node, x: number, y: number): void {
    const local = projector.designToLocal(x, y);
    node.setPosition(local.x, local.y, 0);
}

export class BoardView {
    private readonly projector: TableProjector;
    private readonly resources: BoardResources;
    private readonly views = new Map<BlockID, BlockView>();
    private readonly labelRoot: Node;
    private readonly labels = new Map<BlockID, readonly [Label, Label]>();
    private readonly highlightRoot: Node;
    private readonly highlight: Graphics;
    private lastSnapshot: GameSnapshot | null = null;

    constructor(tableParent: Node, uiParent: Node, projector: TableProjector, resources: BoardResources) {
        this.projector = projector;
        this.resources = resources;

        for (const definition of LEVEL_888.blocks) {
            const view = new BlockView(tableParent, resources.mesh, resources.normalMaterial, resources.dimMaterial, resources.edgeMaterial);
            view.bind(definition.id, definition);
            this.views.set(definition.id, view);
        }

        this.highlightRoot = new Node('BoardHighlights');
        this.highlightRoot.layer = Layers.Enum.UI_2D;
        uiParent.addChild(this.highlightRoot);
        const highlightTransform = this.highlightRoot.addComponent(UITransform);
        highlightTransform.setContentSize(720, 1280);
        this.highlight = this.highlightRoot.addComponent(Graphics);

        this.labelRoot = new Node('BoardLabels');
        this.labelRoot.layer = Layers.Enum.UI_2D;
        uiParent.addChild(this.labelRoot);
        const labelTransform = this.labelRoot.addComponent(UITransform);
        labelTransform.setContentSize(720, 1280);
        for (const definition of LEVEL_888.blocks) {
            const first = createFaceLabel(this.labelRoot, 'Face-' + definition.id + '-0');
            const second = createFaceLabel(this.labelRoot, 'Face-' + definition.id + '-1');
            this.labels.set(definition.id, [first, second]);
        }
    }

    render(snapshot: GameSnapshot): void {
        this.lastSnapshot = snapshot;
        const boardEntries = snapshot.board;
        const entryById = new Map(boardEntries.map(entry => [entry.definition.id, entry]));

        for (const [blockId, view] of this.views) {
            const entry = entryById.get(blockId);
            if (entry) view.render(entry, this.projector);
            else view.reset();
        }
        for (const pair of this.labels.values()) {
            pair[0].node.active = false;
            pair[1].node.active = false;
        }

        const visibleLabels: Array<{ layer: number; label: Label }> = [];
        for (const entry of boardEntries) {
            const pair = this.labels.get(entry.definition.id);
            if (!pair) continue;
            const isDouble = entry.definition.cards.length === 2;
            const offsets = isDouble ? [-33, 33] : [0];
            for (let index = 0; index < entry.definition.cards.length && index < 2; index++) {
                const card = entry.definition.cards[index];
                const logicalX = entry.placement.x + offsets[index];
                const logicalY = entry.placement.y;
                if (this.isLabelOccluded(boardEntries, entry, logicalX, logicalY)) continue;
                const art = this.projector.logicalToArt(logicalX, logicalY);
                const designX = art.x;
                const designY = art.y;
                const label = pair[index];
                label.string = String(card.rank) + '\n' + suitGlyph(card.suit);
                label.color = suitColor(card.suit);
                const opacity = label.node.getComponent(UIOpacity);
                if (opacity) opacity.opacity = entry.selectable ? 255 : 150;
                label.node.active = true;
                placeAtDesign(this.projector, label.node, designX, designY);
                visibleLabels.push({ layer: entry.placement.layer, label });
            }
        }
        visibleLabels.sort((a, b) => a.layer - b.layer);
        for (let index = 0; index < visibleLabels.length; index++) {
            visibleLabels[index].label.node.setSiblingIndex(index);
        }

        this.highlight.clear();
        for (const entry of boardEntries) {
            if (!entry.selectable) continue;
            const width = entry.definition.cards.length === 2 ? BLOCK_VISUALS.doubleWidth : BLOCK_VISUALS.singleWidth;
            const art = this.projector.logicalToArt(entry.placement.x, entry.placement.y);
            const center = this.projector.designToLocal(art.x, art.y);
            this.highlight.strokeColor = colorFromHex(
                entry.highlight === 'winning-pair' ? COLORS.winningPairOutline
                    : entry.highlight === 'tenpai-match' ? COLORS.tenpaiMatchOutline
                        : COLORS.selectableOutline,
            );
            this.highlight.lineWidth = 2.5;
            this.highlight.rect(center.x - width / 2, center.y - BLOCK_VISUALS.height / 2, width, BLOCK_VISUALS.height);
            this.highlight.stroke();
        }
    }

    refreshLayout(): void {
        if (this.lastSnapshot) this.render(this.lastSnapshot);
    }

    private isLabelOccluded(
        entries: readonly BoardBlockSnapshot[],
        own: BoardBlockSnapshot,
        designX: number,
        designY: number,
    ): boolean {
        const labelRect = {
            x: designX - 30,
            y: designY - 39,
            width: 60,
            height: 78,
        };
        for (const other of entries) {
            if (other.definition.id === own.definition.id) continue;
            if (other.placement.layer <= own.placement.layer) continue;
            const cardCount = other.definition.cards.length === 2 ? 2 : 1;
            const rect = this.projector.getHitRect(other.placement.x, other.placement.y, cardCount);
            const overlaps = labelRect.x < rect.x + rect.width && labelRect.x + labelRect.width > rect.x &&
                labelRect.y < rect.y + rect.height && labelRect.y + labelRect.height > rect.y;
            if (overlaps) return true;
        }
        return false;
    }

    dispose(): void {
        for (const view of this.views.values()) view.dispose();
        this.views.clear();
        this.labelRoot.destroy();
        this.highlightRoot.destroy();
    }
}
