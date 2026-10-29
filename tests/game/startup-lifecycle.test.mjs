import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { loadTypeScript } from '../../tools/typescript.mjs';
import { LifecycleScope } from '../../assets/Framework/Kernel/LifecycleScope.ts';
import { TouchPerformanceRecorder } from '../../assets/Game/Presentation/TouchPerformanceRecorder.ts';

// Execute the actual production source with injected engine/service dependencies.
// These are failure-path unit tests, not a simulation of Cocos rendering or GPU memory.
const { ts } = loadTypeScript();
function loadSource(relative, dependencies, globals = {}) {
    const source = fs.readFileSync(new URL('../../' + relative, import.meta.url), 'utf8');
    const compiled = ts.transpileModule(source, { compilerOptions: {
        target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, experimentalDecorators: true,
    } }).outputText;
    const module = { exports: {} };
    const context = vm.createContext({
        module, exports: module.exports, setTimeout, clearTimeout,
        console: { info() {}, error() {} },
        require(name) {
            assert.ok(Object.hasOwn(dependencies, name), 'Missing injected dependency: ' + name);
            return dependencies[name];
        }, ...globals,
    });
    vm.runInContext(compiled, context, { filename: relative });
    return { ...module.exports, context };
}

const turn = () => new Promise(resolve => setImmediate(resolve));
function engineFixture() {
    const nodes = [];
    const listeners = new Map();
    const state = { failComponent: null, scheduled: [], failMaterial: 0, materials: [], meshes: [] };
    class Node {
        constructor(name = 'Node') { Object.assign(this, { name, children: [], parent: null, active: true, isValid: true }); nodes.push(this); }
        addChild(node) { node.removeFromParent(); this.children.push(node); node.parent = this; }
        removeFromParent() { if (this.parent) this.parent.children = this.parent.children.filter(n => n !== this); this.parent = null; }
        addComponent(Type) {
            if (state.failComponent === Type) { state.failComponent = null; throw Error('component construction'); }
            const component = new Type(); component.node = this; return component;
        }
        destroy() { if (!this.isValid) return; this.isValid = false; for (const child of [...this.children]) child.destroy(); this.removeFromParent(); }
        setPosition() {} setScale() {} setSiblingIndex() {}
        getChildByName(name) { return this.children.find(n => n.name === name) ?? null; }
        getComponentsInChildren() { return []; }
    }
    class UITransform { setContentSize() {} }
    class Color { fromHEX() { return this; } }
    class Graphics { rect() {} fill() {} }
    class Camera {
        static ClearFlag = { SOLID_COLOR: 1, DEPTH_ONLY: 2 };
        static ProjectionType = { ORTHO: 1 };
    }
    class Material {
        constructor() { this.isValid = true; state.materials.push(this); }
        initialize() { if (state.materials.length === state.failMaterial) throw Error('material construction'); }
        setProperty() {} destroy() { this.isValid = false; }
    }
    class Mesh { constructor() { this.isValid = true; state.meshes.push(this); } destroy() { this.isValid = false; } }
    const view = {
        on(name, callback) { listeners.set(callback, name); }, off(name, callback) { listeners.delete(callback); },
        setDesignResolutionSize() {}, getVisibleSize: () => ({ width: 720, height: 1280 }),
        getViewportRect: () => ({ x: 0, y: 0 }), getFrameSize: () => ({ width: 720, height: 1280 }),
        getScaleX: () => 1, getScaleY: () => 1,
    };
    const cc = {
        Node, UITransform, Color, Graphics, Camera, Material, Mesh, view, BlockInputEvents: class {}, Prefab: class {}, instantiate: () => new Node('prefab'),
        Component: class {}, Canvas: class {}, Label: class {}, UIOpacity: class {},
        _decorator: { ccclass: () => Type => Type, property: () => () => {} },
        Layers: { Enum: { UI_2D: 1, UI_3D: 2, DEFAULT: 4 } }, ResolutionPolicy: { SHOW_ALL: 1 },
        Game: { EVENT_HIDE: 'hide', EVENT_SHOW: 'show' }, game: { on() {}, off() {} },
        profiler: { hideStats() {} },
        screen: { windowSize: { width: 720, height: 1280 }, devicePixelRatio: 1 },
        Director: { EVENT_END_FRAME: 'end-frame' },
        director: { getScene: () => null, once: (name, callback) => state.scheduled.push(callback) },
        sys: { getSafeAreaRect: () => ({ x: 0, y: 0, width: 720, height: 1280 }) },
        primitives: { box: () => ({}) }, utils: { MeshUtils: { createMesh: () => new Mesh() } },
    };
    const ui = {
        createUiNode(parent, name) { const node = new Node(name); parent.addChild(node); return node; },
        createLabelNode(parent, name) { return { node: ui.createUiNode(parent, name) }; },
        createTextButton(parent, projector, name, text, x, y, w, h, action) {
            const node = ui.createUiNode(parent, name); node.action = action; return node;
        },
        drawPanel() {}, hexColor: () => new Color(), placeAtDesign() {},
    };
    const config = { COLORS: {}, UI_LAYOUT: { board: { top: 120, bottom: 800 } }, TIMING: { resultPanelDelayMs: 1000 }, DESIGN_SIZE: { width: 720, height: 1280 } };
    const projector = { scale: 1, contentOffset: { x: 0, y: 0 }, cameraOrthoHalfHeight: 6.4, configure() {}, setViewport() {}, setCamera() {}, getCamera: () => null };
    return { cc, ui, config, projector, state, nodes, listeners };
}

