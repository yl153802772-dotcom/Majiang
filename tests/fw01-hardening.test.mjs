import test from 'node:test';
import assert from 'node:assert/strict';
import { game, Game, sys, Vec3, Node, UITransform, Prefab, JsonAsset, AudioClip, AudioSource, Sprite, Material, Widget, assets, setLoadOverride } from 'cc';
import { ResourceCache } from '../assets/Framework/Kernel/ResourceCache.ts';
import { FrameworkBootstrap } from '../assets/Framework/Core/FrameworkBootstrap.ts';
import { App } from '../assets/Framework/Core/App.ts';
import { Logger, LogLevel } from '../assets/Framework/Core/Logger.ts';
import { PlatformManager } from '../assets/Framework/Core/Platform/PlatformManager.ts';
import { SequenceContext } from '../assets/Framework/Core/VisualSequence/SequenceContext.ts';
import { SequenceManager } from '../assets/Framework/Core/VisualSequence/SequenceManager.ts';
import { GameObjectPool } from '../assets/Framework/Core/Pool/GameObjectPool.ts';
import { LifecycleScope } from '../assets/Framework/Kernel/LifecycleScope.ts';
import { ResManager } from '../assets/Framework/Core/ResManager.ts';
import { UIManager } from '../assets/Framework/Core/UIManager.ts';
import { UIBase } from '../assets/Framework/Components/UIBase.ts';
import { UIPool } from '../assets/Framework/Components/UIPool.ts';
import { AudioSystem } from '../assets/Framework/Core/AudioSystem.ts';
import { ConfigManager } from '../assets/Framework/Core/ConfigManager.ts';
import { AnimationHelper } from '../assets/Framework/Core/AnimationHelper.ts';
import { SpriteMaterialHelper } from '../assets/Framework/Utils/SpriteMaterialHelper.ts';
import { FrameAnimator } from '../assets/Framework/Components/FrameAnimator.ts';
import { SpriteAtlas, SpriteFrame } from 'cc';

// 中文注释：故障注入验证收尾契约，不模拟渲染器、真实微信或设备内存。
const turn = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const causes = error => [error, ...(error?.causes ?? []).flatMap(causes)];
function resources(t) {
    const manager = ResManager.Instance;
    manager.dispose(); manager.init({ maxIdle: 0 });
    t.after(() => { setLoadOverride(null); manager.dispose(); });
    return manager;
}
function fixture(t, key, asset) { assets.set(key, asset); t.after(() => assets.delete(key)); return asset; }
function uiRoot() { const node = new Node('UIRoot'); node.addComponent(UITransform); return node; }
function prefabOf(View = UIBase) { const prefab = new Prefab(); prefab.factory = () => { const node = new Node('View'); node.addComponent(View); return node; }; return prefab; }
function quiet(t) { const level = Logger.getLogLevel(); Logger.setLogLevel(LogLevel.SILENT); t.after(() => Logger.setLogLevel(level)); }
async function stopBootstrap(bootstrap) { bootstrap.onDestroy(); await bootstrap.cleanupTask; await turn(); }

test('FW01 resource retain failure removes the rejected entry and permits a real retry', async () => {
    let loads = 0, fail = true, references = 0;
    const cache = new ResourceCache({
        async load() { loads++; return {}; },
        retain() { if (fail) throw new Error('retain failed'); references++; },
        release() { references--; },
    }, 1, 0);
    await assert.rejects(cache.acquire('same'), /retain failed/);
    fail = false;
    const handle = await cache.acquire('same');
    assert.equal(loads, 2);
    handle.release(); cache.dispose();
    assert.equal(references, 0);
});

