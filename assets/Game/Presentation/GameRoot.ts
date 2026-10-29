/**
 * 场景级游戏根：唯一订阅快照/事件，驱动 3D 牌桌、2D UI、输入和短命效果。
 * 重开只重建 Round 表现，不重建 GameSession 或 App。
 */

import { BlockInputEvents, Camera, Color, Graphics, Layers, Node, UITransform, screen, sys, view } from 'cc';
import { LifecycleScope } from '../../Framework/Kernel/LifecycleScope';
import type { ViewportService } from '../../Framework/Core/ViewportService';
import type { PauseController } from '../../Framework/Kernel/PauseController';
import type { AcceptedCommand, CommandResult, GameSession } from '../Application/GameSession';
import type { GameSnapshot } from '../Application/GameSnapshot';
import type { RejectReason } from '../Application/GameCommand';
import type { BlockID } from '../Domain/BlockTypes';
import { DESIGN_SIZE, TIMING } from '../Config/PresentationConfig';
import { TableProjector } from './TableProjector';
import { BoardResources, BoardView } from './Table3D/BoardView';
import { EffectPresenter } from './EffectPresenter';
import { BoardInput } from './UI/BoardInput';
import { BufferView } from './UI/BufferView';
import { HudView, createUiNode, placeAtDesign } from './UI/HudView';
import { MeldView } from './UI/MeldView';
import { ResultView } from './UI/ResultView';
import { TouchPerformanceRecorder } from './TouchPerformanceRecorder';

export interface SceneScopeLike {
    add(cleanup: () => void): () => void;
}

export interface GameRootOptions {
    readonly contentRoot: Node;
    readonly tableRoot: Node;
    readonly projector: TableProjector;
    readonly viewport?: ViewportService;
    readonly cameras?: readonly Camera[];
    readonly cameraUnits?: readonly number[];
    readonly pauses?: PauseController;
    readonly diagnostics?: boolean;
    readonly createViews?: (parent: Node, projector: TableProjector, restart: () => void) => {
        hud: Pick<HudView, 'render' | 'showToast' | 'setMetrics' | 'dispose'>;
        buffer: Pick<BufferView, 'render' | 'dispose'>;
        meld: Pick<MeldView, 'render' | 'dispose'>;
    };
    readonly inputRect?: { x: number; y: number; width: number; height: number };
    readonly effectTargets?: ConstructorParameters<typeof EffectPresenter>[2];
}

function rejectText(reason: RejectReason): string {
    if (reason === 'blocked') return '仍被上层牌组锁定';
    if (reason === 'locked') return '该牌被锁定';
    if (reason === 'terminal') return '本局已结束';
    if (reason === 'insufficient-space') return '空间不足';
    if (reason === 'busy') return '正在结算';
    if (reason === 'stale-session') return '旧局输入已忽略';
    if (reason === 'unknown-block') return '未知牌块';
    return '该牌不在桌面';
}

function fanText(fan: string, clearedGroups: number, cleanupTiles: number): string {
    const cleanup = cleanupTiles > 0 ? ` · 将牌同组收尾 ${cleanupTiles} 张` : '';
    if (fan === 'qingyise') return `胡牌！清一色 · 大招清除 ${clearedGroups} 组${cleanup}`;
    if (fan === 'pengpenghu') return `胡牌！碰碰胡 · 大招清除 ${clearedGroups} 组${cleanup}`;
    return `胡牌！平胡 · 大招清除 ${clearedGroups} 组${cleanup}`;
}

