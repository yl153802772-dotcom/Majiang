import test from 'node:test';
import assert from 'node:assert/strict';
import {
    MAX_TOUCH_RECORDS,
    TOUCH_PERFORMANCE_NAME,
    TouchPerformanceRecorder,
} from '../../assets/Game/Presentation/TouchPerformanceRecorder.ts';

function fakePerformance() {
    const entries = new Map();
    let now = 0;
    let throwMeasure = false;
    let throwClear = false;
    return {
        now() { return now++; },
        measure(name, options = {}) {
            if (throwMeasure) throw new Error('measure failed');
            const list = entries.get(name) ?? [];
            list.push({ name, start: options.start ?? 0, duration: (options.end ?? 0) - (options.start ?? 0) });
            entries.set(name, list);
        },
        clearMeasures(name) {
            if (throwClear) throw new Error('clear failed');
            if (name === undefined) entries.clear();
            else entries.delete(name);
        },
        entriesFor(name) { return entries.get(name) ?? []; },
        setThrowMeasure(value) { throwMeasure = value; },
        setThrowClear(value) { throwClear = value; },
    };
}

test('R02-CLOSE: 10000 samples are bounded to 256 per session and reset clears only this module', () => {
    const performanceLike = fakePerformance();
    const recorder = new TouchPerformanceRecorder(performanceLike);
    assert.equal(recorder.reset('session-1'), 'cleared');
    performanceLike.measure('other-module', { start: 0, end: 1 });
    for (let index = 0; index < 10000; index++) {
        const outcome = recorder.record(1 + (index % 5));
        if (index < MAX_TOUCH_RECORDS) assert.equal(outcome, 'written');
        else assert.equal(outcome, 'limit');
    }
    assert.equal(performanceLike.entriesFor(TOUCH_PERFORMANCE_NAME).length, MAX_TOUCH_RECORDS);
    assert.equal(performanceLike.entriesFor('other-module').length, 1);
    const stats = recorder.getStats();
    assert.equal(stats.recorded, MAX_TOUCH_RECORDS);
    assert.equal(stats.limitSkipped, 10000 - MAX_TOUCH_RECORDS);
    assert.equal(stats.failed, 0);

    assert.equal(recorder.reset('session-2'), 'cleared');
    assert.equal(performanceLike.entriesFor(TOUCH_PERFORMANCE_NAME).length, 0);
    assert.equal(performanceLike.entriesFor('other-module').length, 1);
    assert.equal(recorder.getStats().recorded, 0);
    assert.equal(recorder.getStats().sessionId, 'session-2');
    recorder.dispose();
});

test('R02-CLOSE: dispose is repeatable, clears this module only and rejects late writes', () => {
    const performanceLike = fakePerformance();
    const recorder = new TouchPerformanceRecorder(performanceLike);
    recorder.reset('session-1');
    assert.equal(recorder.record(12), 'written');
    assert.equal(performanceLike.entriesFor(TOUCH_PERFORMANCE_NAME).length, 1);
    recorder.dispose();
    assert.equal(performanceLike.entriesFor(TOUCH_PERFORMANCE_NAME).length, 0);
    assert.equal(recorder.record(5), 'disposed');
    assert.equal(recorder.reset('session-2'), 'disposed');
    assert.equal(performanceLike.entriesFor(TOUCH_PERFORMANCE_NAME).length, 0);
    const before = performanceLike.entriesFor(TOUCH_PERFORMANCE_NAME).length;
    recorder.dispose();
    assert.equal(performanceLike.entriesFor(TOUCH_PERFORMANCE_NAME).length, before);
});

test('R02-CLOSE: unsupported performance APIs skip safely without throwing or claiming success', () => {
    const recorder = new TouchPerformanceRecorder(null);
    assert.equal(recorder.reset('session-1'), 'unsupported');
    assert.equal(recorder.record(3), 'unsupported');
    assert.equal(recorder.clear(), 'unsupported');
    assert.equal(recorder.getStats().recorded, 0);
    assert.equal(recorder.getStats().unsupported, 1);
    recorder.dispose();
    assert.equal(recorder.record(4), 'disposed');
});

test('R02-CLOSE: measure and clear failures are reported and do not break the caller', () => {
    const performanceLike = fakePerformance();
    const recorder = new TouchPerformanceRecorder(performanceLike);
    recorder.reset('session-1');
    performanceLike.setThrowMeasure(true);
    assert.equal(recorder.record(8), 'failed');
    assert.equal(recorder.getStats().failed, 1);
    assert.equal(performanceLike.entriesFor(TOUCH_PERFORMANCE_NAME).length, 0);
    performanceLike.setThrowMeasure(false);
    performanceLike.setThrowClear(true);
    assert.equal(recorder.reset('session-2'), 'failed');
    assert.equal(recorder.getStats().lastClearOutcome, 'failed');
    assert.equal(recorder.record(2), 'suspended');
    recorder.dispose();
    assert.equal(recorder.getStats().lastClearOutcome, 'failed');
    assert.equal(recorder.record(1), 'disposed');
});

test('hardening: failed clears across repeated resets cannot reopen the timeline budget', () => {
    const host = fakePerformance();
    const recorder = new TouchPerformanceRecorder(host);
    recorder.reset('first');
    host.measure('other-module');
    for (let i = 0; i < MAX_TOUCH_RECORDS; i++) recorder.record(1);
    host.setThrowClear(true);
    for (let round = 0; round < 10; round++) {
        assert.equal(recorder.reset('failed-' + round), 'failed');
        for (let i = 0; i < MAX_TOUCH_RECORDS; i++) assert.equal(recorder.record(1), 'suspended');
        assert.equal(host.entriesFor(TOUCH_PERFORMANCE_NAME).length, MAX_TOUCH_RECORDS);
        assert.equal(recorder.getStats().recorded, MAX_TOUCH_RECORDS);
    }
    assert.equal(recorder.getStats().clearFailures, 10);
    assert.equal(recorder.getStats().suspended, true);
    host.setThrowClear(false);
    assert.equal(recorder.clear(), 'cleared');
    assert.equal(recorder.getStats().suspended, false);
    assert.equal(recorder.getStats().recorded, 0);
    assert.equal(recorder.record(2), 'written');
    assert.equal(host.entriesFor(TOUCH_PERFORMANCE_NAME).length, 1);
    assert.equal(host.entriesFor('other-module').length, 1);
    recorder.dispose();
});

test('hardening: append-then-throw measure suspends further writes until cleanup succeeds', () => {
    const host = fakePerformance();
    const recorder = new TouchPerformanceRecorder({
        now: () => host.now(),
        measure: (...args) => { host.measure(...args); throw new Error('partial write'); },
        clearMeasures: name => host.clearMeasures(name),
    });
    recorder.reset('first');
    assert.equal(recorder.record(1), 'failed');
    for (let i = 0; i < 10000; i++) assert.equal(recorder.record(1), 'suspended');
    assert.equal(host.entriesFor(TOUCH_PERFORMANCE_NAME).length, 1);
    assert.equal(recorder.reset('next'), 'cleared');
    assert.equal(host.entriesFor(TOUCH_PERFORMANCE_NAME).length, 0);
    recorder.dispose();
});