test('FW01 bootstrap scope failure cannot skip listener removal or application disposal', async t => {
    const bootstrap = new FrameworkBootstrap();
    const app = App.Instance, dispose = app.dispose, level = Logger.getLogLevel();
    let disposed = 0;
    app.dispose = async () => { disposed++; };
    Logger.setLogLevel(LogLevel.SILENT);
    bootstrap.owns = true; bootstrap.ownsApp = true;
    game.on(Game.EVENT_HIDE, bootstrap.hide, bootstrap);
    game.on(Game.EVENT_SHOW, bootstrap.show, bootstrap);
    bootstrap.lifetime.add(() => { throw new Error('injected scope cleanup'); });
    t.after(() => {
        app.dispose = dispose; Logger.setLogLevel(level);
        game.off(Game.EVENT_HIDE, bootstrap.hide, bootstrap);
        game.off(Game.EVENT_SHOW, bootstrap.show, bootstrap);
    });
    assert.doesNotThrow(() => bootstrap.onDestroy());
    await turn();
    assert.equal(disposed, 1);
    assert.equal(game.listeners.get(Game.EVENT_HIDE)?.length ?? 0, 0);
    assert.equal(game.listeners.get(Game.EVENT_SHOW)?.length ?? 0, 0);
});

test('FW01 sequence cancellation attempts every listener and reports errors once', () => {
    const context = new SequenceContext(new Vec3());
    let later = 0;
    context.onCancel(() => { throw new Error('first cancellation failed'); });
    context.onCancel(() => later++);
    assert.throws(() => context.cancel());
    assert.equal(later, 1);
    context.cancel(); assert.equal(later, 1);
});

test('FW01 ad cleanup failure still settles and attempts all remaining cleanup', async t => {
    const platform = sys.platform, originalWx = globalThis.wx;
    let close, offError = 0, destroyed = 0;
    sys.platform = sys.Platform.WECHAT_GAME;
    globalThis.wx = { createRewardedVideoAd() { return {
        onClose(callback) { close = callback; },
        offClose() { throw new Error('offClose failed'); },
        onError() {}, offError() { offError++; },
        show() { return Promise.resolve(); }, load() { return Promise.resolve(); },
        destroy() { destroyed++; },
    }; } };
    t.after(() => { sys.platform = platform; if (originalWx === undefined) delete globalThis.wx; else globalThis.wx = originalWx; });
    const pending = new PlatformManager().adapter.showRewardAd('test-only-injected-id');
    assert.doesNotThrow(() => close({ isEnded: true }));
    const result = await pending;
    assert.equal(result.status, 'completed');
    assert.ok(result.error, 'cleanup failures remain observable without losing the watched result');
    assert.equal(offError, 1); assert.equal(destroyed, 1);
});

test('FW01 cache disposal attempts every eviction even when release throws', async () => {
    const released = [];
    const cache = new ResourceCache({ async load(key) { return key; }, retain() {},
        release(key) { released.push(key); if (key === 'a') throw new Error('release a'); } }, 2, 2);
    const a = await cache.acquire('a'), b = await cache.acquire('b'); a.release(); b.release();
    assert.throws(() => cache.dispose(), /Resource/);
    assert.deepEqual(released.sort(), ['a', 'b']); assert.equal(cache.stats().entries, 0);
    cache.dispose(); assert.equal(released.length, 2);
});

test('FW01 failing idle eviction cannot prevent queued cancellation and late release', async () => {
    const gate = deferred(), scope = new LifecycleScope(), released = [];
    const cache = new ResourceCache({ async load(key) { if (key === 'slow') await gate.promise; return key; }, retain() {},
        release(key) { released.push(key); if (key === 'idle') throw new Error('idle cleanup'); } }, 1, 1);
    const idle = await cache.acquire('idle'); idle.release(); await turn();
    const slow = cache.acquire('slow', { scope }), queued = cache.acquire('queued', { scope });
    const canceled = Promise.all([assert.rejects(slow), assert.rejects(queued)]);
    await turn(); scope.dispose(); await canceled;
    assert.throws(() => cache.dispose()); assert.equal(cache.stats().queued, 0);
    gate.resolve(); await turn(); await turn();
    assert.deepEqual(released.sort(), ['idle', 'slow']); assert.equal(cache.stats().loading, 0);
});

test('FW01 late release failure remains observable and is not repeated', async () => {
    const gate = deferred(), scope = new LifecycleScope(); let releases = 0;
    const cache = new ResourceCache({ async load() { await gate.promise; return {}; }, retain() {},
        release() { releases++; throw new Error('late release'); } }, 1, 0);
    const request = cache.acquire('late', { scope }), canceled = assert.rejects(request);
    await turn(); scope.dispose(); await canceled; cache.dispose(); gate.resolve();
    await turn(); await turn();
    assert.ok(causes(cache.lastError).some(e => e?.message === 'late release'));
    assert.equal(releases, 1); cache.dispose(); assert.equal(releases, 1);
});