export class GameRoot {
    private readonly lifetime = new LifecycleScope();
    private readonly contentRoot: Node;
    private readonly viewportRoot: Node;
    private readonly tableRoot: Node;
    private readonly projector: TableProjector;
    private readonly viewportService?: ViewportService;
    private readonly cameras: readonly Camera[];
    private readonly cameraUnits: readonly number[];
    private readonly pauses?: PauseController;
    private readonly diagnostics: boolean;
    private readonly boardResources: BoardResources;
    private readonly touchPerformance = new TouchPerformanceRecorder();
    private readonly boardView: BoardView;
    private readonly hud: Pick<HudView, 'render' | 'showToast' | 'setMetrics' | 'dispose'>;
    private readonly bufferView: Pick<BufferView, 'render' | 'dispose'>;
    private readonly meldView: Pick<MeldView, 'render' | 'dispose'>;
    private readonly resultView: ResultView;
    private readonly effects: EffectPresenter;
    private readonly input: BoardInput;
    private readonly inputNode: Node;
    private session: GameSession | null = null;
    private unsubscribe: (() => void) | null = null;
    private currentSnapshot: GameSnapshot | null = null;
    private currentSessionId = '';
    private resultTimer: ReturnType<typeof setTimeout> | null = null;
    private lastTouchMs: number | null = null;
    private paused = false;
    private mounted = false;
    private disposed = false;
    private readonly resultDelayMs = Math.min(1000, TIMING.resultPanelDelayMs);

    constructor(options: GameRootOptions) {
        this.viewportRoot = options.contentRoot;
        this.projector = options.projector;
        this.viewportService = options.viewport;
        this.cameras = options.cameras ?? [];
        this.cameraUnits = options.cameraUnits ?? [];
        this.pauses = options.pauses;
        this.diagnostics = options.diagnostics === true;
        try {
            this.boardResources = new BoardResources();
            this.lifetime.add(() => this.boardResources.release());
            // Own subtrees before any child/view constructor runs. A constructor that
            // throws before returning still cannot strand its partially created nodes.
            this.contentRoot = new Node('GameContent');
            this.lifetime.add(() => this.destroyOwnedNode(this.contentRoot));
            this.contentRoot.layer = Layers.Enum.UI_2D;
            options.contentRoot.addChild(this.contentRoot);
            this.contentRoot.addComponent(UITransform).setContentSize(720, 1280);
            this.tableRoot = new Node('GameTable');
            this.lifetime.add(() => this.destroyOwnedNode(this.tableRoot));
            options.tableRoot.addChild(this.tableRoot);
            this.boardView = new BoardView(this.tableRoot, this.contentRoot, this.projector, this.boardResources);
            this.lifetime.add(() => this.boardView.dispose());
            const hitRect = options.inputRect ?? { x: 0, y: 280, width: 720, height: 620 };
            this.inputNode = createUiNode(this.contentRoot, 'BoardInput', hitRect.width, hitRect.height);
            const hitGraphics = this.inputNode.addComponent(Graphics);
            hitGraphics.fillColor = new Color(0, 0, 0, 1);
            hitGraphics.rect(-hitRect.width / 2, -hitRect.height / 2, hitRect.width, hitRect.height);
            hitGraphics.fill();
            // A transparent render surface still participates in UI hit dispatch.
            this.inputNode.addComponent(BlockInputEvents);
            placeAtDesign(this.projector, this.inputNode, hitRect.x + hitRect.width / 2, hitRect.y + hitRect.height / 2);
            const views = options.createViews?.(this.contentRoot, this.projector, () => this.restart());
            this.hud = views?.hud ?? new HudView(this.contentRoot, this.projector, () => this.restart());
            this.lifetime.add(() => this.hud.dispose());
            this.bufferView = views?.buffer ?? new BufferView(this.contentRoot, this.projector);
            this.lifetime.add(() => this.bufferView.dispose());
            this.meldView = views?.meld ?? new MeldView(this.contentRoot, this.projector);
            this.lifetime.add(() => this.meldView.dispose());
            this.effects = new EffectPresenter(this.contentRoot, this.projector, options.effectTargets);
            this.lifetime.add(() => this.effects.dispose());
            this.resultView = new ResultView(this.contentRoot, this.projector, () => this.restart());
            this.lifetime.add(() => this.resultView.dispose());
            // Touch surface sits above the passive HUD/board labels but below effects/result;
            // otherwise a full-screen HUD node can win UI hit dispatch without a listener.
            this.inputNode.setSiblingIndex(Math.max(0, this.contentRoot.children.length - 2));

            this.input = new BoardInput({
                projector: this.projector,
                getSnapshot: () => this.currentSnapshot ?? this.session!.getSnapshot(),
                onSelect: blockId => this.selectBlock(blockId),
                onReject: reason => this.hud.showToast(rejectText(reason)),
                onSample: sample => {
                    this.lastTouchMs = sample.elapsedMs;
                    const metrics = this.input.getMetrics();
                    this.hud.setMetrics(sample.elapsedMs, metrics.p95Ms);
                    this.touchPerformance.record(sample.elapsedMs);
                    if (this.diagnostics) console.info('[R01] TouchEnd chain', JSON.stringify(sample));
                },
            });
            this.lifetime.add(() => this.input.detach());
            this.input.setEnabled(false);
            this.input.attach(this.inputNode);
            this.lifetime.add(() => this.touchPerformance.dispose());
        } catch (error) {
            this.touchPerformance.dispose();
            throw this.lifetime.rollback(error);
        }
    }

