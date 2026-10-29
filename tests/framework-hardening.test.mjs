import test from 'node:test';
import assert from 'node:assert/strict';
import { Node, Component, Prefab, JsonAsset, setLoadOverride, assets } from 'cc';
import { ResManager } from '../assets/Framework/Core/ResManager.ts';
import { LifecycleScope } from '../assets/Framework/Kernel/LifecycleScope.ts';
import { GameObjectPool } from '../assets/Framework/Core/Pool/GameObjectPool.ts';
import { UIBase } from '../assets/Framework/Components/UIBase.ts';
import { App } from '../assets/Framework/Core/App.ts';

const turn = () => new Promise(resolve => setImmediate(resolve));
const emptyPool = { pools: 0, idle: 0, active: 0 };

for (const oldOutcome of ['success', 'failure']) {
    test('resource generation: late old ' + oldOutcome + ' cannot corrupt a queued new request', async t => {
        const manager = new ResManager();
        const callbacks = [];
        setLoadOverride((path, type, callback) => callbacks.push({ path, callback }));
        t.after(() => setLoadOverride(null));
        manager.init({ concurrency: 1, maxIdle: 0 });
        const oldScope = new LifecycleScope();
        const oldRequest = manager.acquire('shared', JsonAsset, { scope: oldScope });
        const canceled = assert.rejects(oldRequest, /abandoned/);
        await turn();
        const oldLoad = callbacks.find(load => load.path === 'shared');
        assert.ok(oldLoad);
        oldScope.dispose();
        await canceled;
        manager.dispose();

        manager.init({ concurrency: 1, maxIdle: 0 });
        const gateRequest = manager.acquire('gate', JsonAsset);
        await turn();
        const newRequest = manager.acquire('shared', JsonAsset);
        // Attach rejection immediately so a failing regression is never unhandled.
        const newResult = newRequest.then(handle => ({ handle }), error => ({ error }));
        assert.equal(manager.getDebugInfo().queued, 1);
        const oldAsset = new JsonAsset();
        if (oldOutcome === 'success') oldLoad.callback(null, oldAsset);
        else oldLoad.callback(new Error('old physical failure'));
        await turn();
        assert.equal(manager.releaseBundle('resources'), false);
        callbacks.find(load => load.path === 'gate').callback(null, new JsonAsset());
        const gate = await gateRequest;
        await turn();
        const freshLoads = callbacks.filter(load => load.path === 'shared');
        if (freshLoads.length === 2) freshLoads[1].callback(null, new JsonAsset());
        const result = await newResult;
        gate.release();
        result.handle?.release();
        manager.dispose();
        assert.equal(oldAsset.refCount, 0);
        assert.equal(freshLoads.length, 2, 'new lifecycle must issue its own physical request');
        assert.equal(result.error, undefined);
        assert.equal(manager.getDebugInfo().owners, 0);
    });
}

test('pool clearAll completes every pool even when the first recycle callback throws', () => {
    const pool = new GameObjectPool();
    const first = new Prefab(), second = new Prefab();
    class Broken extends Component { onRecycle() { throw new Error('bad recycle'); } }
    first.factory = () => { const node = new Node(); node.addComponent(Broken); return node; };
    pool.registerPrefab('first', first); pool.registerPrefab('second', second);
    const a = pool.spawn('first'), b = pool.spawn('second');
    assert.throws(() => pool.clearAll());
    assert.equal(a.isValid, false); assert.equal(b.isValid, false);
    assert.equal(first.refCount, 0); assert.equal(second.refCount, 0);
    assert.deepEqual(pool.getDebugInfo(), emptyPool);
    pool.clearAll();
});

test('pool active adapter disposal error still destroys node and releases prefab once', () => {
    const pool = new GameObjectPool(), prefab = new Prefab(); let calls = 0;
    pool.registerPrefab('p', prefab, { adapter: { resetInstance() {}, disposeInstance() { calls++; throw new Error('adapter'); } } });
    const node = pool.spawn('p');
    assert.throws(() => pool.clear('p'));
    assert.equal(node.isValid, false); assert.equal(prefab.refCount, 0); assert.equal(calls, 1);
    assert.deepEqual(pool.getDebugInfo(), emptyPool);
    pool.clearAll(); assert.equal(prefab.refCount, 0);
    assert.throws(() => pool.recycle(node));
});

test('pool idle adapter disposal error cannot skip other idle and active nodes', () => {
    const pool = new GameObjectPool(), prefab = new Prefab(); let calls = 0;
    pool.registerPrefab('p', prefab, { capacity: 2, adapter: { resetInstance() {}, disposeInstance() { calls++; throw new Error('adapter'); } } });
    const nodes = [pool.spawn('p'), pool.spawn('p'), pool.spawn('p')];
    pool.recycle(nodes[0]); pool.recycle(nodes[1]);
    assert.throws(() => pool.clear('p'));
    assert.equal(calls, 3); assert.ok(nodes.every(node => !node.isValid));
    assert.equal(prefab.refCount, 0); assert.deepEqual(pool.getDebugInfo(), emptyPool);
});

test('pool overflow recycle destroys the node despite adapter error and keeps prefab until clear', () => {
    const pool = new GameObjectPool(), prefab = new Prefab();
    pool.registerPrefab('p', prefab, { capacity: 0, adapter: { resetInstance() {}, disposeInstance() { throw new Error('adapter'); } } });
    const node = pool.spawn('p');
    assert.throws(() => pool.recycle(node));
    assert.equal(node.isValid, false); assert.equal(prefab.refCount, 1);
    assert.deepEqual(pool.getDebugInfo(), { pools: 1, idle: 0, active: 0 });
    pool.clearAll(); assert.equal(prefab.refCount, 0);
});