for (const partial of [false, true]) test('FW01 Cocos retain rollback is atomic; partial=' + partial, async t => {
    const manager = resources(t), asset = fixture(t, 'fw01-retain', new JsonAsset());
    const original = asset.addRef; let broken = true;
    asset.addRef = function () { if (!broken || partial) original.call(this); if (broken) throw new Error('addRef failed'); return this; };
    await assert.rejects(manager.acquire('fw01-retain', JsonAsset), /addRef failed/);
    assert.equal(asset.refCount, 0); broken = false;
    const handle = await manager.acquire('fw01-retain', JsonAsset); handle.release();
    assert.equal(asset.refCount, 0); assert.equal(manager.releaseBundle('resources'), true);
});

test('FW01 resource manager detaches a disposed cache after a release error and can reinitialize', async t => {
    const manager = resources(t); manager.dispose(); manager.init({ maxIdle: 1 });
    const asset = fixture(t, 'fw01-release', new JsonAsset()), original = asset.decRef;
    asset.decRef = function () { original.call(this); throw new Error('decRef failed after release'); };
    const handle = await manager.acquire('fw01-release', JsonAsset); handle.release();
    assert.throws(() => manager.dispose()); assert.equal(asset.refCount, 0);
    asset.decRef = original; manager.init({ maxIdle: 0 });
    const fresh = await manager.acquire('fw01-release', JsonAsset); fresh.release(); manager.dispose();
    assert.equal(asset.refCount, 0);
});

test('FW01 cache refuses disposal while owned and remains usable until the owner releases', async () => {
    let references = 0;
    const cache = new ResourceCache({ async load() { return {}; }, retain() { references++; }, release() { references--; } });
    const h = await cache.acquire('owned'); assert.throws(() => cache.dispose(), /still owned/);
    assert.equal(h.released, false); h.release(); cache.dispose(); assert.equal(references, 0);
});

test('FW01 generic bootstrap can recover from an actual UI module init failure', async t => {
    quiet(t);
    const node = new Node('Framework'), bootstrap = node.addComponent(FrameworkBootstrap), root = new Node('MissingTransform');
    bootstrap.uiRoot = root;
    t.after(async () => { await stopBootstrap(bootstrap); node.destroy(); root.destroy(); });
    bootstrap.onLoad(); await assert.rejects(bootstrap.retry(), /initialization failed/);
    assert.equal(bootstrap.startupState, 'failed'); assert.ok(bootstrap.lastError);
    assert.equal(game.listeners.get(Game.EVENT_HIDE)?.length ?? 0, 0);
    root.addComponent(UITransform); await bootstrap.retry();
    assert.equal(bootstrap.startupState, 'running'); assert.equal(root.children.length, 5);
    await stopBootstrap(bootstrap); assert.equal(root.children.length, 0);
    await assert.rejects(bootstrap.retry(), /not active/);
});

test('FW01 generic bootstrap start failure rolls back and retries without duplicate listeners', async t => {
    quiet(t);
    const bootstrap = new Node('Framework').addComponent(FrameworkBootstrap), app = App.Instance, original = app.start;
    let failed = false;
    app.start = async function () { if (!failed) { failed = true; throw new Error('start failed'); } return original.call(this); };
    t.after(async () => { app.start = original; await stopBootstrap(bootstrap); });
    bootstrap.onLoad(); await assert.rejects(bootstrap.retry(), /start failed/);
    await bootstrap.retry(); assert.equal(bootstrap.startupState, 'running');
    assert.equal(game.listeners.get(Game.EVENT_HIDE)?.length, 1);
    assert.equal(game.listeners.get(Game.EVENT_SHOW)?.length, 1);
});

