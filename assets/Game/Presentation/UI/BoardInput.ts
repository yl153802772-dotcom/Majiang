/**
 * 单一触摸入口：首触点、滑动取消、多指忽略、设计矩形命中与 TouchEnd 链路计时。
 * 不实现规则；命中后只提交一个完整 BlockID 给会话。
 */

import type { BlockID } from '../../Domain/BlockTypes';
import type { CommandResult } from '../../Application/GameSession';
import type { GameSnapshot } from '../../Application/GameSnapshot';
import type { RejectReason } from '../../Application/GameCommand';
import type { ContentPoint, TableProjector } from '../TableProjector';

export interface TouchPointLike {
    readonly x: number;
    readonly y: number;
}

export interface TouchLike {
    getUILocation(out?: TouchPointLike): TouchPointLike;
    getID(): number | null;
}

export interface TouchTargetLike {
    readonly isValid?: boolean;
    on(type: string, callback: (event: TouchLike) => void): void;
    off(type: string, callback: (event: TouchLike) => void): void;
}

export interface TouchSample {
    readonly blockId: BlockID;
    readonly accepted: boolean;
    readonly reason: RejectReason | null;
    readonly virtualInsert: boolean;
    readonly elapsedMs: number;
}

export interface TouchMetrics {
    readonly count: number;
    readonly p95Ms: number;
    readonly maxMs: number;
    readonly lastMs: number;
}

export interface BoardInputOptions {
    readonly projector: TableProjector;
    readonly getSnapshot: () => GameSnapshot;
    readonly onSelect: (blockId: BlockID) => CommandResult;
    readonly onReject?: (reason: RejectReason) => void;
    readonly onSample?: (sample: TouchSample) => void;
    readonly now?: () => number;
}

const SLIDE_CANCEL_DESIGN = 12;
const MAX_SAMPLES = 256;