function gameRootFixture(failAt) {
    const engine = engineFixture();
    const state = { released: 0, allocated: 0, detached: 0, disposed: [], renderFailure: false };
    const makeView = name => class {
        constructor(parent, second) {
            const node = new engine.cc.Node(name); parent.addChild(node);
            if (name === 'BoardView') second.addChild(new engine.cc.Node('partial-labels'));
            this.node = node;
            if (failAt === name) throw Error(name + ' construction');
        }
        dispose() { state.disposed.push(name); this.node.destroy(); if (failAt === name + ':dispose') throw Error('dispose'); }
        render() { if (state.renderFailure) throw Error('render failure'); }
        refreshLayout() {} hide() {} showToast() {} setMetrics() {} cancelSession() {} pause() {} resume() {}
    };
    const { GameRoot } = loadSource('assets/Game/Presentation/GameRoot.ts', {
        cc: engine.cc,
        '../../Framework/Kernel/LifecycleScope': { LifecycleScope },
        '../Config/PresentationConfig': engine.config,
        './TableProjector': {},
        './Table3D/BoardView': {
            BoardResources: class {
                constructor() { state.allocated++; }
                release() { state.released++; }
            }, BoardView: makeView('BoardView'),
        },
        './EffectPresenter': { EffectPresenter: makeView('Effects') },
        './UI/BoardInput': { BoardInput: class {
            attach() { if (failAt === 'attach') throw Error('input attach'); }
            detach() { state.detached++; } setEnabled() {} getMetrics() { return {}; }
        } },
        './UI/BufferView': { BufferView: makeView('Buffer') },
        './UI/HudView': { ...engine.ui, HudView: makeView('Hud') },
        './UI/MeldView': { MeldView: makeView('Meld') },
        './UI/ResultView': { ResultView: makeView('Result') },
        './TouchPerformanceRecorder': { TouchPerformanceRecorder },
    });
    const contentRoot = new engine.cc.Node('external-ui');
    const tableRoot = new engine.cc.Node('external-table');
    return { ...engine, state, contentRoot, tableRoot, create: (options = {}) => new GameRoot({ contentRoot, tableRoot, projector: engine.projector, ...options }) };
}