    mount(session: GameSession, scope: SceneScopeLike): void {
        if (this.disposed) throw new Error('GameRoot is disposed');
        if (this.mounted) throw new Error('GameRoot already mounted');
        try {
            this.session = session;
            this.mounted = true;
            this.unsubscribe = session.subscribe(result => this.onAccepted(result));
            const unsubscribe = this.unsubscribe;
            this.lifetime.add(unsubscribe);
            scope.add(() => this.unmount());
            if (this.disposed) throw new Error('Scene scope is already disposed');
            this.currentSnapshot = session.getSnapshot();
            this.currentSessionId = this.currentSnapshot.sessionId;
            this.touchPerformance.reset(this.currentSessionId);
            view.on('canvas-resize', this.resizeHandler);
            this.lifetime.add(() => { if (view && typeof view.off === 'function') view.off('canvas-resize', this.resizeHandler); });
            if (this.viewportService) this.lifetime.add(this.viewportService.subscribe(() => this.refreshViewport()));
            if (this.pauses) this.lifetime.add(this.pauses.subscribe(state => { if (state.paused) this.pause(); else this.resume(); }));
            this.refreshViewport();
            this.renderSnapshot(this.currentSnapshot);
            if (this.pauses?.isPaused) this.pause(); else this.input.setEnabled(true);
        } catch (error) {
            this.unmount();
            throw error;
        }
    }

    pause(): void {
        if (!this.mounted) return;
        this.paused = true;
        this.input.setEnabled(false);
        this.effects.pause();
        if (this.resultTimer !== null) clearTimeout(this.resultTimer);
        this.resultTimer = null;
    }

    resume(): void {
        if (!this.mounted) return;
        this.paused = false;
        if (this.currentSnapshot) this.renderSnapshot(this.currentSnapshot);
        this.effects.resume();
        this.refreshTerminalState();
        if (this.currentSnapshot && !this.currentSnapshot.terminal) this.input.setEnabled(true);
    }

    unmount(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.mounted = false;
        // Cocos may destroy the scene subtree before the owning component's onDestroy.
        // In that case node/view cleanup is already being performed by the engine; still
        // release the non-node ownership (recorder/board resources) and do not aggregate
        // predictable invalid-node failures into a misleading lifecycle error.
        if (!this.contentRoot || !this.contentRoot.isValid) {
            try { this.clearResultTimer(); } catch (error) { console.error('[R01] early timer cleanup failed', error); }
            try { this.touchPerformance.dispose(); } catch (error) { console.error('[R01] early recorder cleanup failed', error); }
            try { this.boardResources.release(); } catch (error) { console.error('[R01] early board cleanup failed', error); }
            try { this.input.detach(); } catch (error) { console.error('[R01] early input cleanup failed', error); }
            try { this.lifetime.dispose(); } catch (error) { console.error('[SKY-GAME] early scene ownership cleanup failed', error); }
            this.unsubscribe = null;
            this.session = null;
            this.currentSnapshot = null;
            this.currentSessionId = '';
            return;
        }
        const failures: unknown[] = [];
        const step = (label: string, action: () => void): void => {
            try {
                action();
            } catch (error) {
                failures.push(error);
                console.error('[R01] cleanup step failed: ' + label, error, (error as { causes?: unknown }).causes);
            }
        };
        step('result-timer', () => this.clearResultTimer());
        step('owned-lifetime', () => this.lifetime.dispose());
        this.unsubscribe = null;
        this.session = null;
        this.currentSnapshot = null;
        this.currentSessionId = '';
        if (failures.length > 0) {
            console.error('[R01] cleanup completed with failures', failures.length);
        }
    }

