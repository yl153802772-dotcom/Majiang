/**
 * 2D HUD：标题、阶段、副牌/占位计数、重开、提示与 TouchEnd 指标。
 * 只读快照，不计算规则。
 */

import { Color, Graphics, Label, Layers, Node, UITransform } from 'cc';
import type { Card } from '../../Domain/CardTypes';
import type { GameSnapshot } from '../../Application/GameSnapshot';
import { COLORS, UI_LAYOUT } from '../../Config/PresentationConfig';
import type { TableProjector } from '../TableProjector';

export function hexColor(hex: string): Color {
    return new Color().fromHEX(hex);
}

export function applyUiLayer(node: Node): void {
    node.layer = Layers.Enum.UI_2D;
    for (const child of node.children) applyUiLayer(child);
}

export function createUiNode(parent: Node, name: string, width = 0, height = 0): Node {
    const node = new Node(name);
    node.layer = Layers.Enum.UI_2D;
    parent.addChild(node);
    if (width > 0 || height > 0) {
        const transform = node.addComponent(UITransform);
        transform.setContentSize(width || 1, height || 1);
    }
    return node;
}

export function createLabelNode(
    parent: Node,
    name: string,
    text: string,
    fontSize: number,
    color: Color,
    width: number,
    height: number,
): Label {
    const node = createUiNode(parent, name, width, height);
    const label = node.addComponent(Label);
    label.string = text;
    label.fontSize = fontSize;
    label.lineHeight = Math.ceil(fontSize * 1.18);
    label.color = color;
    label.fontFamily = 'Arial';
    label.horizontalAlign = Label.HorizontalAlign.CENTER;
    label.verticalAlign = Label.VerticalAlign.CENTER;
    label.overflow = Label.Overflow.SHRINK;
    label.enableWrapText = false;
    return label;
}

export function createGraphicsNode(parent: Node, name: string, width: number, height: number): Graphics {
    const node = createUiNode(parent, name, width, height);
    return node.addComponent(Graphics);
}

export function drawPanel(
    graphics: Graphics,
    width: number,
    height: number,
    fillHex: string,
    strokeHex: string | null,
    radius: number,
): void {
    graphics.clear();
    graphics.fillColor = hexColor(fillHex);
    graphics.roundRect(-width / 2, -height / 2, width, height, radius);
    graphics.fill();
    if (strokeHex) {
        graphics.strokeColor = hexColor(strokeHex);
        graphics.lineWidth = 2;
        graphics.roundRect(-width / 2, -height / 2, width, height, radius);
        graphics.stroke();
    }
}

export function suitGlyph(card: Card): string {
    if (card.suit === 'wan') return '万';
    if (card.suit === 'tong') return '筒';
    return '条';
}

export function cardText(card: Card): string {
    return String(card.rank) + suitGlyph(card);
}

export function cardColor(card: Card): Color {
    if (card.suit === 'wan') return hexColor(COLORS.wanText);
    if (card.suit === 'tong') return hexColor(COLORS.tongText);
    return hexColor(COLORS.tiaoText);
}

export function placeAtDesign(projector: TableProjector, node: Node, x: number, y: number): void {
    const local = projector.designToLocal(x, y);
    node.setPosition(local.x, local.y, 0);
}

export interface TextButton {
    readonly node: Node;
    readonly label: Label;
}

export function createTextButton(
    parent: Node,
    projector: TableProjector,
    name: string,
    text: string,
    x: number,
    y: number,
    width: number,
    height: number,
    onTap: () => void,
): TextButton {
    const node = createUiNode(parent, name, width, height);
    placeAtDesign(projector, node, x, y);
    const graphics = node.addComponent(Graphics);
    drawPanel(graphics, width, height, COLORS.panel, COLORS.panelEdge, 12);
    const label = createLabelNode(node, name + 'Label', text, 18, hexColor(COLORS.text), width, height);
    label.node.setPosition(0, 0, 0);
    node.on('touch-end', () => onTap());
    return { node, label };
}