test('GameRoot: full-frame UI camera includes SHOW_ALL letterbox and content fit applies once', () => {
    const f = gameRootFixture();
    f.cc.view.getScaleY = () => 390 / 720;
    const applications = [];
    const ui = new f.cc.Camera(); ui.node = new f.cc.Node('ui');
    const board = new f.cc.Camera(); board.node = new f.cc.Node('board');
    const viewport = { snapshot: { physicalHeight: 844, ui: { viewport: { height: 1280 } } },
        applyContent: node => applications.push(node), applyCamera: camera => applications.push(camera) };
    const root = f.create({ viewport, cameras: [ui, board], cameraUnits: [1, 0.01] });
    root.refreshViewport();
    assert.ok(Math.abs(ui.orthoHeight - 779.0769230769231) < 1e-8);
    assert.deepEqual(applications, [f.contentRoot, board]);
    root.unmount();
});

for (const failure of ['BoardView', 'Hud', 'Buffer', 'Meld', 'Effects', 'Result', 'attach']) {
    test('construction rollback: ' + failure + ' failure leaves no owned nodes or resources', () => {
        const fixture = gameRootFixture(failure);
        assert.throws(() => fixture.create(), /construction|attach/);
        assert.equal(fixture.state.allocated, 1);
        assert.equal(fixture.state.released, 1);
        assert.equal(fixture.contentRoot.isValid, true);
        assert.equal(fixture.tableRoot.isValid, true);
        assert.equal(fixture.contentRoot.children.length + fixture.tableRoot.children.length, 0);
        assert.ok(fixture.nodes.filter(n => n !== fixture.contentRoot && n !== fixture.tableRoot).every(n => !n.isValid));
    });
}

test('GameRoot lifetime: scene scope closes input, listeners, all views and assets once', () => {
    const fixture = gameRootFixture('Hud:dispose');
    const root = fixture.create();
    const scope = new LifecycleScope();
    let subscriptions = 0;
    root.mount({ subscribe() { subscriptions++; return () => subscriptions--; }, getSnapshot: () => ({ sessionId: 'test', terminal: null }) }, scope);
    assert.equal(fixture.listeners.size, 1);
    scope.dispose();
    root.unmount();
    assert.equal(subscriptions, 0);
    assert.equal(fixture.listeners.size, 0);
    assert.equal(fixture.state.released, 1);
    assert.equal(fixture.state.detached, 1);
    assert.equal(fixture.state.disposed.length, 6);
    assert.equal(fixture.contentRoot.children.length + fixture.tableRoot.children.length, 0);
});

test('GameRoot: mount rendering failure rolls back without relying on the caller to unmount', () => {
    const fixture = gameRootFixture(); const root = fixture.create(); const scope = new LifecycleScope();
    let subscriptions = 0; fixture.state.renderFailure = true;
    assert.throws(() => root.mount({ subscribe() { subscriptions++; return () => subscriptions--; }, getSnapshot: () => ({ sessionId: 'test' }) }, scope), /render failure/);
    assert.equal(subscriptions, 0); assert.equal(fixture.listeners.size, 0);
    assert.equal(fixture.state.released, 1); scope.dispose(); root.unmount();
    assert.equal(fixture.state.released, 1);
});

test('GameRoot: mounting into a closed scene scope cannot resurrect a disposed root', () => {
    const fixture = gameRootFixture(); const root = fixture.create(); const scope = new LifecycleScope(); scope.dispose();
    assert.throws(() => root.mount({ subscribe: () => () => {}, getSnapshot() { throw Error('must not be read'); } }, scope), /already disposed/);
    assert.equal(fixture.state.released, 1); assert.equal(fixture.listeners.size, 0);
});

test('GameRoot: supported window-size API preserves CSS frame dimensions at DPR 1/2/3', () => {
    const fixture = gameRootFixture();
    const camera = { node: { setPosition() {} }, orthoHeight: 0 };
    Object.assign(fixture.projector, {
        getCamera: () => camera,
        designToUi: (x, y) => ({ x, y: 1280 - y }),
        designToWorld: () => ({ x: 0, y: 0 }),
    });
    const root = fixture.create();
    for (const dpr of [1, 2, 3]) {
        fixture.cc.screen.devicePixelRatio = dpr;
        fixture.cc.screen.windowSize = { width: 720 * dpr, height: 1280 * dpr };
        root.refreshViewport(); assert.equal(camera.orthoHeight, 6.4);
    }
    root.unmount();
});

