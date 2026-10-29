import '../Presentation/UI/MainUiShape';
/**
 * 唯一游戏启动入口：替换 FrameworkBootstrap，构造三相机/2D+3D 场景，
 * 用同一个 App 帧驱动；本批不启用刚体。
 */

import {
    _decorator,
    Camera,
    Canvas,
    Color,
    Component,
    Graphics,
    Layers,
    Node,
    ResolutionPolicy,
    UITransform,
    director,
    game,
    Game,
    view,
    Prefab,
    instantiate,
    profiler,
    screen,
} from 'cc';
import { DEBUG } from 'cc/env';
import { App } from '../../Framework/Core/App';
import { ViewportService } from '../../Framework/Core/ViewportService';
import { RuntimeLifecycle } from '../../Framework/Core/RuntimeLifecycle';
import { SkyWhiteGameView, SKY_BOARD, SKY_MELD, skyBufferTarget } from '../Presentation/UI/SkyWhiteGameView';
import { GameAppLifecycle } from './GameAppLifecycle';
import { PauseController } from '../../Framework/Kernel/PauseController';
import type { Module } from '../../Framework/Kernel/Contracts';
import { LifecycleScope } from '../../Framework/Kernel/LifecycleScope';
import { GameSession } from '../Application/GameSession';
import { LEVEL_888 } from '../Config/Level888';
import { COLORS, UI_LAYOUT } from '../Config/PresentationConfig';
import { GameRoot } from '../Presentation/GameRoot';
import { ResManager } from '../../Framework/Core/ResManager';
import type { ResourceHandle } from '../../Framework/Kernel/ResourceCache';
import { TableProjector } from '../Presentation/TableProjector';
import {
    createLabelNode,
    createTextButton,
    createUiNode,
    drawPanel,
    hexColor,
} from '../Presentation/UI/HudView';

const { ccclass, property } = _decorator;

function colorFromHex(hex: string): Color {
    return new Color().fromHEX(hex);
}

@ccclass('GameBootstrap')
export class GameBootstrap extends Component {
    @property(Node) sceneContentRoot: Node | null = null;
    @property(Node) sceneHud: Node | null = null;
    @property(Node) sceneBoardRoot: Node | null = null;
    @property(Node) sceneBackground: Node | null = null;
    @property(Node) sceneBackgroundCanvas: Node | null = null;
    @property(Node) sceneOverlayCanvas: Node | null = null;
    @property(Camera) sceneBackgroundCamera: Camera | null = null;
    @property(Camera) sceneBoardCamera: Camera | null = null;
    @property(Camera) sceneOverlayCamera: Camera | null = null;
    @property({ tooltip: '仅在Main内检查第一层UI与第三层背景；关闭后运行原MVP。' }) layoutOnly = false;
    private managedUiRoot: Node | null = null;
    private skyView: SkyWhiteGameView | null = null;
    private runtime: RuntimeLifecycle | null = null;
    private backgroundInstance: Node | null = null;
    private authoredHud: Node | null = null;
    private authoredAssets = new LifecycleScope();
    private static owner: GameBootstrap | null = null;
    private readonly projector = new TableProjector();
    private diagnosticsEnabled = false;
    private lifetime = new LifecycleScope();
    private session: GameSession | null = null;
    private gameRoot: GameRoot | null = null;
    private contentRoot: Node | null = null;
    private uiCanvasNode: Node | null = null;
    private tableRoot: Node | null = null;
    private backgroundRoot: Node | null = null;
    private backgroundHandle: ResourceHandle<Prefab> | null = null;
    private backgroundLoads = 0;
    private viewport: ViewportService | null = null;
    private readonly cameras: Camera[] = [];
    private pauses: PauseController | null = null;
    private sceneLifetime = new LifecycleScope();
    private errorLifetime = new LifecycleScope();
    private diagnosticsObject: object | null = null;
    private generation = 0;
    private backgrounded = false;
    private nextStartupFault: 'init' | 'start' | null = null;
    private diagnosticReportFrames = 0;
    private sessionCounter = 0;
    private driving = false;
    private starting = false;
    private retrying = false;
    private gameCleaned = false;
    private sceneCleaned = false;
    private owns = false;
    private lifecycleToken: symbol | null = null;