test('pool spawn failure reports both original and rollback errors without leaking a node', () => {
    const pool = new GameObjectPool(), prefab = new Prefab(); let node;
    prefab.factory = () => (node = new Node());
    const original = new Error('reset failed'), cleanup = new Error('dispose failed');
    pool.registerPrefab('p', prefab, { adapter: { resetInstance() { throw original; }, disposeInstance() { throw cleanup; } } });
    let failure; try { pool.spawn('p'); } catch (error) { failure = error; }
    assert.ok(failure); assert.notEqual(failure, original, 'rollback error must not be silently discarded');
    assert.equal(failure.causes[0], original);
    assert.equal(node.isValid, false); assert.equal(pool.getDebugInfo().active, 0);
    pool.clearAll(); assert.equal(prefab.refCount, 0);
});

test('pool reentrant clear during recycle defers prefab release until node cleanup finishes', () => {
    const pool = new GameObjectPool(), prefab = new Prefab(); let refDuringCleanup;
    class Member extends Component {
        onRecycle() { pool.clear('p'); refDuringCleanup = prefab.refCount; }
    }
    prefab.factory = () => { const node = new Node(); node.addComponent(Member); return node; };
    pool.registerPrefab('p', prefab); const node = pool.spawn('p');
    pool.recycle(node);
    assert.equal(refDuringCleanup, 1); assert.equal(prefab.refCount, 0);
    assert.equal(node.isValid, false); assert.deepEqual(pool.getDebugInfo(), emptyPool);
});

test('pool never caches a partially initialized instance after spawn fails', () => {
    const pool = new GameObjectPool(), prefab = new Prefab(); const nodes = [];
    let fail = true;
    prefab.factory = () => { const node = new Node(); nodes.push(node); return node; };
    pool.registerPrefab('p', prefab, { adapter: {
        resetInstance() { if (fail) { fail = false; throw new Error('reset'); } }, disposeInstance() {}
    } });
    assert.throws(() => pool.spawn('p'), /reset/);
    assert.equal(nodes[0].isValid, false); assert.equal(pool.getDebugInfo().idle, 0);
    const fresh = pool.spawn('p'); assert.notEqual(fresh, nodes[0]);
    pool.recycle(fresh); pool.clearAll(); assert.equal(prefab.refCount, 0);
});

test('UI destruction closes lifetime and clears close action even if display cleanup throws', () => {
    const node = new Node(); let released = 0, closed = 0;
    class View extends UIBase { onShow() { this.showScope.add(() => { throw new Error('show cleanup'); }); } }
    const view = node.addComponent(View); view.lifetime.add(() => { released++; });
    view.setCloseSelfCallback(() => { closed++; }); view.show();
    assert.throws(() => view.onDestroyUI());
    assert.equal(view.lifetime.isActive, false); assert.equal(released, 1);
    view.close(); assert.equal(closed, 0);
    view.onDestroyUI(); node.destroy(); assert.equal(released, 1);
});

test('UI hide deactivates node and reports both hook and display cleanup failures', () => {
    const node = new Node(); let cleanupRan = false;
    class View extends UIBase {
        onShow() { this.showScope.add(() => { cleanupRan = true; throw new Error('scope'); }); }
        onHide() { throw new Error('hide'); }
    }
    const view = node.addComponent(View); view.show();
    let error; try { view.hide(); } catch (failure) { error = failure; }
    assert.ok(error); assert.equal(error.causes.length, 2);
    assert.equal(node.active, false); assert.equal(cleanupRan, true);
    view.onDestroyUI(); node.destroy();
});

test('UI destruction releases an actual mock Asset owner when display cleanup fails', async t => {
    const manager = ResManager.Instance; manager.dispose(); manager.init({ maxIdle: 0 });
    const asset = new JsonAsset(); assets.set('cleanup-fixture', asset);
    t.after(() => { assets.delete('cleanup-fixture'); manager.dispose(); });
    class View extends UIBase { onShow() { this.showScope.add(() => { throw new Error('scope'); }); } }
    const node = new Node(), view = node.addComponent(View); view.show();
    assert.equal(await view.loadAsset('cleanup-fixture', JsonAsset), asset);
    assert.equal(asset.refCount, 1); assert.throws(() => view.onDestroyUI());
    assert.equal(asset.refCount, 0); assert.equal(manager.getDebugInfo().owners, 0);
    node.destroy();
});

test('application disposal reports pool errors after cleaning other pools and permits restart', async () => {
    const app = new App(), pools = GameObjectPool.Instance;
    await app.init(); await app.start();
    const bad = new Prefab(), good = new Prefab();
    class Broken extends Component { onRecycle() { throw new Error('bad recycle'); } }
    bad.factory = () => { const node = new Node(); node.addComponent(Broken); return node; };
    pools.registerPrefab('bad', bad); pools.registerPrefab('good', good);
    const a = pools.spawn('bad'), b = pools.spawn('good');
    await assert.rejects(app.dispose());
    assert.equal(a.isValid, false); assert.equal(b.isValid, false);
    assert.equal(bad.refCount, 0); assert.equal(good.refCount, 0);
    assert.deepEqual(pools.getDebugInfo(), emptyPool);
    await app.init(); await app.start(); await app.dispose();
});
