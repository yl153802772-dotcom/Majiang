import test from 'node:test';
import assert from 'node:assert/strict';
import { TableProjector } from '../../assets/Game/Presentation/TableProjector.ts';
import { BoardInput } from '../../assets/Game/Presentation/UI/BoardInput.ts';

const FULL_VIEWPORT = {
    visibleWidth: 720,
    visibleHeight: 1280,
    safeX: 0,
    safeY: 0,
    safeWidth: 720,
    safeHeight: 1280,
};

function boardBlock(id, x, y, layer, cardCount = 1) {
    return {
        definition: {
            id,
            groupId: 'G01',
            kind: cardCount === 2 ? 'identicalPair' : 'single',
            cards: cardCount === 2
                ? [{ suit: 'tong', rank: 1 }, { suit: 'tong', rank: 1 }]
                : [{ suit: 'tong', rank: 1 }],
        },
        placement: { blockId: id, x, y, layer, blockedBy: [] },
        selectable: true,
        disabledReason: null,
        highlight: 'normal',
    };
}

function fakeNode() {
    const listeners = new Map();
    return {
        on(type, callback) {
            const list = listeners.get(type) ?? [];
            list.push(callback);
            listeners.set(type, list);
        },
        off(type, callback) {
            listeners.set(type, (listeners.get(type) ?? []).filter(entry => entry !== callback));
        },
        emit(type, event) {
            for (const callback of [...(listeners.get(type) ?? [])]) callback(event);
        },
        count(type) {
            return (listeners.get(type) ?? []).length;
        },
    };
}

function touchEvent(x, y, id = 1) {
    return {
        getUILocation() { return { x, y }; },
        getID() { return id; },
    };
}

test('TableProjector preserves design/content/UI/world round trips with full safe area', () => {
    const projector = new TableProjector();
    projector.configure(FULL_VIEWPORT);
    assert.equal(projector.scale, 1);
    assert.deepEqual(projector.contentOffset, { x: 0, y: 0 });
    assert.deepEqual(projector.designToContent(64, 160), { x: -296, y: 480 });
    assert.deepEqual(projector.designToUi(64, 160), { x: 64, y: 1120 });
    assert.deepEqual(projector.uiToDesign(64, 1120), { x: 64, y: 160 });
    assert.deepEqual(projector.screenToDesign(64, 1120), { x: 64, y: 160 });
    const world = projector.designToWorld(64, 160, 0.7);
    assert.ok(Math.abs(world.x - -2.96) < 1e-9);
    assert.ok(Math.abs(world.y - 4.8) < 1e-9);
    assert.equal(world.z, 0.7);
    assert.deepEqual(projector.worldToDesign(world), { x: 64, y: 160 });
    assert.ok(Math.abs(projector.worldToUi(world).x - 64) < 1e-9);
    assert.ok(Math.abs(projector.worldToUi(world).y - 1120) < 1e-9);
    assert.equal(projector.cameraOrthoHalfHeight, 6.4);
    assert.equal(projector.designToWorldScale(64), 0.64);
});

test('TableProjector fits reduced and off-center safe areas without changing 720x1280 design coords', () => {
    const projector = new TableProjector();
    projector.configure({
        visibleWidth: 720,
        visibleHeight: 1280,
        safeX: 30,
        safeY: 20,
        safeWidth: 660,
        safeHeight: 1100,
    });
    assert.ok(Math.abs(projector.scale - 1100 / 1280) < 1e-9);
    const center = projector.designToUi(360, 640);
    assert.ok(Math.abs(center.x - (30 + 660 / 2)) < 1e-9);
    assert.ok(Math.abs(center.y - (20 + 1100 / 2)) < 1e-9);
    for (const point of [{ x: 0, y: 0 }, { x: 720, y: 1280 }, { x: 64, y: 160 }, { x: 520, y: 720 }]) {
        const roundTrip = projector.uiToDesign(projector.designToUi(point.x, point.y).x, projector.designToUi(point.x, point.y).y);
        assert.ok(Math.abs(roundTrip.x - point.x) < 1e-9, `x ${point.x}`);
        assert.ok(Math.abs(roundTrip.y - point.y) < 1e-9, `y ${point.y}`);
    }
    const world = projector.designToWorld(520, 720);
    const design = projector.worldToDesign(world);
    assert.ok(Math.abs(design.x - 520) < 1e-9);
    assert.ok(Math.abs(design.y - 720) < 1e-9);
});