    refreshViewport(): void {
        if (this.viewportService) {
            const snapshot = this.viewportService.snapshot;
            this.projector.setViewport(snapshot);
            // 中文注释：安全区只施加在场景内容根，子根不能再次fit。
            this.viewportService.applyContent(this.viewportRoot);
            this.tableRoot.setScale(1, 1, 1);
            this.tableRoot.setPosition(0, 0, 0);
            for (let index = 0; index < this.cameras.length; index++) {
                const unit = this.cameraUnits[index] ?? 0.01;
                if (unit === 1) {
                    // 中文注释：SHOW_ALL的visibleSize不含上下/左右留白，相机却渲染全物理窗口。
                    // UI使用物理窗口/view缩放换回UI单位，不能用固定visibleHeight裁切长屏。
                    this.cameras[index].orthoHeight = snapshot.physicalHeight / view.getScaleY() / 2;
                    this.cameras[index].node.setPosition(0, 0, 1000);
                } else this.viewportService.applyCamera(this.cameras[index], unit);
            }
            this.boardView.refreshLayout();
            return;
        }
        // Compatibility path for isolated presentation tests only. Production always
        // supplies the shared framework viewport above.
        const visible = view.getVisibleSize();
        const safe = sys.getSafeAreaRect();
        this.projector.configure({
            visibleWidth: visible.width,
            visibleHeight: visible.height,
            safeX: safe.x,
            safeY: safe.y,
            safeWidth: safe.width,
            safeHeight: safe.height,
        });
        const scale = this.projector.scale;
        const offset = this.projector.contentOffset;
        this.contentRoot.setScale(scale, scale, 1);
        this.contentRoot.setPosition(offset.x, offset.y, 0);
        this.tableRoot.setScale(1, 1, 1);
        this.tableRoot.setPosition(0, 0, 0);
        const camera = this.projector.getCamera();
        if (camera) {
            const physicalSize = screen.windowSize;
            const dpr = screen.devicePixelRatio;
            const frame = { width: physicalSize.width / dpr, height: physicalSize.height / dpr };
            const bottomLeft = this.projector.designToUi(0, DESIGN_SIZE.height);
            const topRight = this.projector.designToUi(DESIGN_SIZE.width, 0);
            const viewport = view.getViewportRect();
            const contentWidthPx = (topRight.x - bottomLeft.x) * view.getScaleX();
            const contentHeightPx = (topRight.y - bottomLeft.y) * view.getScaleY();
            if (contentWidthPx > 0 && contentHeightPx > 0 && frame.width > 0 && frame.height > 0) {
                const halfHeight = this.projector.cameraOrthoHalfHeight * frame.height / contentHeightPx;
                const unitsPerPixel = (halfHeight * 2) / frame.height;
                camera.orthoHeight = halfHeight;
                camera.node.setPosition(
                    this.projector.designToWorld(360, 640).x - (viewport.x + bottomLeft.x * view.getScaleX() + contentWidthPx / 2 - frame.width / 2) * unitsPerPixel,
                    this.projector.designToWorld(360, 640).y - (viewport.y + bottomLeft.y * view.getScaleY() + contentHeightPx / 2 - frame.height / 2) * unitsPerPixel,
                    10,
                );
            }
        }
        this.boardView.refreshLayout();
    }