test('FW01 destroy during actual module initialization prevents old start and serializes replacement', async t => {
    quiet(t);
    const gate = deferred(), manager = ResManager.Instance, original = manager.init;
    let entered = false, blocked = false;
    manager.init = function (options) {
        original.call(this, options);
        if (!blocked) { blocked = true; entered = true; return gate.promise; }
    };
    const old = new Node('Old').addComponent(FrameworkBootstrap), fresh = new Node('Fresh').addComponent(FrameworkBootstrap);
    t.after(async () => { gate.resolve(); manager.init = original; await stopBootstrap(old); await stopBootstrap(fresh); });
    old.onLoad(); const oldStart = old.retry(); await turn(); assert.equal(entered, true);
    old.onDestroy(); fresh.onLoad(); const newStart = fresh.retry();
    await turn(); assert.equal(fresh.startupState, 'starting');
    gate.resolve(); await oldStart; await newStart;
    assert.equal(old.startupState, 'destroyed'); assert.equal(fresh.startupState, 'running');
    assert.equal(game.listeners.get(Game.EVENT_HIDE)?.length, 1);
});

test('FW01 host listener setup failure unwinds partial registration before retry', async t => {
    quiet(t);
    const original = game.on, bootstrap = new Node('Framework').addComponent(FrameworkBootstrap);
    let fail = true;
    game.on = function (event, ...args) { original.call(this, event, ...args); if (event === Game.EVENT_SHOW && fail) throw new Error('listener setup'); };
    t.after(async () => { game.on = original; await stopBootstrap(bootstrap); });
    bootstrap.onLoad(); await assert.rejects(bootstrap.retry(), /listener setup/);
    assert.equal(game.listeners.get(Game.EVENT_HIDE)?.length ?? 0, 0);
    assert.equal(game.listeners.get(Game.EVENT_SHOW)?.length ?? 0, 0);
    fail = false; await bootstrap.retry(); assert.equal(bootstrap.startupState, 'running');
});

test('FW01 self-check failure scopes both loads and recovers after missing asset is supplied', async t => {
    quiet(t);
    const key = 'framework-smoke/config', oldAsset = assets.get(key);
    assets.delete(key);
    const bootstrap = new Node('Framework').addComponent(FrameworkBootstrap); bootstrap.runSelfCheck = true;
    t.after(async () => { await stopBootstrap(bootstrap); if (oldAsset === undefined) assets.delete(key); else assets.set(key, oldAsset); });
    bootstrap.onLoad(); await assert.rejects(bootstrap.retry());
    assert.equal(ResManager.Instance.getDebugInfo().owners, 0);
    const asset = new JsonAsset(); asset.json = { framework: 'generic-v1' }; assets.set(key, asset);
    await bootstrap.retry(); assert.equal(bootstrap.startupState, 'running'); assert.equal(asset.refCount, 0);
});

test('FW01 twenty generic host lifecycles leave no UI layers, listeners or resource owners', async t => {
    quiet(t);
    for (let i = 0; i < 20; i++) {
        const root = uiRoot(), node = new Node('Host-' + i), bootstrap = node.addComponent(FrameworkBootstrap);
        bootstrap.uiRoot = root; bootstrap.onLoad();
        await bootstrap.retry(); assert.equal(root.children.length, 5);
        await stopBootstrap(bootstrap); assert.equal(root.children.length, 0);
        assert.equal(game.listeners.get(Game.EVENT_HIDE)?.length ?? 0, 0);
        assert.equal(ResManager.Instance.getDebugInfo().owners, 0);
        root.destroy(); node.destroy();
    }
});

test('FW01 sequence listener failure cannot skip effect cancellation, recycling or settlement', () => {
    const pool = GameObjectPool.Instance, prefab = new Prefab(), key = 'fw01-sequence';
    pool.registerPrefab(key, prefab); const node = pool.spawn(key); let effectCanceled = 0;
    const context = SequenceManager.play({ playPhase1() {}, playPhase2() {}, cancel() { effectCanceled++; } }, [node], new Vec3());
    context.onCancel(() => { throw new Error('external cancel'); });
    assert.throws(() => context.cancel());
    assert.equal(effectCanceled, 1); assert.equal(pool.getDebugInfo().active, 0);
    assert.equal(SequenceManager.tasks.size, 0); pool.clear(key); assert.equal(prefab.refCount, 0);
});

test('FW01 UI initialization rolls back a partially created layer and permits retry', t => {
    const manager = new UIManager(), root = uiRoot(), original = Node.prototype.addComponent;
    let fail = true;
    Node.prototype.addComponent = function (type) { if (type === Widget && fail) throw new Error('widget failed'); return original.call(this, type); };
    t.after(() => { Node.prototype.addComponent = original; manager.dispose(); root.destroy(); });
    assert.throws(() => manager.init(root), /widget failed/); assert.equal(root.children.length, 0);
    fail = false; manager.init(root); assert.equal(root.children.length, 5);
});