    protected onLoad(): void {
        if (this.owns) return;
        this.owns = true;
        const token = GameAppLifecycle.tryClaim();
        if (token) {
            this.becomeOwner(token);
            return;
        }
        void GameAppLifecycle.waitForClaim().then(next => {
            if (!this.owns) return;
            if (!next) {
                this.owns = false;
                this.enabled = false;
                console.error('[GAME-UI-01] Duplicate GameBootstrap driver');
                return;
            }
            this.becomeOwner(next);
        }).catch(error => {
            if (!this.owns) return;
            this.owns = false;
            this.enabled = false;
            console.error('[GAME-UI-01] scene ownership wait failed', error);
        });
    }

    private becomeOwner(token: symbol): void {
        if (!this.owns || !GameAppLifecycle.owns(token)) return;
        this.lifecycleToken = token;
        GameBootstrap.owner = this;
        try {
            view.setDesignResolutionSize(720, 1280, ResolutionPolicy.SHOW_ALL);
            this.disableLegacySceneNodes();
            this.diagnosticsEnabled = DEBUG && this.readDiagnosticsSwitch();
            if (DEBUG) profiler.hideStats();
            if (DEBUG && this.diagnosticsEnabled && typeof window !== 'undefined') {
                if (window.location.search.includes('r03fault=init')) this.nextStartupFault = 'init';
                else if (window.location.search.includes('r03fault=start')) this.nextStartupFault = 'start';
            }
            this.composeGame();
            if (!this.layoutOnly) void this.startApp();
        } catch (error) {
            console.error('[R0] scene composition failed', error);
            this.cleanupGame();
            this.cleanupScene();
            this.showError(error);
        }
    }

    protected update(dt: number): void {
        if (!this.driving) return;
        try {
            App.Instance.update(Math.min(dt, 0.25));
            if (DEBUG && this.diagnosticsEnabled && this.diagnosticReportFrames > 0 && --this.diagnosticReportFrames === 0) {
                this.reportDiagnostics();
            }
        } catch (error) {
            console.error('[R0] frame update failed', error);
        }
    }

    protected onDestroy(): void {
        if (!this.owns) return;
        this.owns = false;
        this.generation++;
        const token = this.lifecycleToken;
        this.lifecycleToken = null;
        if (GameBootstrap.owner === this) GameBootstrap.owner = null;
        this.driving = false;
        if (game && typeof game.off === 'function') {
            game.off(Game.EVENT_HIDE, this.hide, this);
            game.off(Game.EVENT_SHOW, this.show, this);
        }
        const close = async (): Promise<void> => {
            this.releaseBackground();
            try {
                await App.Instance.dispose();
            } catch (error) {
                console.error('[R0] App dispose failed', error, (error as { causes?: unknown }).causes);
                throw error;
            } finally {
                this.cleanupGame();
                this.cleanupScene();
                this.clearError();
            }
        };
        if (token) {
            void GameAppLifecycle.release(token, close).catch(error => {
                console.error('[GAME-UI-01] scene close failed', error);
            });
        } else {
            void close().catch(error => console.error('[GAME-UI-01] unowned scene close failed', error));
        }
    }

    private readonly hide = (): void => {
        this.backgrounded = true;
        this.pauses?.set('background', true);
    };

    private readonly show = (): void => {
        this.backgrounded = false;
        this.pauses?.set('background', false);
    };

    private readDiagnosticsSwitch(): boolean {
        if (typeof window === 'undefined' || !window.location) return false;
        return window.location.search.includes('r01diag=1');
    }