function defaultNow(): number {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export class BoardInput {
    private readonly projector: TableProjector;
    private readonly getSnapshot: () => GameSnapshot;
    private readonly onSelect: (blockId: BlockID) => CommandResult;
    private readonly onReject?: (reason: RejectReason) => void;
    private readonly onSample?: (sample: TouchSample) => void;
    private readonly clock: () => number;
    private node: TouchTargetLike | null = null;
    private enabled = true;
    private activeId: number | null = null;
    private startDesign: ContentPoint | null = null;
    private startSessionId: string | null = null;
    private moved = false;
    private readonly samples: TouchSample[] = [];

    private readonly startHandler = (event: TouchLike): void => this.onTouchStart(event);
    private readonly moveHandler = (event: TouchLike): void => this.onTouchMove(event);
    private readonly endHandler = (event: TouchLike): void => this.onTouchEnd(event);
    private readonly cancelHandler = (event: TouchLike): void => this.onTouchCancel(event);

    constructor(options: BoardInputOptions) {
        this.projector = options.projector;
        this.getSnapshot = options.getSnapshot;
        this.onSelect = options.onSelect;
        this.onReject = options.onReject;
        this.onSample = options.onSample;
        this.clock = options.now ?? defaultNow;
    }

    attach(node: TouchTargetLike): void {
        if (this.node === node) return;
        this.detach();
        this.node = node;
        node.on('touch-start', this.startHandler);
        node.on('touch-move', this.moveHandler);
        node.on('touch-end', this.endHandler);
        node.on('touch-cancel', this.cancelHandler);
    }

    detach(): void {
        if (!this.node || this.node.isValid === false) { this.node = null; return; }
        if (typeof this.node.off !== 'function') { this.node = null; return; }
        this.node.off('touch-start', this.startHandler);
        this.node.off('touch-move', this.moveHandler);
        this.node.off('touch-end', this.endHandler);
        this.node.off('touch-cancel', this.cancelHandler);
        this.node = null;
        this.cancelGesture();
    }

    setEnabled(enabled: boolean): void {
        this.enabled = enabled;
        if (!enabled) this.cancelGesture();
    }

    /** 重开/暂停/终局/卸载时取消旧手势；旧手指松开不得提交到新局。 */
    cancelGesture(): void {
        this.activeId = null;
        this.startDesign = null;
        this.startSessionId = null;
        this.moved = false;
    }

    get lastSample(): TouchSample | null {
        return this.samples.length === 0 ? null : this.samples[this.samples.length - 1];
    }

    getMetrics(): TouchMetrics {
        if (this.samples.length === 0) return { count: 0, p95Ms: 0, maxMs: 0, lastMs: 0 };
        const values = this.samples.map(sample => sample.elapsedMs).sort((a, b) => a - b);
        const index = Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * 0.95) - 1));
        return {
            count: values.length,
            p95Ms: values[index],
            maxMs: values[values.length - 1],
            lastMs: this.samples[this.samples.length - 1].elapsedMs,
        };
    }

    getSamples(): readonly TouchSample[] {
        return Array.from(this.samples);
    }

    private onTouchStart(event: TouchLike): void {
        if (!this.enabled || this.activeId !== null) return;
        const id = event.getID();
        if (id === null) return;
        this.activeId = id;
        this.startSessionId = this.getSnapshot().sessionId;
        const ui = event.getUILocation();
        this.startDesign = this.projector.uiToDesign(ui.x, ui.y);
        this.moved = false;
    }

    private onTouchMove(event: TouchLike): void {
        if (!this.enabled || this.startDesign === null || event.getID() !== this.activeId) return;
        if (this.startSessionId !== this.getSnapshot().sessionId) {
            this.cancelGesture();
            return;
        }
        const ui = event.getUILocation();
        const design = this.projector.uiToDesign(ui.x, ui.y);
        const dx = design.x - this.startDesign.x;
        const dy = design.y - this.startDesign.y;
        if (dx * dx + dy * dy > SLIDE_CANCEL_DESIGN * SLIDE_CANCEL_DESIGN) this.moved = true;
    }

    private onTouchEnd(event: TouchLike): void {
        // 完整链路计时从 TouchEnd 回调入口开始，包含坐标转换、命中、事务和拒绝提示。
        const startedAt = this.clock();
        if (event.getID() !== this.activeId) return;
        const startDesign = this.startDesign;
        const startSessionId = this.startSessionId;
        const movedBeforeEnd = this.moved;
        this.cancelGesture();
        if (!this.enabled || startDesign === null || startSessionId === null || movedBeforeEnd) return;
        if (startSessionId !== this.getSnapshot().sessionId) return;

        const ui = event.getUILocation();
        const design = this.projector.uiToDesign(ui.x, ui.y);
        const dx = design.x - startDesign.x;
        const dy = design.y - startDesign.y;
        if (dx * dx + dy * dy > SLIDE_CANCEL_DESIGN * SLIDE_CANCEL_DESIGN) return;
        const logical = this.projector.viewportSnapshot
            ? this.projector.artToLogical(design.x, design.y)
            : design;

        const hit = this.hitTest(logical.x, logical.y);
        if (!hit) return;
        const result = this.onSelect(hit);
        if (!result.accepted) this.onReject?.(result.reason);
        const elapsedMs = this.clock() - startedAt;
        let virtualInsert = false;
        if (result.accepted) {
            const selected = result.events.find(eventEntry => eventEntry.kind === 'block-selected');
            if (selected && selected.kind === 'block-selected') virtualInsert = selected.payload.virtualInsert;
        }
        const sample: TouchSample = {
            blockId: hit,
            accepted: result.accepted,
            reason: result.accepted ? null : result.reason,
            virtualInsert,
            elapsedMs,
        };
        if (this.samples.length >= MAX_SAMPLES) this.samples.shift();
        this.samples.push(sample);
        this.onSample?.(sample);
    }

    private onTouchCancel(event: TouchLike): void {
        if (event.getID() !== this.activeId) return;
        this.cancelGesture();
    }

    private hitTest(designX: number, designY: number): BlockID | null {
        const snapshot = this.getSnapshot();
        const matches = snapshot.board.filter(block => {
            const cardCount = block.definition.cards.length === 2 ? 2 : 1;
            const rect = this.projector.getHitRect(block.placement.x, block.placement.y, cardCount);
            return this.projector.containsDesignPoint(rect, designX, designY);
        });
        if (matches.length === 0) return null;
        matches.sort((a, b) => {
            if (a.placement.layer !== b.placement.layer) return b.placement.layer - a.placement.layer;
            if (a.definition.id === b.definition.id) return 0;
            return a.definition.id < b.definition.id ? -1 : 1;
        });
        return matches[0].definition.id;
    }
}