for (const failure of [1, 2, 3]) {
    test('BoardResources: material ' + failure + ' failure destroys partial material and earlier assets', () => {
        const fixture = engineFixture(); fixture.state.failMaterial = failure;
        const { BoardResources } = loadSource('assets/Game/Presentation/Table3D/BoardView.ts', {
            cc: fixture.cc, '../../../Framework/Kernel/LifecycleScope': { LifecycleScope },
            '../../Config/Level888': {}, '../../Config/PresentationConfig': fixture.config, './BlockView': {},
        });
        assert.throws(() => new BoardResources(), /material construction/);
        assert.ok([...fixture.state.meshes, ...fixture.state.materials].every(asset => !asset.isValid));
        assert.equal(BoardResources.counts().liveMeshes, 0);
        assert.equal(BoardResources.counts().liveMaterials, 0);
    });
}

test('BoardResources: normal release is frame-deferred, complete and idempotent', () => {
    const fixture = engineFixture(); fixture.cc.director.getScene = () => ({});
    const { BoardResources } = loadSource('assets/Game/Presentation/Table3D/BoardView.ts', {
        cc: fixture.cc, '../../../Framework/Kernel/LifecycleScope': { LifecycleScope },
        '../../Config/Level888': {}, '../../Config/PresentationConfig': fixture.config, './BlockView': {},
    });
    const resources = new BoardResources(); resources.release(); resources.release();
    assert.equal(fixture.state.scheduled.length, 1);
    assert.equal(BoardResources.counts().liveMaterials, 3);
    fixture.state.scheduled[0]();
    assert.ok([...fixture.state.meshes, ...fixture.state.materials].every(asset => !asset.isValid));
    assert.equal(BoardResources.counts().liveMeshes + BoardResources.counts().liveMaterials, 0);
});

test('BoardResources: failed frame-end registration cannot strand shared resources', () => {
    const fixture = engineFixture(); fixture.cc.director.getScene = () => ({});
    fixture.cc.director.once = () => { throw Error('scheduler unavailable'); };
    const { BoardResources } = loadSource('assets/Game/Presentation/Table3D/BoardView.ts', {
        cc: fixture.cc, '../../../Framework/Kernel/LifecycleScope': { LifecycleScope },
        '../../Config/Level888': {}, '../../Config/PresentationConfig': fixture.config, './BlockView': {},
    });
    const resources = new BoardResources(); resources.release(); resources.release();
    assert.equal(BoardResources.counts().liveMeshes + BoardResources.counts().liveMaterials, 0);
});