test('FW01 UI onInit plus cleanup failure preserves both errors and releases the prefab', async t => {
    resources(t); const manager = new UIManager(), root = uiRoot(); manager.init(root);
    const initial = new Error('onInit failed'), cleanup = new Error('custom cleanup failed'); let node;
    class Broken extends UIBase { onInit() { this.lifetime.add(() => { throw cleanup; }); throw initial; } }
    const bad = fixture(t, 'fw01-ui-bad', prefabOf(Broken));
    bad.factory = () => { node = new Node(); node.addComponent(Broken); return node; };
    t.after(() => { manager.dispose(); root.destroy(); });
    manager.register('view', { path: 'fw01-ui-bad' });
    let failure; try { await manager.openUI('view'); } catch (e) { failure = e; }
    assert.ok(causes(failure).includes(initial)); assert.ok(causes(failure).includes(cleanup));
    assert.equal(bad.refCount, 0); assert.equal(node.isValid, false);
    assets.set('fw01-ui-bad', prefabOf()); await manager.openUI('view'); manager.closeUI('view');
});

test('FW01 UI dispose continues after a view and parent scope fail, and can initialize again', async t => {
    resources(t); const manager = new UIManager(), root = uiRoot(); manager.init(root);
    class Broken extends UIBase { onDestroyUI() { super.onDestroyUI(); throw new Error('view cleanup'); } }
    const a = fixture(t, 'fw01-ui-a', prefabOf(Broken)), b = fixture(t, 'fw01-ui-b', prefabOf());
    manager.register('a', { path: 'fw01-ui-a' }); manager.register('b', { path: 'fw01-ui-b' });
    await manager.openUI('a'); const good = await manager.openUI('b');
    manager.scope.add(() => { throw new Error('parent scope'); });
    assert.throws(() => manager.dispose());
    assert.equal(a.refCount, 0); assert.equal(b.refCount, 0); assert.equal(good.node.isValid, false);
    assert.equal(root.children.length, 0); manager.init(root); manager.dispose(); root.destroy();
});

test('FW01 failed cached onShow ends its show scope and deactivates the instance', () => {
    let cleaned = 0;
    class Broken extends UIBase { onShow() { this.showScope.add(() => cleaned++); throw new Error('show failed'); } }
    const node = new Node(), view = node.addComponent(Broken);
    assert.throws(() => view.show(), /show failed/);
    assert.equal(cleaned, 1); assert.equal(node.active, false); node.destroy();
});

test('FW01 audio construction failure destroys partial node and returns the asset', async t => {
    resources(t); const audio = new AudioSystem(), root = new Node(), original = Node.prototype.addComponent;
    const clip = fixture(t, 'fw01-audio', new AudioClip()); audio.init(root);
    Node.prototype.addComponent = function (type) { if (type === AudioSource) throw new Error('AudioSource failed'); return original.call(this, type); };
    t.after(() => { Node.prototype.addComponent = original; audio.dispose(); root.destroy(); });
    await assert.rejects(audio.playSound('fw01-audio'), /AudioSource failed/);
    assert.equal(root.children.length, 0); assert.equal(clip.refCount, 0);
    Node.prototype.addComponent = original; assert.equal(await audio.playSound('fw01-audio'), true);
    audio.dispose();
});

test('FW01 audio cleanup attempts all voices, releases clips and permits reinitialization', async t => {
    resources(t); const audio = new AudioSystem(), root = new Node(), clip = fixture(t, 'fw01-voices', new AudioClip());
    audio.init(root); await audio.playBGM('fw01-voices'); await audio.playSound('fw01-voices'); await audio.playSound('fw01-voices');
    root.children[0].getComponent(AudioSource).stop = () => { throw new Error('stop failed'); };
    assert.throws(() => audio.dispose()); assert.equal(root.children.length, 0); assert.equal(clip.refCount, 0);
    audio.init(root); assert.equal(await audio.playSound('fw01-voices'), true); audio.dispose(); root.destroy();
});

