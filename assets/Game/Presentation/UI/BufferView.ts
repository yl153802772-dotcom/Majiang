/**
 * 七槽 2D 表达：连续格位、单块 1 格、双块连续 2 格，绝不生成第八格。
 */

import { Graphics, Label, Node, UITransform } from 'cc';
import type { GameSnapshot } from '../../Application/GameSnapshot';
import { COLORS, UI_LAYOUT } from '../../Config/PresentationConfig';
import type { TableProjector } from '../TableProjector';
import {
    cardColor,
    cardText,
    createGraphicsNode,
    createLabelNode,
    createUiNode,
    drawPanel,
    hexColor,
    placeAtDesign,
} from './HudView';

const SLOT_WIDTH = 88;
const SLOT_GAP = 8;
const SLOT_HEIGHT = 78;
const START_X = 28;
const SLOT_CENTER_Y = 1068;

function slotCenterX(slot: number): number {
    return START_X + SLOT_WIDTH / 2 + slot * (SLOT_WIDTH + SLOT_GAP);
}

function bufferCenterX(startSlot: number, slotCount: number): number {
    const first = START_X + startSlot * (SLOT_WIDTH + SLOT_GAP);
    const width = slotCount * SLOT_WIDTH + (slotCount - 1) * SLOT_GAP;
    return first + width / 2;
}

interface BufferBlockNode {
    readonly node: Node;
    readonly graphics: Graphics;
    readonly labels: readonly [Label, Label];
    readonly transform: UITransform;
}

export class BufferView {
    private readonly root: Node;
    private readonly projector: TableProjector;
    private readonly countLabel: Label;
    private readonly blocks: BufferBlockNode[] = [];

    constructor(parent: Node, projector: TableProjector) {
        this.projector = projector;
        this.root = createUiNode(parent, 'BufferView', 720, 1280);
        this.countLabel = createLabelNode(
            this.root,
            'BufferCount',
            '底槽 0/7',
            16,
            hexColor(COLORS.textDim),
            300,
            26,
        );
        placeAtDesign(projector, this.countLabel.node, 360, 1000);

        for (let index = 0; index < UI_LAYOUT.bufferSlots; index++) {
            const slot = createGraphicsNode(this.root, 'BufferSlot' + index, SLOT_WIDTH, SLOT_HEIGHT);
            drawPanel(slot, SLOT_WIDTH, SLOT_HEIGHT, COLORS.slot, COLORS.slotEdge, 10);
            placeAtDesign(projector, slot.node, slotCenterX(index), SLOT_CENTER_Y);
        }

        for (let index = 0; index < UI_LAYOUT.bufferSlots; index++) {
            const node = createUiNode(this.root, 'BufferBlock' + index, SLOT_WIDTH, 72);
            const transform = node.getComponent(UITransform);
            if (!transform) throw new Error('Buffer block requires UITransform');
            const graphics = node.addComponent(Graphics);
            const first = createLabelNode(node, 'Card1', '', 24, hexColor(COLORS.blockText), 82, 68);
            const second = createLabelNode(node, 'Card2', '', 24, hexColor(COLORS.blockText), 82, 68);
            first.node.setPosition(0, 0, 0);
            second.node.setPosition(0, 0, 0);
            this.blocks.push({ node, graphics, labels: [first, second], transform });
            node.active = false;
        }
    }

    render(snapshot: GameSnapshot): void {
        this.countLabel.string = `底槽 ${snapshot.occupiedSlots}/7`;
        for (let index = 0; index < this.blocks.length; index++) {
            const block = this.blocks[index];
            const entry = snapshot.buffer[index];
            if (!entry) {
                block.node.active = false;
                continue;
            }
            block.node.active = true;
            const width = entry.slotCount * SLOT_WIDTH + (entry.slotCount - 1) * SLOT_GAP;
            block.transform.setContentSize(width, SLOT_HEIGHT - 4);
            drawPanel(block.graphics, width, SLOT_HEIGHT - 4, COLORS.blockFace, COLORS.blockEdge, 8);
            placeAtDesign(this.projector, block.node, bufferCenterX(entry.startSlot, entry.slotCount), SLOT_CENTER_Y);
            const firstCard = entry.cards[0];
            block.labels[0].string = cardText(firstCard);
            block.labels[0].color = cardColor(firstCard);
            if (entry.slotCount === 2 && entry.cards[1]) {
                const secondCard = entry.cards[1];
                block.labels[1].node.active = true;
                block.labels[1].string = cardText(secondCard);
                block.labels[1].color = cardColor(secondCard);
                block.labels[0].node.setPosition(-(SLOT_WIDTH + SLOT_GAP) / 2, 0, 0);
                block.labels[1].node.setPosition((SLOT_WIDTH + SLOT_GAP) / 2, 0, 0);
            } else {
                block.labels[0].node.setPosition(0, 0, 0);
                block.labels[1].node.active = false;
            }
        }
    }

    dispose(): void {
        this.root.destroy();
    }
}