function bootstrapFixture({ initFailure = false, startFailure = false, rootFailure = false, debug = false, search = '?r01diag=1' } = {}) {
    const engine = engineFixture();
    const state = { initFailure, startFailure, rootFailure, mounts: 0, unmounts: 0, initCalls: 0, startCalls: 0, pauses: 0, resumes: 0, gate: null };
    let gameModule;
    const app = {
        async init(options) { state.initCalls++; gameModule = options.modules.find(item => item.name === 'game').module; if (state.gate) await state.gate; await gameModule.init?.(); if (state.initFailure) throw Error('actual App.init rejection'); },
        async start() { state.startCalls++; gameModule.start(); if (state.startFailure) throw Error('actual App.start rejection'); },
        async dispose() { gameModule?.dispose(); gameModule = null; }, update() {},
    };
    const { GameBootstrap, context } = loadSource('assets/Game/Bootstrap/GameBootstrap.ts', {
        cc: engine.cc, 'cc/env': { DEBUG: debug }, '../../Framework/Core/App': { App: { Instance: app } },
        './GameAppLifecycle': { GameAppLifecycle: { tryClaim: () => Symbol('test'), waitForClaim: async () => Symbol('test'), owns: () => true, release: (_token, close) => { void close(); return Promise.resolve(); } } },
        '../../Framework/Kernel/PauseController': { PauseController: class { constructor() { this.paused = false; } get isPaused() { return this.paused; } set(_r, value) { this.paused = value; } subscribe() { return () => {}; } dispose() {} } },
        '../../Framework/Core/RuntimeLifecycle': { RuntimeLifecycle: class { constructor() { this.dependencies = ['timers']; } init() {} dispose() { return Promise.resolve(); } } },
        '../../Framework/Core/ResManager': { ResManager: { Instance: { acquire: async () => { throw new Error('background unavailable in unit fixture'); } } } },
        '../../Framework/Core/ViewportService': { ViewportService: class {
            start() {} applyContent() {} applyCamera() {} dispose() {}
            subscribe() { return () => {}; }
            get snapshot() { return { ui: {}, pixels: {} }; }
        } },
        '../../Framework/Kernel/LifecycleScope': { LifecycleScope },
        '../Application/GameSession': { GameSession: class { dispose() {} } },
        '../Config/Level888': { LEVEL_888: {} }, '../Config/PresentationConfig': engine.config,
        '../Presentation/GameRoot': { GameRoot: class {
            constructor(options) { if (state.rootFailure) throw Error('root construction'); this.pauses = options?.pauses; }
            mount() { state.mounts++; if (this.pauses?.isPaused) state.pauses++; } unmount() { state.unmounts++; } refreshViewport() {}
            pause() { state.pauses++; } resume() { state.resumes++; }
        } },
        '../Presentation/TableProjector': { TableProjector: class { constructor() { Object.assign(this, engine.projector); } } },
        '../Presentation/UI/SkyWhiteGameView': { SkyWhiteGameView: class {}, SKY_BOARD: {}, SKY_MELD: {}, skyBufferTarget() {} },
        '../Presentation/UI/MainUiShape': {},
        '../Presentation/UI/HudView': engine.ui,
    }, { window: { location: { search } } });
    const bootstrap = new GameBootstrap(); bootstrap.node = new engine.cc.Node('bootstrap');
    const find = name => engine.nodes.findLast(node => node.isValid && node.name === name);
    return { ...engine, state, bootstrap, find, context };
}

for (const failure of ['initFailure', 'startFailure', 'rootFailure']) {
    test('Bootstrap ' + failure + ': actual exception shows retry UI and retry recovers', async () => {
        const fixture = bootstrapFixture({ [failure]: true });
        fixture.bootstrap.onLoad(); await turn();
        assert.ok(fixture.find('StartupError'));
        assert.equal(fixture.find('GameScene'), undefined);
        assert.equal(fixture.bootstrap.driving, false);
        fixture.state[failure] = false;
        await fixture.bootstrap.retry();
        assert.equal(fixture.bootstrap.driving, true);
        assert.ok(fixture.find('GameScene'));
        assert.equal(fixture.find('StartupError'), undefined);
        assert.equal(fixture.find('StartupFallback'), undefined);
        fixture.bootstrap.onDestroy(); await turn();
        assert.equal(fixture.bootstrap.node.children.length, 0);
    });
}

test('Bootstrap: camera failure before overlay construction still gets fallback UI and a clean retry', async () => {
    const fixture = bootstrapFixture();
    // The engine fixture throws once, before a component is returned to buildScene.
    const original = fixture.cc.Node.prototype.addComponent;
    let once = true;
    fixture.cc.Node.prototype.addComponent = function(Type) {
        if (once && Type === fixture.cc.Camera) { once = false; throw Error('first camera'); }
        return original.call(this, Type);
    };
    fixture.bootstrap.onLoad(); await turn();
    assert.ok(fixture.find('StartupFallback'));
    assert.ok(fixture.find('RetryButton'));
    await fixture.bootstrap.retry();
    assert.equal(fixture.bootstrap.driving, true);
    assert.equal(fixture.bootstrap.node.children.filter(n => n.name === 'GameScene').length, 1);
    fixture.bootstrap.onDestroy(); await turn();
});