    private installReadOnlyDiagnostics(): void {
        const diagnostics = {
            getSnapshot: () => this.session?.getSnapshot() ?? null,
            metrics: () => this.gameRoot?.getPerformanceMetrics() ?? null,
            lastSample: () => this.gameRoot?.getLastTouchSample() ?? null,
            samples: () => this.gameRoot?.getTouchSamples() ?? [],
            resources: () => this.gameRoot?.getBoardResourceCounts() ?? null,
            timing: () => this.gameRoot?.getTimingStats() ?? null,
            reinit: () => this.retry(),
            failStartup: () => {
                if (!this.owns || this.starting || this.retrying) return Promise.resolve();
                const generation = ++this.generation;
                this.driving = false;
                this.releaseBackground();
                return App.Instance.dispose()
                    .catch(error => console.error('[R01] diagnostic startup dispose failed', error))
                    .then(() => {
                        if (!this.owns || this.generation !== generation) return;
                        this.cleanupGame();
                        this.cleanupScene();
                        this.showError(new Error('diagnostic startup failure'));
                    });
            },
            restart: () => {
                if (!this.owns || !this.driving) return;
                const snapshot = this.session?.getSnapshot();
                if (this.session && snapshot) {
                    this.session.dispatch({ kind: 'restart', sessionId: snapshot.sessionId });
                }
            },
            layout: () => {
                const camera = this.projector.getCamera();
                const physicalSize = screen.windowSize;
                const dpr = screen.devicePixelRatio;
                return {
                    projectorScale: this.projector.scale,
                    projectorOffset: this.projector.contentOffset,
                    visible: view.getVisibleSize(),
                    frame: { width: physicalSize.width / dpr, height: physicalSize.height / dpr },
                    viewport: view.getViewportRect(),
                    camera: camera ? {
                        orthoHeight: camera.orthoHeight,
                        x: camera.node.position.x,
                        y: camera.node.position.y,
                    } : null,
                };
            },
            designToCss: (x: number, y: number) => {
                const ui = this.projector.designToUi(x, y);
                const viewport = view.getViewportRect();
                const screenX = ui.x * view.getScaleX() + viewport.x;
                const screenY = ui.y * view.getScaleY() + viewport.y;
                const height = typeof window !== 'undefined' ? window.innerHeight : 1280;
                return { x: screenX, y: height - screenY };
            },
        };
        Object.defineProperty(globalThis, '__R0__', {
            value: diagnostics,
            configurable: true,
            enumerable: false,
            writable: false,
        });
        this.diagnosticsObject = diagnostics;
    }

    private async loadGameBackground(current: () => boolean): Promise<void> {
        if (this.sceneHud) return; // 中文注释：已保存场景持有背景Prefab，不再重复加载旧背景。
        if (!this.backgroundRoot) return;
        try {
            this.backgroundLoads++;
            const handle = await ResManager.Instance.acquire('Prefabs/Pages/GameBackground', Prefab, {
                bundle: 'game-ui', scope: this.lifetime, timeoutMs: 15000,
            });
            this.backgroundHandle = handle;
            if (!current() || !this.backgroundRoot) { handle.release(); if (this.backgroundHandle === handle) this.backgroundHandle = null; return; }
            const node = instantiate(handle.value);
            const applyLayer = (n: Node): void => {
                n.layer = Layers.Enum.UI_3D;
                for (const child of n.children) applyLayer(child);
            };
            applyLayer(node);
            node.setPosition(0, 0, 0);
            this.backgroundRoot.addChild(node);
            this.backgroundInstance = node;
        } catch (error) {
            console.error('[GAME-UI-01] game-ui background load failed', error);
        }
    }

    private releaseBackground(): void {
        if (this.backgroundInstance?.isValid) this.destroyOwnedNode(this.backgroundInstance);
        this.backgroundInstance = null;
        const handle = this.backgroundHandle; this.backgroundHandle = null;
        if (handle) { try { handle.release(); } catch (error) { console.error('[GAME-UI-01] background release failed', error); } }
    }

    private createSession(): GameSession {
        return new GameSession({
            level: LEVEL_888,
            nextSessionId: () => 'r0-' + (++this.sessionCounter),
        });
    }

    private composeGame(): void {
        this.gameCleaned = false;
        this.buildScene();
        this.pauses = new PauseController();
        this.runtime = new RuntimeLifecycle({ pauses: this.pauses, onError: error => console.error('[SKY-GAME] lifecycle', error) });
        this.viewport = new ViewportService({ width: 720, height: 1280 });
        this.viewport.start();
        this.viewport.applyContent(this.contentRoot!);
        if (this.sceneHud) {
            this.projector.setArtBoard(SKY_BOARD);
            this.viewport.subscribe(() => this.refreshAuthoredScene());
            this.refreshAuthoredScene();
        }
        this.lifetime = new LifecycleScope();
        if (this.layoutOnly) return; // 中文注释：场景排版检查不创建局、不生成牌面或输入。
        this.session = this.createSession();
        if (!this.sceneHud) this.createGameRoot();
        if (this.diagnosticsEnabled) this.installReadOnlyDiagnostics();
    }