test('FW01 old audio load finalizer cannot decrement a new lifecycle pending count', async t => {
    resources(t); const audio = new AudioSystem(), root = new Node(), callbacks = new Map();
    setLoadOverride((path, type, callback) => callbacks.set(path, callback));
    audio.init(root, 1); const old = audio.playSound('old'), canceled = assert.rejects(old);
    await turn(); audio.dispose(); audio.init(root, 1);
    const fresh = audio.playSound('fresh'); await canceled; await turn();
    assert.equal(audio.pendingVoices, 1); assert.equal(await audio.playSound('other'), false);
    const oldClip = new AudioClip(), freshClip = new AudioClip();
    callbacks.get('old')(null, oldClip); callbacks.get('fresh')(null, freshClip);
    assert.equal(await fresh, true); audio.dispose(); await turn();
    assert.equal(oldClip.refCount, 0); assert.equal(freshClip.refCount, 0); root.destroy();
});

test('FW01 animation collection attempts every scope even after an error', () => {
    const first = new Node(), second = new Node(), a = new LifecycleScope(), b = new LifecycleScope();
    a.add(() => { throw new Error('animation cleanup'); });
    AnimationHelper.scopes.set(first, a); AnimationHelper.scopes.set(second, b);
    assert.throws(() => AnimationHelper.clearAll());
    assert.equal(a.isActive, false); assert.equal(b.isActive, false); assert.equal(AnimationHelper.scopes.size, 0);
});

test('FW01 material copy failure destroys the partial material instance', t => {
    const original = Material.prototype.copy; let instance;
    Material.prototype.copy = function () { instance = this; throw new Error('copy failed'); };
    t.after(() => { Material.prototype.copy = original; SpriteMaterialHelper.clearCache(); });
    const sprite = new Node().addComponent(Sprite);
    assert.throws(() => SpriteMaterialHelper.bind(sprite, new Material()), /copy failed/);
    assert.equal(instance.isValid, false); assert.equal(SpriteMaterialHelper.bindings.size, 0);
});

test('FW01 material restore failure cannot skip material destruction or other bindings', () => {
    const original = new Material(), sprites = [new Node().addComponent(Sprite), new Node().addComponent(Sprite)];
    let value = original, fail = false;
    Object.defineProperty(sprites[0], 'customMaterial', { get() { return value; }, set(next) { if (fail && next === original) throw new Error('restore failed'); value = next; } });
    SpriteMaterialHelper.bind(sprites[0], original); SpriteMaterialHelper.bind(sprites[1], original);
    const materials = sprites.map(sprite => sprite.customMaterial); fail = true;
    assert.throws(() => SpriteMaterialHelper.clearCache());
    assert.ok(materials.every(material => !material.isValid)); assert.equal(SpriteMaterialHelper.bindings.size, 0);
});

test('FW01 UI pool clearing continues after one node destruction throws', () => {
    const pool = new UIPool(), a = new Node(), b = new Node(), destroy = a.destroy;
    pool.recycle('a', a); pool.recycle('b', b);
    a.destroy = function () { destroy.call(this); throw new Error('destroy failed'); };
    assert.throws(() => pool.clear()); assert.equal(a.isValid, false); assert.equal(b.isValid, false);
    pool.clear(); assert.equal(pool.get('b'), null);
});

test('FW01 config disposal attempts every table and clears ownership despite cleanup failure', async t => {
    resources(t); const manager = new ConfigManager();
    const a = fixture(t, 'fw01-config-a', new JsonAsset()), b = fixture(t, 'fw01-config-b', new JsonAsset());
    a.json = [{ id: 1 }]; b.json = [{ id: 2 }];
    await manager.loadTables(['fw01-config-a', 'fw01-config-b']);
    Array.from(manager.tables.values())[0].scope.add(() => { throw new Error('table cleanup'); });
    assert.throws(() => manager.dispose()); assert.equal(a.refCount, 0); assert.equal(b.refCount, 0);
    assert.equal(manager.tables.size, 0); assert.equal(manager.loading.size, 0);
    await manager.loadTable('fw01-config-b'); manager.dispose();
});