test('TableProjector hit rectangles match single 64x88 and double 132x88 display frames', () => {
    const projector = new TableProjector();
    projector.configure(FULL_VIEWPORT);
    assert.deepEqual(projector.getHitRect(64, 160, 1), { x: 32, y: 116, width: 64, height: 88 });
    assert.deepEqual(projector.getHitRect(188, 160, 2), { x: 122, y: 116, width: 132, height: 88 });
    assert.equal(projector.containsDesignPoint(projector.getHitRect(64, 160, 1), 64, 160), true);
    assert.equal(projector.containsDesignPoint(projector.getHitRect(64, 160, 1), 25, 160), false);
});

test('BoardInput submits one hit on TouchEnd and records the full synchronous chain time', () => {
    const projector = new TableProjector();
    projector.configure(FULL_VIEWPORT);
    const snapshot = { board: [boardBlock('B01', 64, 160, 3)] };
    const selected = [];
    const samples = [];
    const times = [10, 14];
    const input = new BoardInput({
        projector,
        getSnapshot: () => snapshot,
        onSelect: blockId => {
            selected.push(blockId);
            return { accepted: true, snapshot, events: [] };
        },
        onSample: sample => samples.push(sample),
        now: () => times.shift() ?? 14,
    });
    const node = fakeNode();
    input.attach(node);
    const ui = projector.designToUi(64, 160);
    node.emit('touch-start', touchEvent(ui.x, ui.y));
    node.emit('touch-end', touchEvent(ui.x, ui.y));
    assert.deepEqual(selected, ['B01']);
    assert.equal(samples.length, 1);
    assert.equal(samples[0].elapsedMs, 4);
    assert.equal(samples[0].accepted, true);
    assert.deepEqual(input.getMetrics(), { count: 1, p95Ms: 4, maxMs: 4, lastMs: 4 });
    input.detach();
    assert.equal(node.count('touch-start'), 0);
});

test('BoardInput cancels slides over 12 design px and ignores non-first pointers', () => {
    const projector = new TableProjector();
    projector.configure(FULL_VIEWPORT);
    const snapshot = { board: [boardBlock('B01', 64, 160, 3)] };
    const selected = [];
    const input = new BoardInput({
        projector,
        getSnapshot: () => snapshot,
        onSelect: blockId => {
            selected.push(blockId);
            return { accepted: true, snapshot, events: [] };
        },
    });
    const node = fakeNode();
    input.attach(node);
    const start = projector.designToUi(64, 160);
    const moved = projector.designToUi(80, 160);
    node.emit('touch-start', touchEvent(start.x, start.y, 1));
    node.emit('touch-move', touchEvent(moved.x, moved.y, 1));
    node.emit('touch-end', touchEvent(moved.x, moved.y, 1));
    assert.deepEqual(selected, []);

    node.emit('touch-start', touchEvent(start.x, start.y, 1));
    node.emit('touch-start', touchEvent(start.x, start.y, 2));
    node.emit('touch-end', touchEvent(start.x, start.y, 2));
    assert.deepEqual(selected, []);
    node.emit('touch-end', touchEvent(start.x, start.y, 1));
    assert.deepEqual(selected, ['B01']);
    input.detach();
});