test('Bootstrap: a retry constructor failure stays handled, shows error, and permits another retry', async () => {
    const fixture = bootstrapFixture({ rootFailure: true });
    fixture.bootstrap.onLoad(); await turn();
    await assert.doesNotReject(fixture.bootstrap.retry());
    assert.ok(fixture.find('StartupError'));
    fixture.state.rootFailure = false;
    await fixture.bootstrap.retry();
    assert.equal(fixture.bootstrap.driving, true);
    fixture.bootstrap.onDestroy(); await turn();
});

test('Bootstrap: destroy during App.init prevents late start, retry and resurrection', async () => {
    const fixture = bootstrapFixture(); let resolve;
    fixture.state.gate = new Promise(done => { resolve = done; });
    fixture.bootstrap.onLoad();
    fixture.bootstrap.onDestroy(); resolve(); await turn();
    await fixture.bootstrap.retry();
    assert.equal(fixture.state.startCalls, 0);
    assert.equal(fixture.state.initCalls, 1);
    assert.equal(fixture.bootstrap.driving, false);
    assert.equal(fixture.bootstrap.node.children.length, 0);
});

test('Bootstrap: hide during startup pauses after mount; diagnostics removed on exit', async () => {
    const fixture = bootstrapFixture({ debug: true }); let resolve;
    fixture.state.gate = new Promise(done => { resolve = done; });
    fixture.bootstrap.onLoad(); fixture.bootstrap.hide(); resolve(); await turn();
    assert.ok(fixture.state.pauses >= 1);
    assert.ok(fixture.context.__R0__);
    fixture.bootstrap.show(); assert.equal(fixture.state.resumes, 0);
    fixture.bootstrap.onDestroy(); await turn();
    assert.equal(fixture.context.__R0__, undefined);
});

test('Bootstrap: twenty full reinitializations keep one scene and serialize duplicate retries', async () => {
    const fixture = bootstrapFixture(); fixture.bootstrap.onLoad(); await turn();
    for (let i = 0; i < 20; i++) {
        await Promise.all([fixture.bootstrap.retry(), fixture.bootstrap.retry()]);
        assert.equal(fixture.bootstrap.node.children.length, 1);
        assert.ok(fixture.find('GameScene'));
        assert.equal(fixture.bootstrap.driving, true);
    }
    assert.equal(fixture.state.initCalls, 21);
    fixture.bootstrap.onDestroy(); await turn();
    assert.equal(fixture.bootstrap.node.children.length, 0);
});

for (const phase of ['init', 'start']) {
    test('Bootstrap: debug ' + phase + ' injection is one-shot and uses the real lifecycle callback', async () => {
        const fixture = bootstrapFixture({ debug: true, search: '?r01diag=1&r03fault=' + phase });
        fixture.bootstrap.onLoad(); await turn();
        assert.ok(fixture.find('StartupError'));
        assert.equal(fixture.bootstrap.driving, false);
        await fixture.bootstrap.retry();
        assert.equal(fixture.bootstrap.driving, true);
        fixture.bootstrap.onDestroy(); await turn();
    });
}

test('Bootstrap: release ignores diagnostic and fault parameters and exposes no debug controls/global', async () => {
    const fixture = bootstrapFixture({ debug: false, search: '?r01diag=1&r03fault=start' });
    fixture.bootstrap.onLoad(); await turn();
    assert.equal(fixture.bootstrap.driving, true);
    assert.equal(fixture.context.__R0__, undefined);
    assert.equal(fixture.find('R03DebugControls'), undefined);
    assert.equal(fixture.find('StartupError'), undefined);
    fixture.bootstrap.onDestroy(); await turn();
});


test('Main layoutOnly does not initialize App, GameSession, game root or input',async()=>{
    const f=bootstrapFixture();f.bootstrap.layoutOnly=true;f.bootstrap.onLoad();await turn();
    assert.equal(f.state.initCalls,0);assert.equal(f.state.startCalls,0);assert.equal(f.state.mounts,0);
    assert.equal(f.bootstrap.session,null);assert.equal(f.bootstrap.gameRoot,null);assert.equal(f.bootstrap.driving,false);
    f.bootstrap.onDestroy();await turn();assert.equal(f.bootstrap.viewport,null);
});
