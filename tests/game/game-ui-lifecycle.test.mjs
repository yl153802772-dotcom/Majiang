import test from 'node:test';
import assert from 'node:assert/strict';
import { GameAppLifecycle } from '../../assets/Game/Bootstrap/GameAppLifecycle.ts';

test('GAME-UI-01 lifecycle: one owner and a shared close barrier', async () => {
    const first = GameAppLifecycle.tryClaim();
    assert.ok(first);
    assert.equal(GameAppLifecycle.tryClaim(), null);
    let closed = 0;
    const gate = new Promise(resolve => setTimeout(resolve, 5));
    const closing = GameAppLifecycle.release(first, async () => { await gate; closed++; });
    const second = await GameAppLifecycle.waitForClaim();
    assert.ok(second);
    assert.equal(closed, 1);
    assert.equal(GameAppLifecycle.owns(second), true);
    let closedSecond = 0;
    await GameAppLifecycle.release(second, async () => { closedSecond++; });
    assert.equal(closedSecond, 1);
    assert.equal(GameAppLifecycle.hasOwner, false);
});

test('GAME-UI-01 lifecycle: old release cannot clear a newer owner', async () => {
    const old = GameAppLifecycle.tryClaim();
    assert.ok(old);
    await GameAppLifecycle.release(old, async () => {});
    const current = GameAppLifecycle.tryClaim();
    assert.ok(current);
    await GameAppLifecycle.release(old, async () => { throw new Error('must not run'); });
    assert.equal(GameAppLifecycle.owns(current), true);
    await GameAppLifecycle.release(current, async () => {});
});

test('GAME-UI-01 lifecycle: duplicate claim during an active owner is rejected', async () => {
    const owner = GameAppLifecycle.tryClaim();
    assert.ok(owner);
    const result = await GameAppLifecycle.waitForClaim();
    assert.equal(result, null);
    await GameAppLifecycle.release(owner, async () => {});
});
