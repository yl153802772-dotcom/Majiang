/**
 * 四副计番区 2D 表达：显示吃/碰/杠类型与全部牌面，杠保留四张。
 */

import { Graphics, Label, Node, UITransform } from 'cc';
import type { GameSnapshot } from '../../Application/GameSnapshot';
import type { MeldRecord } from '../../Domain/GameState';
import { COLORS } from '../../Config/PresentationConfig';
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

const PANEL_WIDTH = 160;
const PANEL_HEIGHT = 108;
const PANEL_GAP = 12;
const PANEL_Y = 900;

interface MeldPanel {
    readonly node: Node;
    readonly graphics: Graphics;
    readonly kindLabel: Label;
    readonly cardLabels: readonly Label[];
}

function panelCenterX(index: number): number {
    const total = 4 * PANEL_WIDTH + 3 * PANEL_GAP;
    const start = (720 - total) / 2;
    return start + PANEL_WIDTH / 2 + index * (PANEL_WIDTH + PANEL_GAP);
}

function meldKindText(meld: MeldRecord): string {
    if (meld.kind === 'chi') return '吃';
    if (meld.kind === 'peng') return '碰';
    return '杠';
}

export class MeldView {
    private readonly root: Node;
    private readonly projector: TableProjector;
    private readonly panels: MeldPanel[] = [];

    constructor(parent: Node, projector: TableProjector) {
        this.projector = projector;
        this.root = createUiNode(parent, 'MeldView', 720, 1280);
        for (let index = 0; index < 4; index++) {
            const node = createUiNode(this.root, 'MeldPanel' + index, PANEL_WIDTH, PANEL_HEIGHT);
            const transform = node.getComponent(UITransform);
            if (!transform) throw new Error('Meld panel requires UITransform');
            const graphics = node.addComponent(Graphics);
            const kindLabel = createLabelNode(node, 'MeldKind', `副牌 ${index + 1}`, 15, hexColor(COLORS.textDim), 150, 24);
            kindLabel.node.setPosition(0, 36, 0);
            const cardLabels: Label[] = [];
            for (let cardIndex = 0; cardIndex < 4; cardIndex++) {
                const label = createLabelNode(node, 'MeldCard' + cardIndex, '', 18, hexColor(COLORS.blockText), 38, 54);
                label.node.setPosition(-54 + cardIndex * 36, -16, 0);
                label.node.active = false;
                cardLabels.push(label);
            }
            this.panels.push({ node, graphics, kindLabel, cardLabels });
        }
    }

    render(snapshot: GameSnapshot): void {
        for (let index = 0; index < this.panels.length; index++) {
            const panel = this.panels[index];
            placeAtDesign(this.projector, panel.node, panelCenterX(index), PANEL_Y);
            const meld = snapshot.melds[index];
            if (!meld) {
                drawPanel(panel.graphics, PANEL_WIDTH, PANEL_HEIGHT, COLORS.panel, COLORS.panelEdge, 10);
                panel.kindLabel.string = `副牌 ${index + 1}`;
                panel.kindLabel.color = hexColor(COLORS.textDim);
                panel.kindLabel.node.setPosition(0, 0, 0);
                for (const label of panel.cardLabels) label.node.active = false;
                continue;
            }
            drawPanel(panel.graphics, PANEL_WIDTH, PANEL_HEIGHT, COLORS.panel, COLORS.ultimate, 10);
            panel.kindLabel.string = meldKindText(meld);
            panel.kindLabel.color = hexColor(COLORS.text);
            panel.kindLabel.node.setPosition(0, 36, 0);
            const count = meld.cards.length;
            const spacing = count === 4 ? 36 : 40;
            const start = -((count - 1) * spacing) / 2;
            for (let cardIndex = 0; cardIndex < panel.cardLabels.length; cardIndex++) {
                const label = panel.cardLabels[cardIndex];
                const card = meld.cards[cardIndex];
                if (!card) {
                    label.node.active = false;
                    continue;
                }
                label.node.active = true;
                label.string = cardText(card);
                label.color = cardColor(card);
                label.node.setPosition(start + cardIndex * spacing, -16, 0);
            }
        }
    }

    dispose(): void {
        this.root.destroy();
    }
}