    private createGameRoot(): void {
        this.gameRoot = new GameRoot({
            contentRoot: this.contentRoot!,
            tableRoot: this.tableRoot!,
            projector: this.projector,
            viewport: this.viewport ?? undefined,
            cameras: this.cameras,
            cameraUnits: [1, 0.01, 1],
            pauses: this.pauses ?? undefined,
            diagnostics: this.diagnosticsEnabled,
            inputRect: this.sceneHud ? SKY_BOARD : undefined,
            effectTargets: this.sceneHud ? { buffer: skyBufferTarget, meld: { x: 360, y: SKY_MELD.y } } : undefined,
            createViews: this.sceneHud ? (parent, projector, restart) => {
                const view = this.skyView = new SkyWhiteGameView(parent, this.authoredHud!, projector, this.pauses!, restart);
                return { hud: view,
                    buffer: { render: snapshot => view.renderBuffer(snapshot), dispose: () => {} },
                    meld: { render: snapshot => view.renderMeld(snapshot), dispose: () => {} } };
            } : undefined,
        });
        this.managedUiRoot?.setSiblingIndex(this.contentRoot!.children.length - 1);
    }

    private async loadAuthoredViews(current: () => boolean): Promise<void> {
        if (!this.sceneHud || !this.sceneBackground) return;
        // 中文注释：Main直接保存本地可编辑UI；禁止按历史预览再次加载/替换布局。
        if (this.sceneHud.getChildByName('TopHud')) {
            this.authoredHud = this.sceneHud;
            this.createGameRoot();
            return;
        }
        const assets = this.authoredAssets = new LifecycleScope();
        for (const [path, parent, isHud] of [
            ['GameHUD', this.sceneHud, true], ['SkyBackground', this.sceneBackground, false],
        ] as const) {
            const handle = await ResManager.Instance.acquire('SkyWhiteV2/Prefabs/' + path, Prefab,
                { bundle: 'game-ui', scope: assets, timeoutMs: 15000 });
            if (!current() || !assets.isActive) { handle.release(); return; }
            const node = instantiate(handle.value);
            // 该回收在handle之后登记，LIFO保证实例先销毁，资源后释放。
            assets.add(() => this.destroyOwnedNode(node));
            parent.addChild(node);
            if (isHud) this.authoredHud = node;
        }
        if (!current()) return;
        this.createGameRoot();
        await this.skyView?.loadArt();
    }

    private async startApp(): Promise<void> {
        if (this.starting || !this.owns) return;
        this.starting = true;
        const generation = this.generation;
        const current = (): boolean => this.owns && this.generation === generation;
        const session = this.session;
        const scope = this.lifetime;
        if (!session) {
            this.starting = false;
            return;
        }
        const gameModule: Module = {
            dependencies: ['resources', 'timers', 'presentation', 'runtime', ...(this.managedUiRoot ? ['ui'] : [])],
            init: async () => { this.injectStartupFault('init'); await this.loadAuthoredViews(current); },
            start: () => {
                const root = this.gameRoot;
                if (!current() || !root) throw new Error('Game views not ready or startup cancelled');
                root.mount(session, scope);
                root.refreshViewport();
                this.injectStartupFault('start');
            },
            dispose: () => {
                this.gameRoot?.unmount();
                this.authoredAssets.dispose();
                session.dispose();
            },
        };
        try {
            await App.Instance.init({
                uiRoot: this.managedUiRoot ?? undefined,
                modules: [{ name: 'runtime', module: this.runtime! }, { name: 'game', module: gameModule }],
            });
            if (!current()) return;
            await App.Instance.start();
            if (!current()) return;
            await this.loadGameBackground(current);
            if (!current()) return;
            this.driving = true;
            this.clearError();
            if (DEBUG && this.diagnosticsEnabled) {
                this.mountDiagnosticControls();
                this.diagnosticReportFrames = 2;
            }
        } catch (error) {
            if (!current()) return;
            this.driving = false;
            console.error('[R0] startup failed', error);
            this.releaseBackground();
            await App.Instance.dispose().catch(failure => console.error('[R03] failed startup dispose', failure));
            if (!current()) return;
            this.cleanupGame();
            this.cleanupScene();
            this.showError(error);
        } finally {
            if (this.generation === generation) this.starting = false;
        }
    }