test('BoardInput hit priority uses higher layer then smaller BlockID', () => {
    const projector = new TableProjector();
    projector.configure(FULL_VIEWPORT);
    const snapshot = {
        board: [
            boardBlock('B01', 64, 160, 1),
            boardBlock('B05', 64, 160, 2),
            boardBlock('B03', 64, 160, 3),
            boardBlock('B02', 64, 160, 3),
        ],
    };
    const selected = [];
    const input = new BoardInput({
        projector,
        getSnapshot: () => snapshot,
        onSelect: blockId => {
            selected.push(blockId);
            return { accepted: true, snapshot, events: [] };
        },
    });
    const node = fakeNode();
    input.attach(node);
    const ui = projector.designToUi(64, 160);
    node.emit('touch-start', touchEvent(ui.x, ui.y));
    node.emit('touch-end', touchEvent(ui.x, ui.y));
    assert.deepEqual(selected, ['B02']);
    input.detach();
});

test('BoardInput reports rejection and can be disabled without dispatching', () => {
    const projector = new TableProjector();
    projector.configure(FULL_VIEWPORT);
    const snapshot = { board: [boardBlock('B01', 64, 160, 3)] };
    const reasons = [];
    const selected = [];
    const input = new BoardInput({
        projector,
        getSnapshot: () => snapshot,
        onSelect: blockId => {
            selected.push(blockId);
            return { accepted: false, reason: 'blocked', sessionId: 's', revision: 1 };
        },
        onReject: reason => reasons.push(reason),
    });
    const node = fakeNode();
    input.attach(node);
    const ui = projector.designToUi(64, 160);
    node.emit('touch-start', touchEvent(ui.x, ui.y));
    node.emit('touch-end', touchEvent(ui.x, ui.y));
    assert.deepEqual(reasons, ['blocked']);
    assert.equal(input.lastSample.accepted, false);
    assert.equal(input.lastSample.reason, 'blocked');

    input.setEnabled(false);
    node.emit('touch-start', touchEvent(ui.x, ui.y));
    node.emit('touch-end', touchEvent(ui.x, ui.y));
    assert.equal(selected.length, 1);
    input.detach();
});

test('BoardInput reports p95/max over a bounded sample window', () => {
    const projector = new TableProjector();
    projector.configure(FULL_VIEWPORT);
    const snapshot = { board: [boardBlock('B01', 64, 160, 3)] };
    const ticks = [];
    const input = new BoardInput({
        projector,
        getSnapshot: () => snapshot,
        onSelect: () => ({ accepted: true, snapshot, events: [] }),
        now: () => ticks.shift() ?? 0,
    });
    const node = fakeNode();
    input.attach(node);
    const ui = projector.designToUi(64, 160);
    for (let index = 1; index <= 20; index++) {
        ticks.push(index * 2, index * 3);
        node.emit('touch-start', touchEvent(ui.x, ui.y));
        node.emit('touch-end', touchEvent(ui.x, ui.y));
    }
    const metrics = input.getMetrics();
    assert.equal(metrics.count, 20);
    assert.equal(metrics.lastMs, 20);
    assert.equal(metrics.maxMs, 20);
    assert.ok(metrics.p95Ms >= 19 && metrics.p95Ms <= 20);
    assert.equal(input.getSamples().length, 20);
    input.detach();
});

test('R01-04: end point over 12 design px cancels even without touch-move', () => {
    const projector = new TableProjector();
    projector.configure(FULL_VIEWPORT);
    const snapshot = { sessionId: 's1', board: [boardBlock('B01', 64, 160, 3)] };
    const selected = [];
    const input = new BoardInput({
        projector,
        getSnapshot: () => snapshot,
        onSelect: blockId => {
            selected.push(blockId);
            return { accepted: true, snapshot, events: [] };
        },
    });
    const node = fakeNode();
    input.attach(node);
    const start = projector.designToUi(64, 160);
    const end = projector.designToUi(64 + 13, 160);
    node.emit('touch-start', touchEvent(start.x, start.y, 1));
    node.emit('touch-end', touchEvent(end.x, end.y, 1));
    assert.deepEqual(selected, []);
    input.detach();
});