    getPerformanceMetrics() {
        return this.input.getMetrics();
    }

    getLastTouchSample() {
        return this.input.lastSample;
    }

    getTouchSamples() {
        return this.input.getSamples();
    }

    getBoardResourceCounts() {
        return BoardResources.counts();
    }

    getTimingStats() {
        return this.touchPerformance.getStats();
    }

    private destroyOwnedNode(node: Node): void {
        if (node.isValid === false) return;
        node.active = false;
        node.removeFromParent();
        node.destroy();
    }

    private readonly resizeHandler = (): void => {
        this.refreshViewport();
    };

    private selectBlock(blockId: BlockID): CommandResult {
        if (!this.session) {
            return { accepted: false, reason: 'terminal', sessionId: '', revision: 0 };
        }
        const snapshot = this.session.getSnapshot();
        try {
            return this.session.dispatch({ kind: 'select', sessionId: snapshot.sessionId, blockId });
        } catch (error) {
            console.error('[R0] select transaction failed', error);
            this.hud.showToast('内部错误');
            return { accepted: false, reason: 'busy', sessionId: snapshot.sessionId, revision: snapshot.revision };
        }
    }

    private restart(): void {
        if (!this.session) return;
        this.input.cancelGesture();
        const snapshot = this.session.getSnapshot();
        const result = this.session.dispatch({ kind: 'restart', sessionId: snapshot.sessionId });
        if (!result.accepted) this.hud.showToast(rejectText(result.reason));
    }

    private onAccepted(result: AcceptedCommand): void {
        const snapshot = result.snapshot;
        const previousSessionId = this.currentSessionId;
        if (snapshot.sessionId !== previousSessionId) {
            this.input.cancelGesture();
            this.touchPerformance.reset(snapshot.sessionId);
            this.clearResultTimer();
            this.resultView.hide();
            this.effects.cancelSession(previousSessionId);
            this.currentSessionId = snapshot.sessionId;
        }
        this.currentSnapshot = snapshot;
        this.lastTouchMs = this.input.lastSample ? this.input.lastSample.elapsedMs : this.lastTouchMs;
        this.renderSnapshot(snapshot);
        this.effects.present(result.events, snapshot);
        for (const event of result.events) {
            if (event.kind === 'session-restarted') this.hud.showToast('已重开');
            if (event.kind === 'ultimate-resolved') {
                const cleanupTiles = event.payload.pairCleanup
                    .reduce((total, entry) => total + entry.cards.length, 0);
                this.hud.showToast(fanText(event.payload.fan, event.payload.targets.length, cleanupTiles));
            }
        }
        this.refreshTerminalState();
    }

    private renderSnapshot(snapshot: GameSnapshot): void {
        this.boardView.render(snapshot);
        this.hud.render(snapshot, this.lastTouchMs);
        this.bufferView.render(snapshot);
        this.meldView.render(snapshot);
    }

    private refreshTerminalState(): void {
        if (!this.currentSnapshot) return;
        if (!this.currentSnapshot.terminal) {
            this.clearResultTimer();
            this.resultView.hide();
            if (!this.paused) this.input.setEnabled(true);
            return;
        }
        this.input.setEnabled(false);
        if (this.paused) return;
        const sessionId = this.currentSnapshot.sessionId;
        if (this.currentSnapshot.terminal?.outcome === 'Lost') {
            this.clearResultTimer();
            this.effects.cancelSession(sessionId);
            this.resultView.show(this.currentSnapshot);
            return;
        }
        if (this.resultTimer !== null) return;
        this.resultTimer = setTimeout(() => {
            this.resultTimer = null;
            if (!this.currentSnapshot || this.currentSnapshot.sessionId !== sessionId) return;
            this.effects.cancelSession(sessionId);
            this.resultView.show(this.currentSnapshot);
        }, this.resultDelayMs);
    }

    private clearResultTimer(): void {
        if (this.resultTimer !== null) clearTimeout(this.resultTimer);
        this.resultTimer = null;
    }
}