    private async retry(): Promise<void> {
        if (this.retrying || this.starting || !this.owns) return;
        this.retrying = true;
        this.driving = false;
        const generation = ++this.generation;
        try {
            this.releaseBackground();
            await App.Instance.dispose().catch(error => console.error('[R0] retry dispose failed', error));
            if (!this.owns || generation !== this.generation) return;
            this.cleanupGame();
            this.cleanupScene();
            this.clearError();
            this.composeGame();
            await this.startApp();
        } catch (error) {
            if (!this.owns || generation !== this.generation) return;
            console.error('[R03] retry composition failed', error);
            this.cleanupGame();
            this.cleanupScene();
            this.showError(error);
        } finally {
            this.retrying = false;
        }
    }

    private buildScene(): void {
        this.sceneCleaned = false;
        this.sceneLifetime = new LifecycleScope();
        try {
            if (this.sceneContentRoot) {
                if (!this.sceneHud || !this.sceneBoardRoot || !this.sceneOverlayCanvas || !this.sceneBackgroundCamera
                    || !this.sceneBoardCamera || !this.sceneOverlayCamera || !this.sceneBackground || !this.sceneBackgroundCanvas)
                    throw new Error('SkyWhite scene bindings incomplete');
                this.contentRoot = this.sceneContentRoot;
                this.uiCanvasNode = this.sceneOverlayCanvas;
                this.tableRoot = this.sceneBoardRoot;
                this.cameras.push(this.sceneBackgroundCamera, this.sceneBoardCamera, this.sceneOverlayCamera);
                this.sceneBoardCamera.node.setPosition(0, 0, 10);
                this.projector.setCamera(this.sceneBoardCamera);
                this.managedUiRoot = createUiNode(this.sceneContentRoot, 'ManagedUI', 720, 1280);
                const managed = this.managedUiRoot;
                this.sceneLifetime.add(() => this.destroyOwnedNode(managed));
                return;
            }
            const sceneRoot = new Node('GameScene');
            this.sceneLifetime.add(() => this.destroyOwnedNode(sceneRoot));
            this.node.addChild(sceneRoot);
            const bgCamera = this.createCamera(sceneRoot, 'BackgroundCamera', 0, Camera.ClearFlag.SOLID_COLOR, Layers.Enum.UI_3D, 1000);
            this.cameras.push(bgCamera);
            bgCamera.clearColor = colorFromHex(COLORS.background);
            const tileCamera = this.createCamera(sceneRoot, 'TileCamera', 1, Camera.ClearFlag.DEPTH_ONLY, Layers.Enum.DEFAULT, 10);
            this.cameras.push(tileCamera);
            tileCamera.orthoHeight = this.projector.cameraOrthoHalfHeight;
            this.projector.setCamera(tileCamera);
            const uiCamera = this.createCamera(sceneRoot, 'UiCamera', 2, Camera.ClearFlag.DEPTH_ONLY, Layers.Enum.UI_2D, 1000);
            this.cameras.push(uiCamera);

            const bgCanvasNode = this.createCanvas(sceneRoot, 'BackgroundCanvas', bgCamera, Layers.Enum.UI_3D);
            const bgNode = new Node('Background');
            bgNode.layer = Layers.Enum.UI_3D;
            bgCanvasNode.addChild(bgNode);
            this.backgroundRoot = bgNode;
            const bgTransform = bgNode.addComponent(UITransform);
            bgTransform.setContentSize(720, 1280);
            const bgGraphics = bgNode.addComponent(Graphics);
            bgGraphics.fillColor = colorFromHex(COLORS.background);
            bgGraphics.rect(-360, -640, 720, 1280);
            bgGraphics.fill();
            bgGraphics.fillColor = colorFromHex(COLORS.table);
            const tableTop = 640 - UI_LAYOUT.board.bottom;
            const tableBottom = 640 - UI_LAYOUT.board.top;
            bgGraphics.rect(-360, tableBottom, 720, tableTop - tableBottom);
            bgGraphics.fill();

            const uiCanvasNode = this.createCanvas(sceneRoot, 'OverlayCanvas', uiCamera, Layers.Enum.UI_2D);
            this.uiCanvasNode = uiCanvasNode;
            const contentRoot = new Node('ContentRoot');
            contentRoot.layer = Layers.Enum.UI_2D;
            uiCanvasNode.addChild(contentRoot);
            const contentTransform = contentRoot.addComponent(UITransform);
            contentTransform.setContentSize(720, 1280);
            this.contentRoot = contentRoot;
            this.tableRoot = new Node('TableWorld');
            sceneRoot.addChild(this.tableRoot);
        } catch (error) {
            this.contentRoot = null;
            this.uiCanvasNode = null;
            this.tableRoot = null;
            this.sceneLifetime.rollback(error);
        }
    }