test('R01-04: a gesture started in an old session cannot submit after restart or cancelGesture', () => {
    const projector = new TableProjector();
    projector.configure(FULL_VIEWPORT);
    let sessionId = 's1';
    const snapshot = { get sessionId() { return sessionId; }, board: [boardBlock('B01', 64, 160, 3)] };
    const selected = [];
    const input = new BoardInput({
        projector,
        getSnapshot: () => snapshot,
        onSelect: blockId => {
            selected.push(blockId);
            return { accepted: true, snapshot, events: [] };
        },
    });
    const node = fakeNode();
    input.attach(node);
    const ui = projector.designToUi(64, 160);
    node.emit('touch-start', touchEvent(ui.x, ui.y, 1));
    sessionId = 's2';
    node.emit('touch-end', touchEvent(ui.x, ui.y, 1));
    assert.deepEqual(selected, []);

    node.emit('touch-start', touchEvent(ui.x, ui.y, 2));
    input.cancelGesture();
    node.emit('touch-end', touchEvent(ui.x, ui.y, 2));
    assert.deepEqual(selected, []);

    node.emit('touch-start', touchEvent(ui.x, ui.y, 3));
    node.emit('touch-end', touchEvent(ui.x, ui.y, 3));
    assert.deepEqual(selected, ['B01']);
    input.detach();
});

test('R01-04: touch-cancel and re-enable after pause do not duplicate commands', () => {
    const projector = new TableProjector();
    projector.configure(FULL_VIEWPORT);
    const snapshot = { sessionId: 's1', board: [boardBlock('B01', 64, 160, 3)] };
    let calls = 0;
    const input = new BoardInput({
        projector,
        getSnapshot: () => snapshot,
        onSelect: () => {
            calls++;
            return { accepted: true, snapshot, events: [] };
        },
    });
    const node = fakeNode();
    input.attach(node);
    const ui = projector.designToUi(64, 160);
    node.emit('touch-start', touchEvent(ui.x, ui.y, 1));
    node.emit('touch-cancel', touchEvent(ui.x, ui.y, 1));
    node.emit('touch-end', touchEvent(ui.x, ui.y, 1));
    assert.equal(calls, 0);

    input.setEnabled(false);
    node.emit('touch-start', touchEvent(ui.x, ui.y, 2));
    node.emit('touch-end', touchEvent(ui.x, ui.y, 2));
    assert.equal(calls, 0);
    input.setEnabled(true);
    node.emit('touch-start', touchEvent(ui.x, ui.y, 3));
    node.emit('touch-end', touchEvent(ui.x, ui.y, 3));
    assert.equal(calls, 1);
    input.detach();
});

test('R01-05: slow hit test is included and rejection prompt time is included', () => {
    const projector = new TableProjector();
    projector.configure(FULL_VIEWPORT);
    const snapshot = { sessionId: 's1', board: [boardBlock('B01', 64, 160, 3)] };
    let clock = 0;
    const slowProjector = Object.create(projector);
    slowProjector.containsDesignPoint = function (rect, x, y) {
        clock += 25;
        return TableProjector.prototype.containsDesignPoint.call(this, rect, x, y);
    };
    const samples = [];
    const input = new BoardInput({
        projector: slowProjector,
        getSnapshot: () => snapshot,
        onSelect: () => {
            clock += 2;
            return { accepted: false, reason: 'blocked', sessionId: 's1', revision: 0 };
        },
        onReject: () => { clock += 7; },
        onSample: sample => samples.push(sample),
        now: () => clock,
    });
    const node = fakeNode();
    input.attach(node);
    const ui = projector.designToUi(64, 160);
    node.emit('touch-start', touchEvent(ui.x, ui.y, 1));
    node.emit('touch-end', touchEvent(ui.x, ui.y, 1));
    assert.equal(samples.length, 1);
    assert.equal(samples[0].reason, 'blocked');
    assert.equal(samples[0].elapsedMs, 34);
    input.detach();
});
