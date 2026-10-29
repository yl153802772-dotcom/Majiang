/**
 * 终局覆盖弹层：阻断牌桌输入，显示胜负原因并提供重开。
 */

import { BlockInputEvents, Graphics, Label, Node } from 'cc';
import type { GameSnapshot } from '../../Application/GameSnapshot';
import { COLORS } from '../../Config/PresentationConfig';
import type { TableProjector } from '../TableProjector';
import {
    createGraphicsNode,
    createLabelNode,
    createTextButton,
    createUiNode,
    drawPanel,
    hexColor,
    placeAtDesign,
} from './HudView';

export class ResultView {
    private readonly root: Node;
    private readonly projector: TableProjector;
    private readonly title: Label;
    private readonly detail: Label;
    private readonly stats: Label;

    constructor(parent: Node, projector: TableProjector, onRestart: () => void) {
        this.projector = projector;
        this.root = createUiNode(parent, 'ResultView', 720, 1280);
        this.root.addComponent(BlockInputEvents);
        const shade = createGraphicsNode(this.root, 'ResultShade', 720, 1280);
        const shadeColor = hexColor(COLORS.background);
        shadeColor.a = 224;
        shade.fillColor = shadeColor;
        shade.rect(-360, -640, 720, 1280);
        shade.fill();
        shade.node.setPosition(0, 0, 0);

        const panel = createGraphicsNode(this.root, 'ResultPanel', 560, 330);
        drawPanel(panel, 560, 330, COLORS.panel, COLORS.panelEdge, 18);
        placeAtDesign(projector, panel.node, 360, 640);

        this.title = createLabelNode(this.root, 'ResultTitle', '', 42, hexColor(COLORS.text), 500, 62);
        placeAtDesign(projector, this.title.node, 360, 552);
        this.detail = createLabelNode(this.root, 'ResultDetail', '', 20, hexColor(COLORS.textDim), 500, 34);
        placeAtDesign(projector, this.detail.node, 360, 632);
        this.stats = createLabelNode(this.root, 'ResultStats', '', 16, hexColor(COLORS.textDim), 500, 46);
        placeAtDesign(projector, this.stats.node, 360, 682);

        createTextButton(this.root, projector, 'ResultRestart', '重开', 360, 750, 150, 48, onRestart);
        this.root.active = false;
    }

    show(snapshot: GameSnapshot): void {
        const won = snapshot.terminal?.outcome === 'Won';
        this.title.string = won ? '通关' : '失败';
        this.title.color = hexColor(won ? COLORS.resultWin : COLORS.resultLost);
        this.detail.string = won ? '桌面与底槽已清空' : '底槽稳定满七格，立即失败';
        this.stats.string = `副牌 ${snapshot.melds.length}/4 · 占位 ${snapshot.occupiedSlots}/7 · 用时 ${snapshot.revision} 步`;
        this.root.active = true;
        this.root.setSiblingIndex(this.root.parent ? this.root.parent.children.length - 1 : 0);
    }

    hide(): void {
        this.root.active = false;
    }

    get node(): Node {
        return this.root;
    }

    dispose(): void {
        this.root.destroy();
    }
}