for (const hook of ['onInit', 'onShow']) test(`FW01 UI ${hook} disposal cannot publish a stale instance into a new lifecycle`, async t => {
    resources(t); const manager = new UIManager(), oldRoot = uiRoot(), newRoot = uiRoot();
    let stale;
    class Reentrant extends UIBase { [hook]() { stale = this; manager.dispose(); manager.init(newRoot); } }
    const asset = fixture(t, 'fw01-reentrant', prefabOf(Reentrant)); manager.init(oldRoot);
    await assert.rejects(manager.openUI('old', 'fw01-reentrant'), /Scope disposed/);
    assert.equal(stale.node.isValid, false); assert.equal(asset.refCount, 0);
    assert.deepEqual(manager.opened, []); assert.equal(manager.getUI('old'), undefined);
    const fresh = fixture(t, 'fw01-fresh', prefabOf());
    await manager.openUI('fresh', 'fw01-fresh'); manager.dispose();
    assert.equal(fresh.refCount, 0); assert.equal(newRoot.children.length, 0);
    oldRoot.destroy(); newRoot.destroy();
});

test('FW01 keep view may close during onShow without releasing its live prefab', async t => {
    resources(t); const manager = new UIManager(), root = uiRoot(); let shown = 0;
    class SelfClosing extends UIBase { onShow() { if (++shown === 1) this.close(); } }
    const asset = fixture(t, 'fw01-self-close', prefabOf(SelfClosing)); manager.init(root);
    manager.register('self', { path: 'fw01-self-close', cache: 'keep' });
    const view = await manager.openUI('self');
    assert.equal(asset.refCount, 1); assert.equal(view.node.active, false); assert.deepEqual(manager.opened, []);
    assert.equal(await manager.openUI('self'), view); assert.equal(view.node.active, true);
    manager.destroyUI('self'); assert.equal(asset.refCount, 0); manager.dispose(); root.destroy();
});

test('FW01 UI close failure still resolves the dialog and destroys its instance', async t => {
    resources(t); const manager = new UIManager(), root = uiRoot();
    class BrokenHide extends UIBase { onHide() { throw new Error('hide hook failed'); } }
    const asset = fixture(t, 'fw01-dialog', prefabOf(BrokenHide)); manager.init(root);
    manager.register('dialog', { path: 'fw01-dialog', modal: true });
    const result = manager.openDialog('dialog'); await turn();
    assert.throws(() => manager.closeUI('dialog', 7)); assert.equal(await result, 7);
    assert.equal(asset.refCount, 0); assert.deepEqual(manager.opened, []);
    manager.dispose(); root.destroy();
});

test('FW01 partially started atlas animation is stopped and its asset released', async t => {
    resources(t); const node = new Node(); node.addComponent(Sprite);
    const atlas = fixture(t, 'fw01-atlas', new SpriteAtlas()); atlas.getSpriteFrame = () => new SpriteFrame();
    const play = FrameAnimator.prototype.play, stop = FrameAnimator.prototype.stop; let stopped = 0;
    FrameAnimator.prototype.play = () => { throw new Error('animation play failed'); };
    FrameAnimator.prototype.stop = () => { stopped++; };
    t.after(() => { FrameAnimator.prototype.play = play; FrameAnimator.prototype.stop = stop; });
    await assert.rejects(AnimationHelper.playAnimationFromAtlas(node, 'fw01-atlas', 'f', 1), /animation play failed/);
    assert.equal(stopped, 1); assert.equal(atlas.refCount, 0); assert.equal(AnimationHelper.scopes.size, 0); node.destroy();
});