    private refreshAuthoredScene(): void {
        if (!this.viewport) return;
        const state = this.viewport.snapshot;
        const size = { width: state.physicalWidth / view.getScaleX(), height: state.physicalHeight / view.getScaleY() };
        for (const canvas of [this.sceneBackgroundCanvas, this.sceneOverlayCanvas])
            canvas?.getComponent(UITransform)?.setContentSize(size.width, size.height);
        const cover = Math.max(size.width / 940, size.height / 1672);
        this.sceneBackground?.setScale(cover, cover, 1);
        if (this.layoutOnly) {
            if (this.sceneBackgroundCamera) this.viewport.applyCamera(this.sceneBackgroundCamera, 1);
            if (this.sceneOverlayCamera) this.viewport.applyCamera(this.sceneOverlayCamera, 1);
        }
    }

    private createCanvas(parent: Node, name: string, camera: Camera, layer: number): Node {
        const node = new Node(name);
        node.layer = layer;
        parent.addChild(node);
        const transform = node.addComponent(UITransform);
        transform.setContentSize(720, 1280);
        const canvas = node.addComponent(Canvas);
        canvas.cameraComponent = camera;
        canvas.alignCanvasWithScreen = false;
        return node;
    }

    private createCamera(parent: Node, name: string, priority: number, clearFlags: number, visibility: number, z: number): Camera {
        const node = new Node(name);
        node.layer = Layers.Enum.DEFAULT;
        parent.addChild(node);
        node.setPosition(0, 0, z);
        const camera = node.addComponent(Camera);
        camera.projection = Camera.ProjectionType.ORTHO;
        camera.priority = priority;
        camera.clearFlags = clearFlags;
        camera.visibility = visibility;
        camera.near = 0.1;
        camera.far = 2000;
        return camera;
    }

    private disableLegacySceneNodes(): void {
        const scene = director.getScene();
        if (!scene) return;
        const legacyCamera = scene.getChildByName('Main Camera');
        if (legacyCamera) legacyCamera.active = false;
    }

    private injectStartupFault(phase: 'init' | 'start'): void {
        if (!DEBUG || this.nextStartupFault !== phase) return;
        this.nextStartupFault = null;
        throw new Error('R03 injected App.' + phase + ' failure');
    }

    private reportDiagnostics(): void {
        if (!DEBUG || !this.diagnosticsEnabled || !this.owns) return;
        const snapshot = this.session?.getSnapshot();
        console.info('[R03] lifecycle', JSON.stringify({
            sessionId: snapshot?.sessionId, revision: snapshot?.revision,
            resources: this.gameRoot?.getBoardResourceCounts(),
            timing: this.gameRoot?.getTimingStats(),
            cameras: this.node.getComponentsInChildren(Camera).length,
        }));
    }

    private mountDiagnosticControls(): void {
        if (!DEBUG || !this.diagnosticsEnabled || !this.uiCanvasNode) return;
        const root = createUiNode(this.uiCanvasNode, 'R03DebugControls', 720, 80);
        createTextButton(root, this.projector, 'DebugReinit', '重建场景', 120, 1140, 160, 40, () => { void this.retry(); });
        createTextButton(root, this.projector, 'DebugStartupFault', '启动故障演练', 360, 1140, 210, 40, () => {
            if (!this.owns || this.starting || this.retrying) return;
            this.nextStartupFault = 'start';
            void this.retry();
        });
        createTextButton(root, this.projector, 'DebugStats', '状态', 600, 1140, 120, 40, () => this.reportDiagnostics());
    }

