import test from 'node:test';
import assert from 'node:assert/strict';
import { PauseController } from '../../assets/Framework/Kernel/PauseController.ts';

test('GAME-UI-01 pause: menu/help leases and background compose without accidental resume', () => {
    const pauses = new PauseController();
    const releaseHelp = pauses.hold('help');
    assert.deepEqual(pauses.snapshot.reasons, ['help']);
    const releaseMenu = pauses.hold('menu');
    pauses.set('background', true);
    releaseHelp();
    assert.deepEqual(pauses.snapshot.reasons, ['background', 'menu']);
    releaseMenu();
    assert.deepEqual(pauses.snapshot.reasons, ['background']);
    pauses.set('background', false);
    assert.equal(pauses.isPaused, false);
    pauses.dispose();
});

test('GAME-UI-01 pause: duplicate same-name leases release independently', () => {
    const pauses = new PauseController();
    const first = pauses.hold('modal');
    const second = pauses.hold('modal');
    first();
    assert.equal(pauses.isPaused, true);
    first();
    assert.equal(pauses.isPaused, true);
    second();
    assert.equal(pauses.isPaused, false);
    pauses.dispose();
});

test('GAME-UI-01 pause: disposed controller rejects new leases and clears state', () => {
    const pauses = new PauseController();
    pauses.set('menu', true);
    pauses.dispose();
    assert.equal(pauses.isPaused, false);
    assert.throws(() => pauses.hold('help'), /disposed/);
    assert.throws(() => pauses.set('background', true), /disposed/);
});