for (const mode of ['registration', 'show', 'late-load']) test(`FW01 ad ${mode} failures cannot lock future requests or revive settled ads`, async t => {
    const platform = sys.platform, originalWx = globalThis.wx;
    sys.platform = sys.Platform.WECHAT_GAME;
    t.after(() => { sys.platform = platform; globalThis.wx = originalWx; });
    const gate = deferred(); let close, destroyed = 0, shows = 0, loads = 0, errorsDetached = 0, created = 0;
    globalThis.wx = { createRewardedVideoAd() { const attempt = ++created; return {
        onClose(callback) { close = callback; if (mode === 'registration') throw new Error('register'); },
        offClose() { throw new Error('detach close'); }, onError() {}, offError() { errorsDetached++; },
        show() { shows++; if (mode === 'show') throw new Error('show'); return attempt === 1 ? Promise.reject(new Error('cache miss')) : Promise.resolve(); },
        load() { loads++; return gate.promise; }, destroy() { destroyed++; throw new Error('destroy'); },
    }; } };
    const adapter = new PlatformManager().adapter, task = adapter.showRewardAd('unit');
    if (mode === 'late-load') { await turn(); close({ isEnded: false }); gate.resolve(); }
    const result = await task; await turn();
    assert.equal(result.status, mode === 'late-load' ? 'canceled' : 'failed'); assert.ok(result.error);
    assert.equal(destroyed, 1); assert.equal(errorsDetached, 1);
    assert.equal(shows, mode === 'registration' ? 0 : 1); assert.equal(loads, mode === 'late-load' ? 1 : 0);
    close({ isEnded: true }); assert.equal(destroyed, 1);
    const again = adapter.showRewardAd('unit'); if (mode === 'late-load') { await turn(); close({ isEnded: true }); }
    const next = await again; assert.equal(next.status, mode === 'late-load' ? 'completed' : 'failed');
});

test('FW01 synchronous ad completion never calls show on the destroyed ad', async t => {
    const platform = sys.platform, originalWx = globalThis.wx; sys.platform = sys.Platform.WECHAT_GAME;
    t.after(() => { sys.platform = platform; globalThis.wx = originalWx; });
    let shows = 0, destroyed = 0;
    globalThis.wx = { createRewardedVideoAd() { return {
        onClose(callback) { callback({ isEnded: true }); }, offClose() {}, onError() {}, offError() {},
        async show() { shows++; }, async load() {}, destroy() { destroyed++; },
    }; } };
    assert.equal((await new PlatformManager().adapter.showRewardAd('unit')).status, 'completed');
    assert.equal(shows, 0); assert.equal(destroyed, 1);
});

test('FW01 disposed Cocos cache late cleanup errors remain observable on the service', async t => {
    const manager = resources(t), scope = new LifecycleScope(); let callback;
    setLoadOverride((_path, _type, done) => { callback = done; });
    const request = manager.acquire('fw01-late-error', JsonAsset, { scope }), canceled = assert.rejects(request);
    await turn(); scope.dispose(); await canceled; manager.dispose(); manager.init();
    const asset = new JsonAsset(), release = asset.decRef, failure = new Error('late Cocos release');
    asset.decRef = function () { release.call(this); throw failure; };
    callback(null, asset); await turn(); await turn();
    assert.ok(causes(manager.lastError).includes(failure)); assert.equal(asset.refCount, 0);
    assert.equal(manager.getDebugInfo().owners, 0);
});

test('FW01 throwing resource diagnostic observer cannot create an unhandled rejection', async () => {
    const original = new Error('load failed'), reporting = new Error('observer failed');
    const cache = new ResourceCache({ async load() { throw original; }, retain() {}, release() {}, onError() { throw reporting; } });
    await assert.rejects(cache.acquire('bad'), error => error === original); await turn();
    assert.ok(causes(cache.lastError).includes(original)); assert.ok(causes(cache.lastError).includes(reporting)); cache.dispose();
});

test('FW01 self-check mismatch retains the validation failure when both handle releases throw', async t => {
    quiet(t);
    const key = 'framework-smoke/config', oldAsset = assets.get(key), asset = new JsonAsset();
    asset.json = { framework: 'wrong-version' }; assets.set(key, asset);
    const manager = ResManager.Instance, acquire = manager.acquire, failure = new Error('self-check release failure');
    manager.acquire = async function (...args) {
        const handle = await acquire.apply(this, args);
        return { value: handle.value, release() { handle.release(); throw failure; } };
    };
    const bootstrap = new Node().addComponent(FrameworkBootstrap); bootstrap.runSelfCheck = true;
    t.after(async () => { manager.acquire = acquire; await stopBootstrap(bootstrap); if (oldAsset === undefined) assets.delete(key); else assets.set(key, oldAsset); });
    bootstrap.onLoad(); await assert.rejects(bootstrap.retry());
    assert.equal(bootstrap.startupState, 'failed'); assert.equal(asset.refCount, 0);
    assert.ok(causes(bootstrap.lastError).some(error => error?.message === 'Engine resource self-check failed'));
    assert.ok(causes(bootstrap.lastError).includes(failure));
});