    private showError(error: unknown): void {
        if (!this.owns) return;
        this.clearError();
        this.errorLifetime = new LifecycleScope();
        try {
            let canvas = this.uiCanvasNode;
            if (!canvas) {
                // Scene composition can fail before the normal overlay exists.
                const fallback = new Node('StartupFallback');
                this.errorLifetime.add(() => this.destroyOwnedNode(fallback));
                this.node.addChild(fallback);
                const camera = this.createCamera(fallback, 'ErrorCamera', 3, Camera.ClearFlag.SOLID_COLOR, Layers.Enum.UI_2D, 1000);
                camera.clearColor = colorFromHex(COLORS.background);
                canvas = this.createCanvas(fallback, 'ErrorCanvas', camera, Layers.Enum.UI_2D);
            }
            const root = new Node('StartupError');
            this.errorLifetime.add(() => this.destroyOwnedNode(root));
            root.layer = Layers.Enum.UI_2D;
            canvas.addChild(root);
            root.addComponent(UITransform).setContentSize(720, 1280);
            const shadeNode = createUiNode(root, 'StartupErrorShade', 720, 1280);
            const shade = shadeNode.addComponent(Graphics);
            const shadeColor = colorFromHex(COLORS.background);
            shadeColor.a = 240;
            shade.fillColor = shadeColor;
            shade.rect(-360, -640, 720, 1280);
            shade.fill();
            const panelNode = createUiNode(root, 'StartupErrorPanel', 560, 260);
            const panel = panelNode.addComponent(Graphics);
            drawPanel(panel, 560, 260, COLORS.panel, COLORS.resultLost, 16);
            const message = error instanceof Error ? error.message : String(error);
            const label = createLabelNode(
                root,
                'StartupErrorText',
                '启动失败\n' + message,
                18,
                hexColor(COLORS.resultLost),
                520,
                160,
            );
            label.node.setPosition(0, 100, 0);
            createTextButton(root, this.projector, 'RetryButton', '重试', 360, 760, 150, 48, () => {
                void this.retry();
            });
        } catch (uiError) {
            this.clearError();
            console.error('[R03] startup error UI failed', error, uiError);
        }
    }

    private destroyOwnedNode(node: Node): void {
        if (!node.isValid) return;
        node.active = false;
        node.removeFromParent();
        node.destroy();
    }

    private clearError(): void {
        const lifetime = this.errorLifetime as LifecycleScope | null;
        try { lifetime?.dispose(); }
        catch (error) { console.error('[R03] error UI cleanup failed', error); }
    }

    private cleanupScene(): void {
        if (this.sceneCleaned) return;
        this.sceneCleaned = true;
        const sceneLifetime = this.sceneLifetime as LifecycleScope | null;
        try { sceneLifetime?.dispose(); }
        catch (error) { console.error('[R03] scene cleanup failed', error); }
        this.contentRoot = null;
        this.uiCanvasNode = null;
        this.tableRoot = null;
        this.backgroundRoot = null;
        this.managedUiRoot = null;
        this.projector?.setCamera(null);
        try { this.viewport?.dispose(); } catch (error) { console.error('[GAME-UI-01] viewport cleanup failed', error); }
        this.viewport = null;
        if (this.cameras) this.cameras.length = 0;
    }

    private cleanupGame(): void {
        if (this.gameCleaned) return;
        this.gameCleaned = true;
        const step = (label: string, action: () => void): void => {
            try {
                action();
            } catch (error) {
                console.error('[R01] bootstrap cleanup step failed: ' + label, error);
            }
        };
        this.releaseBackground();
        step('game-root', () => this.gameRoot?.unmount());
        step('authored-views', () => this.authoredAssets.dispose());
        this.authoredHud = null;
        step('session', () => this.session?.dispose());
        const lifetime = this.lifetime as LifecycleScope | null;
        step('lifetime', () => { if (lifetime?.isActive) lifetime.dispose(); });
        step('diagnostics', () => {
            const global = globalThis as typeof globalThis & { __R0__?: object };
            if (this.diagnosticsObject && global.__R0__ === this.diagnosticsObject) delete global.__R0__;
            this.diagnosticsObject = null;
        });
        this.gameRoot = null;
        this.skyView = null;
        this.runtime = null;
        this.session = null;
        try { this.pauses?.dispose(); } catch (error) { console.error('[GAME-UI-01] pause cleanup failed', error); }
        this.pauses = null;
    }
}