function phaseText(snapshot: GameSnapshot): string {
    if (snapshot.phase === 'Won') return '通关';
    if (snapshot.phase === 'Lost') return '失败';
    if (snapshot.phase === 'Tenpai') return '听牌：等待将牌';
    return '凑副';
}

export class HudView {
    private readonly root: Node;
    private readonly projector: TableProjector;
    private readonly phaseLabel: Label;
    private readonly toastLabel: Label;
    private readonly metricsLabel: Label;
    private readonly restartButton: TextButton;
    private toastTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(parent: Node, projector: TableProjector, onRestart: () => void) {
        this.projector = projector;
        this.root = createUiNode(parent, 'HudView', 720, 1280);
        const title = createLabelNode(this.root, 'Title', '赛博雀神', 30, hexColor(COLORS.text), 520, 44);
        title.isBold = true;
        placeAtDesign(projector, title.node, 360, 40);
        const subtitle = createLabelNode(this.root, 'Subtitle', '七槽麻将堆叠消除', 16, hexColor(COLORS.textDim), 520, 26);
        placeAtDesign(projector, subtitle.node, 360, 76);
        this.phaseLabel = createLabelNode(this.root, 'Phase', '凑副 · 副牌 0/4 · 占位 0/7', 17, hexColor(COLORS.text), 520, 28);
        placeAtDesign(projector, this.phaseLabel.node, 360, 104);

        this.restartButton = createTextButton(
            this.root,
            projector,
            'RestartButton',
            '重开',
            UI_LAYOUT.restart.x,
            UI_LAYOUT.restart.y,
            UI_LAYOUT.restart.width,
            UI_LAYOUT.restart.height,
            onRestart,
        );

        const hint = createLabelNode(this.root, 'Hint', '单块 + 双块，凑成一副', 18, hexColor(COLORS.textDim), 620, 28);
        placeAtDesign(projector, hint.node, 360, 1174);
        const hint2 = createLabelNode(this.root, 'Hint2', '四副听牌 · 成将触发大招', 14, hexColor(COLORS.textDim), 620, 24);
        placeAtDesign(projector, hint2.node, 360, 1210);

        this.toastLabel = createLabelNode(this.root, 'Toast', '', 18, hexColor(COLORS.warn), 660, 30);
        placeAtDesign(projector, this.toastLabel.node, 360, 1138);
        this.toastLabel.node.active = false;
        this.metricsLabel = createLabelNode(this.root, 'Metrics', 'TouchEnd --', 12, hexColor(COLORS.textDim), 430, 22);
        placeAtDesign(projector, this.metricsLabel.node, 360, 1252);
    }

    render(snapshot: GameSnapshot, lastTouchMs: number | null): void {
        const stalled = snapshot.stalled ? ' · 无可行动作' : '';
        this.phaseLabel.string = `${phaseText(snapshot)} · 副牌 ${snapshot.melds.length}/4 · 占位 ${snapshot.occupiedSlots}/7${stalled}`;
        this.metricsLabel.string = lastTouchMs === null ? 'TouchEnd --' : `TouchEnd ${lastTouchMs.toFixed(1)} ms`;
    }

    setMetrics(lastTouchMs: number | null, p95Ms: number): void {
        this.metricsLabel.string = lastTouchMs === null
            ? 'TouchEnd --'
            : `TouchEnd ${lastTouchMs.toFixed(1)} ms · p95 ${p95Ms.toFixed(1)}`;
    }

    showToast(message: string): void {
        if (this.toastTimer !== null) clearTimeout(this.toastTimer);
        this.toastLabel.string = message;
        this.toastLabel.node.active = true;
        this.toastTimer = setTimeout(() => {
            this.toastLabel.node.active = false;
            this.toastTimer = null;
        }, 1200);
    }

    hideToast(): void {
        if (this.toastTimer !== null) clearTimeout(this.toastTimer);
        this.toastTimer = null;
        this.toastLabel.node.active = false;
    }

    get restartNode(): Node {
        return this.restartButton.node;
    }

    refreshLayout(): void {
        // Positions are stored in content-local coordinates; scaling is owned by the parent content root.
    }

    dispose(): void {
        this.hideToast();
        this.root.destroy();
    }
}
