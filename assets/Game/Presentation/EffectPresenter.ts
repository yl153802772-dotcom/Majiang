/**
 * 非阻塞表现编排：短命飞牌替身与大招提示。
 * 只消费已提交事件；旧局/重复事件忽略，全部效果有界且可取消，不回写规则。
 */

import { Graphics, Label, Node, Tween, UITransform, Vec3, tween } from 'cc';
import type { GameEvent } from '../Application/GameEvent';
import type { GameSnapshot } from '../Application/GameSnapshot';
import type { BlockID, BlockDefinition } from '../Domain/BlockTypes';
import type { Card } from '../Domain/CardTypes';
import { LEVEL_888 } from '../Config/Level888';
import { COLORS, PHYSICS_BUDGET, TIMING, UI_LAYOUT } from '../Config/PresentationConfig';
import type { TableProjector } from './TableProjector';
import {
    cardColor,
    cardText,
    createLabelNode,
    createUiNode,
    drawPanel,
    hexColor,
} from './UI/HudView';

const MAX_GHOSTS = 12;
const SEEN_LIMIT = 512;

interface Ghost {
    readonly node: Node;
    readonly graphics: Graphics;
    readonly labels: readonly [Label, Label];
    readonly transform: UITransform;
    busy: boolean;
    tween: Tween<Node> | null;
}

function ghostWidth(cardCount: number): number {
    return cardCount === 2 ? 132 : 64;
}

function bufferTargetX(snapshot: GameSnapshot, blockId: BlockID): number {
    const entry = snapshot.buffer.find(item => item.blockId === blockId);
    if (!entry) return 360;
    const slotWidth = 88;
    const gap = 8;
    const start = 44 + entry.startSlot * 91;
    const width = entry.slotCount * 89 + (entry.slotCount - 1) * 2;
    return start + width / 2;
}

export class EffectPresenter {
    private readonly root: Node;
    private readonly projector: TableProjector;
    private readonly ghosts: Ghost[] = [];
    private readonly seenIds = new Set<string>();
    private readonly seenOrder: string[] = [];
    private readonly banner: Node;
    private readonly bannerLabel: Label;
    private bannerTimer: ReturnType<typeof setTimeout> | null = null;
    private activeSessionId = '';
    private paused = false;
    private disposed = false;

    constructor(parent: Node, projector: TableProjector, private readonly targets?: {
        buffer(snapshot: GameSnapshot, blockId: BlockID): { x: number; y: number };
        readonly meld: { x: number; y: number };
    }) {
        this.projector = projector;
        this.root = createUiNode(parent, 'EffectLayer', 720, 1280);
        for (let index = 0; index < MAX_GHOSTS; index++) {
            const node = createUiNode(this.root, 'Ghost' + index, 132, 88);
            const transform = node.getComponent(UITransform);
            if (!transform) throw new Error('Effect ghost requires UITransform');
            const graphics = node.addComponent(Graphics);
            const first = createLabelNode(node, 'GhostCard0', '', 20, hexColor(COLORS.blockText), 62, 80);
            const second = createLabelNode(node, 'GhostCard1', '', 20, hexColor(COLORS.blockText), 62, 80);
            node.active = false;
            this.ghosts.push({ node, graphics, labels: [first, second], transform, busy: false, tween: null });
        }

        this.banner = createUiNode(this.root, 'Banner', 520, 58);
        drawPanel(this.banner.addComponent(Graphics), 520, 58, COLORS.panel, COLORS.ultimate, 14);
        this.bannerLabel = createLabelNode(this.banner, 'BannerText', '', 24, hexColor(COLORS.text), 500, 54);
        this.banner.active = false;
    }

    present(events: readonly GameEvent[], snapshot: GameSnapshot): void {
        if (this.disposed) return;
        if (snapshot.sessionId !== this.activeSessionId) {
            this.cancelSession(this.activeSessionId);
            this.activeSessionId = snapshot.sessionId;
        }
        if (this.paused) return;
        for (const event of events) {
            if (event.sessionId !== snapshot.sessionId) continue;
            if (this.seenIds.has(event.eventId)) continue;
            this.seenIds.add(event.eventId);
            this.seenOrder.push(event.eventId);
            if (this.seenOrder.length > SEEN_LIMIT) {
                const expired = this.seenOrder.shift();
                if (expired) this.seenIds.delete(expired);
            }
            this.presentEvent(event, snapshot);
        }
    }

    pause(): void {
        this.paused = true;
        for (const ghost of this.ghosts) ghost.tween?.pause();
    }

    resume(): void {
        this.paused = false;
        for (const ghost of this.ghosts) ghost.tween?.resume();
    }

    cancelSession(sessionId: string): void {
        if (sessionId && sessionId !== this.activeSessionId) return;
        for (const ghost of this.ghosts) {
            ghost.tween?.stop();
            ghost.tween = null;
            ghost.busy = false;
            ghost.node.active = false;
        }
        if (this.bannerTimer !== null) clearTimeout(this.bannerTimer);
        this.bannerTimer = null;
        this.banner.active = false;
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.cancelSession(this.activeSessionId);
        this.root.destroy();
    }

    private presentEvent(event: GameEvent, snapshot: GameSnapshot): void {
        if (event.kind === 'block-selected') {
            this.flyBlock(event.payload.blockId, event.payload.from.x, event.payload.from.y,
                event.payload.finalRegion, snapshot);
            return;
        }
        if (event.kind === 'combination-resolved') {
            const text = event.payload.meld.kind === 'chi' ? '吃' : event.payload.meld.kind === 'peng' ? '碰' : '杠';
            this.showBanner(text, COLORS.selectableOutline, 420);
            return;
        }
        if (event.kind === 'ultimate-resolved') {
            const cleared = event.payload.targets.length;
            const cleanupTiles = event.payload.pairCleanup
                .reduce((total, entry) => total + entry.cards.length, 0);
            const cleanupText = cleanupTiles > 0 ? ` · 将牌同组收尾 ${cleanupTiles} 张` : '';
            const text = event.payload.fan === 'qingyise' ? `胡牌！清一色 · 大招清除 ${cleared} 组${cleanupText}`
                : event.payload.fan === 'pengpenghu' ? `胡牌！碰碰胡 · 大招清除 ${cleared} 组${cleanupText}`
                    : `胡牌！平胡 · 大招清除 ${cleared} 组${cleanupText}`;
            this.showBanner(text, COLORS.ultimate, TIMING.ultimateBurstMs + 900);
            for (const target of event.payload.targets) {
                for (const block of target.blocks) {
                    this.flashTarget(block.definition.cards.length === 2 ? block.definition.id : block.definition.id,
                        block.definition.cards.map(card => cardText(card)), block.placement.x, block.placement.y);
                }
            }
        }
    }

    private flyBlock(
        blockId: BlockID,
        fromX: number,
        fromY: number,
        finalRegion: 'buffer' | 'meld' | 'removed',
        snapshot: GameSnapshot,
    ): void {
        const definition = LEVEL_888.blocks.find(block => block.id === blockId);
        if (!definition) return;
        const target = finalRegion === 'buffer' ? this.targets?.buffer(snapshot, blockId)
            : finalRegion === 'meld' ? this.targets?.meld : undefined;
        const targetX = target?.x ?? (finalRegion === 'buffer' ? bufferTargetX(snapshot, blockId) : 360);
        const targetY = target?.y ?? (finalRegion === 'buffer' ? 947 : finalRegion === 'meld' ? 239 : 640);
        this.runGhost(
            definition.cards.map(card => cardText(card)),
            fromX,
            fromY,
            targetX,
            targetY,
            definition.cards.length === 2 ? 132 : 64,
            TIMING.moveMs + TIMING.fadeMs,
            COLORS.blockFace,
        );
    }

    private flashTarget(id: BlockID, texts: readonly string[], x: number, y: number): void {
        if (!id) return;
        this.runGhost(texts, x, y, x, y, texts.length === 2 ? 132 : 64, TIMING.ultimateBurstMs, COLORS.panel);
    }

    private runGhost(
        texts: readonly string[],
        fromX: number,
        fromY: number,
        targetX: number,
        targetY: number,
        width: number,
        durationMs: number,
        fillHex: string,
    ): void {
        const ghost = this.ghosts.find(entry => !entry.busy);
        if (!ghost) return;
        ghost.busy = true;
        ghost.node.active = true;
        ghost.transform.setContentSize(width, 88);
        drawPanel(ghost.graphics, width, 88, fillHex, COLORS.blockEdge, 8);
        for (let index = 0; index < 2; index++) {
            const label = ghost.labels[index];
            const text = texts[index];
            if (!text) {
                label.node.active = false;
                continue;
            }
            label.node.active = true;
            label.string = text;
            const definition = LEVEL_888.blocks.find((block: BlockDefinition) =>
                block.cards.some((card: Card) => cardText(card) === text));
            label.color = definition ? cardColor(definition.cards[0]) : hexColor(COLORS.blockText);
            label.node.setPosition(index === 0 && texts.length === 1 ? 0 : index === 0 ? -33 : 33, 0, 0);
        }
        const startArt = this.projector.logicalToArt(fromX, fromY);
        const start = this.projector.designToLocal(startArt.x, startArt.y);
        const end = this.projector.designToLocal(targetX, targetY);
        ghost.node.setPosition(start.x, start.y, 0);
        ghost.node.setScale(new Vec3(1, 1, 1));
        ghost.tween?.stop();
        ghost.tween = tween(ghost.node)
            .to(durationMs / 1000, { position: new Vec3(end.x, end.y, 0), scale: new Vec3(0.82, 0.82, 1) })
            .call(() => {
                ghost.node.active = false;
                ghost.busy = false;
                ghost.tween = null;
            })
            .start();
    }

    private showBanner(text: string, colorHex: string, durationMs: number): void {
        if (this.bannerTimer !== null) clearTimeout(this.bannerTimer);
        this.bannerLabel.string = text;
        this.bannerLabel.color = hexColor(colorHex);
        const design = this.projector.designToLocal(360, 806);
        this.banner.setPosition(design.x, design.y, 0);
        this.banner.active = true;
        this.banner.setSiblingIndex(this.root.children.length - 1);
        this.bannerTimer = setTimeout(() => {
            this.banner.active = false;
            this.bannerTimer = null;
        }, Math.min(durationMs, PHYSICS_BUDGET.effectTimeoutMs));
    }
}
