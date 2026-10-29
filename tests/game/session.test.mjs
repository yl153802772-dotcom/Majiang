import test from 'node:test';
import assert from 'node:assert/strict';
import { LEVEL_888 } from '../../assets/Game/Config/Level888.ts';
import { RECOMMENDED_SOLUTION_888 } from '../../assets/Game/Config/RecommendedSolution888.ts';
import { GameSession } from '../../assets/Game/Application/GameSession.ts';

const FIRST_HAND = ['B01', 'B02', 'B03', 'B04', 'B05', 'B06', 'B07', 'B08', 'B09', 'B10'];

function newSession(extra = {}) {
    let ids = 0;
    return new GameSession({
        level: LEVEL_888,
        nextSessionId: () => 'test-' + (++ids),
        ...extra,
    });
}

function select(session, blockId) {
    const snapshot = session.getSnapshot();
    return session.dispatch({ kind: 'select', sessionId: snapshot.sessionId, blockId });
}

function assertAccepted(result) {
    assert.equal(result.accepted, true, result.accepted ? '' : `rejected: ${result.reason}`);
    assert.equal(Object.isFrozen(result.snapshot), true);
    assert.equal(Object.isFrozen(result.events), true);
    return result;
}

function advanceFirstHand(session) {
    let snapshot = session.getSnapshot();
    for (const blockId of FIRST_HAND) {
        const result = assertAccepted(select(session, blockId));
        snapshot = result.snapshot;
    }
    return snapshot;
}

test('session initial snapshot exposes fixed inventory, selectable B01-B10 and no mutable internals', () => {
    const session = newSession();
    const snapshot = session.getSnapshot();
    assert.equal(snapshot.sessionId, 'test-1');
    assert.equal(snapshot.revision, 0);
    assert.equal(snapshot.levelId, '888');
    assert.equal(snapshot.contentVersion, '888-v3');
    assert.equal(snapshot.phase, 'Collecting');
    assert.equal(snapshot.board.length, 32);
    assert.equal(snapshot.buffer.length, 0);
    assert.equal(snapshot.occupiedSlots, 0);
    assert.equal(snapshot.melds.length, 0);
    assert.equal(snapshot.audit.totalTileCount, 48);
    assert.equal(snapshot.audit.blocks.length, 32);
    assert.equal(snapshot.terminal, null);
    assert.equal(snapshot.stalled, false);
    assert.deepEqual(
        snapshot.board.filter(block => block.selectable).map(block => block.definition.id),
        FIRST_HAND,
    );
    assert.deepEqual(
        snapshot.board.slice(0, 10).map(block => block.disabledReason),
        Array.from({ length: 10 }, () => null),
    );
    assert.deepEqual(
        snapshot.board.find(block => block.definition.id === 'B11').disabledReason,
        'blocked',
    );
    assert.equal(Object.isFrozen(snapshot), true);
    assert.equal(Object.isFrozen(snapshot.board), true);
    assert.equal(Object.isFrozen(snapshot.board[0].definition.cards), true);
    assert.throws(() => { snapshot.board[0].selectable = true; }, TypeError);
    session.dispose();
});

test('accepted select increments revision; blocked, unknown, stale and repeat selections leave state unchanged', () => {
    const session = newSession();
    const initial = session.getSnapshot();

    const blocked = select(session, 'B11');
    assert.deepEqual(blocked, {
        accepted: false,
        reason: 'blocked',
        sessionId: 'test-1',
        revision: 0,
    });
    assert.strictEqual(session.getSnapshot(), initial);

    const unknown = select(session, 'B99');
    assert.equal(unknown.accepted, false);
    assert.equal(unknown.reason, 'unknown-block');
    assert.strictEqual(session.getSnapshot(), initial);

    const stale = session.dispatch({ kind: 'select', sessionId: 'nope', blockId: 'B01' });
    assert.equal(stale.accepted, false);
    assert.equal(stale.reason, 'stale-session');
    assert.strictEqual(session.getSnapshot(), initial);

    let notifications = 0;
    const unsubscribe = session.subscribe(() => { notifications++; });
    const accepted = assertAccepted(select(session, 'B01'));
    assert.equal(accepted.snapshot.revision, 1);
    assert.deepEqual(accepted.snapshot.buffer.map(entry => entry.blockId), ['B01']);
    assert.equal(notifications, 1);

    const repeat = select(session, 'B01');
    assert.equal(repeat.accepted, false);
    assert.equal(repeat.reason, 'not-on-board');
    assert.equal(session.getSnapshot().revision, 1);
    assert.strictEqual(session.getSnapshot(), accepted.snapshot);
    assert.equal(notifications, 1);

    unsubscribe();
    assertAccepted(select(session, 'B03'));
    assert.equal(notifications, 1);
    session.dispose();
});

test('recommended route is fully legal, first ultimate clears G06-G10 and final state is Won', () => {
    const session = newSession();
    let snapshot = session.getSnapshot();
    const events = [];
    const ultimateEvents = [];
    let phaseAtB08 = null;
    let phaseAtB10 = null;

    for (const blockId of RECOMMENDED_SOLUTION_888) {
        const result = assertAccepted(select(session, blockId));
        events.push(...result.events);
        ultimateEvents.push(...result.events.filter(event => event.kind === 'ultimate-resolved'));
        snapshot = result.snapshot;
        if (blockId === 'B08') phaseAtB08 = snapshot.phase;
        if (blockId === 'B10') {
            phaseAtB10 = snapshot.phase;
            assert.deepEqual(snapshot.board.map(block => block.definition.id), [
                'B21', 'B22', 'B23', 'B24', 'B25', 'B26',
                'B27', 'B28', 'B29', 'B30', 'B31', 'B32',
            ]);
            assert.deepEqual(
                snapshot.groups.filter(group => group.integrity !== 'intact').map(group => group.groupId),
                ['G01', 'G02', 'G03', 'G04', 'G05', 'G06', 'G07', 'G08', 'G09', 'G10'],
            );
        }
    }

    assert.equal(phaseAtB08, 'Tenpai');
    assert.equal(phaseAtB10, 'Collecting');
    assert.equal(ultimateEvents.length, 1);
    const ultimate = ultimateEvents[0].payload;
    assert.equal(ultimate.fan, 'qingyise');
    assert.equal(ultimate.power, 5);
    assert.deepEqual(ultimate.targets.map(target => target.groupId), ['G06', 'G07', 'G08', 'G09', 'G10']);
    assert.deepEqual(
        ultimate.targets.flatMap(target => target.blocks.map(block => block.definition.id)),
        ['B11', 'B12', 'B13', 'B14', 'B15', 'B16', 'B17', 'B18', 'B19', 'B20'],
    );
    assert.equal(ultimate.hand.melds.length, 4);
    assert.deepEqual(ultimate.hand.pair.cards, [{ suit: 'tong', rank: 5 }, { suit: 'tong', rank: 5 }]);

    assert.equal(snapshot.phase, 'Won');
    assert.equal(snapshot.revision, 22);
    assert.deepEqual(snapshot.terminal, { outcome: 'Won', reason: 'board-and-buffer-cleared' });
    assert.equal(snapshot.board.length, 0);
    assert.equal(snapshot.buffer.length, 0);
    assert.equal(snapshot.occupiedSlots, 0);
    assert.equal(snapshot.melds.length, 0);
    assert.equal(snapshot.audit.totalTileCount, 48);
    assert.equal(snapshot.audit.blocks.length, 32);
    assert.equal(snapshot.audit.blocks.every(block => block.location === 'removed'), true);
    assert.equal(snapshot.groups.every(group => group.integrity === 'removed'), true);
    assert.equal(events.some(event => event.kind === 'session-ended'), true);
    assert.equal(events.filter(event => event.kind === 'session-ended').length, 1);
    assert.equal(new Set(events.map(event => event.eventId)).size, events.length);
    assert.equal(events.every(event => event.sessionId === 'test-1'), true);

    const blocked = select(session, 'B01');
    assert.equal(blocked.accepted, false);
    assert.equal(blocked.reason, 'terminal');
    session.dispose();
});

test('board-unlocked fires only for the newly selectable lower tier', () => {
    const session = newSession();
    let snapshot = session.getSnapshot();
    let unlocked = null;
    for (const blockId of FIRST_HAND) {
        const result = assertAccepted(select(session, blockId));
        const event = result.events.find(entry => entry.kind === 'board-unlocked');
        if (event) unlocked = event.payload.newlySelectable;
        snapshot = result.snapshot;
    }
    assert.deepEqual(unlocked, [
        'B21', 'B22', 'B23', 'B24', 'B25', 'B26',
        'B27', 'B28', 'B29', 'B30', 'B31', 'B32',
    ]);
    assert.equal(snapshot.phase, 'Collecting');
    session.dispose();
});

test('virtual insert 6+2 accepts only a new block that participates in a recipe', () => {
    const session = newSession();
    advanceFirstHand(session);
    for (const blockId of ['B21', 'B23', 'B25', 'B27', 'B29', 'B31']) {
        assertAccepted(select(session, blockId));
    }
    assert.equal(session.getSnapshot().occupiedSlots, 6);
    assert.deepEqual(session.getSnapshot().buffer.map(entry => entry.blockId), [
        'B21', 'B23', 'B25', 'B27', 'B29', 'B31',
    ]);

    const accepted = assertAccepted(select(session, 'B22'));
    const selectedEvent = accepted.events.find(event => event.kind === 'block-selected');
    assert.equal(selectedEvent.payload.virtualInsert, true);
    assert.equal(selectedEvent.payload.finalRegion, 'meld');
    assert.equal(accepted.snapshot.melds.length, 1);
    assert.equal(accepted.snapshot.occupiedSlots, 5);
    assert.deepEqual(
        accepted.snapshot.buffer.map(entry => entry.blockId),
        ['B23', 'B25', 'B27', 'B29', 'B31'],
    );
    session.dispose();
});

test('virtual insert rejection leaves board, group, revision and snapshot unchanged', () => {
    const session = newSession();
    advanceFirstHand(session);
    for (const blockId of ['B23', 'B25', 'B27', 'B29', 'B32']) {
        assertAccepted(select(session, blockId));
    }
    const before = session.getSnapshot();
    assert.equal(before.occupiedSlots, 6);
    const result = select(session, 'B22');
    assert.equal(result.accepted, false);
    assert.equal(result.reason, 'insufficient-space');
    assert.strictEqual(session.getSnapshot(), before);
    assert.equal(session.getSnapshot().revision, 15);
    assert.ok(session.getSnapshot().board.some(block => block.definition.id === 'B22'));
    assert.equal(session.getSnapshot().groups.find(group => group.groupId === 'G11').integrity, 'intact');
    session.dispose();
});

test('subscriber errors are isolated, reentrant dispatch is busy, and later listeners still run', () => {
    const errors = [];
    const notifications = [];
    const session = newSession({ onSubscriberError: error => errors.push(error) });
    let reentrant = null;
    session.subscribe(result => {
        reentrant = session.dispatch({
            kind: 'select',
            sessionId: result.snapshot.sessionId,
            blockId: 'B03',
        });
        throw new Error('listener failure');
    });
    session.subscribe(result => notifications.push(result.snapshot.revision));

    const result = assertAccepted(select(session, 'B01'));
    assert.equal(errors.length, 1);
    assert.match(String(errors[0]), /listener failure/);
    assert.deepEqual(notifications, [1]);
    assert.ok(reentrant);
    assert.equal(reentrant.accepted, false);
    assert.equal(reentrant.reason, 'busy');
    assert.equal(result.snapshot.revision, 1);
    assert.deepEqual(result.snapshot.buffer.map(entry => entry.blockId), ['B01']);
    session.dispose();
});

test('restart reuses the controller, allocates a new session and keeps long-term subscriptions', () => {
    const session = newSession();
    const seen = [];
    session.subscribe(result => seen.push({ sessionId: result.snapshot.sessionId, revision: result.snapshot.revision }));
    let current = session.getSnapshot();
    assertAccepted(select(session, 'B01'));
    current = session.getSnapshot();

    const restarted = assertAccepted(session.dispatch({
        kind: 'restart',
        sessionId: current.sessionId,
    }));
    assert.equal(restarted.snapshot.sessionId, 'test-2');
    assert.equal(restarted.snapshot.revision, 0);
    assert.equal(restarted.snapshot.phase, 'Collecting');
    assert.equal(restarted.snapshot.board.length, 32);
    assert.equal(restarted.events.length, 1);
    assert.equal(restarted.events[0].kind, 'session-restarted');
    assert.deepEqual(restarted.events[0].payload, { oldSessionId: 'test-1', newSessionId: 'test-2' });

    const oldInput = session.dispatch({ kind: 'select', sessionId: 'test-1', blockId: 'B01' });
    assert.equal(oldInput.accepted, false);
    assert.equal(oldInput.reason, 'stale-session');
    assertAccepted(select(session, 'B01'));
    assert.deepEqual(seen.map(entry => entry.revision), [1, 0, 1]);
    session.dispose();
});

test('restart works at terminal and 20 consecutive restarts keep a playable revision-zero board', () => {
    const session = newSession();
    for (const blockId of RECOMMENDED_SOLUTION_888) assertAccepted(select(session, blockId));
    assert.equal(session.getSnapshot().phase, 'Won');
    let current = session.getSnapshot();
    for (let index = 0; index < 20; index++) {
        const restarted = assertAccepted(session.dispatch({ kind: 'restart', sessionId: current.sessionId }));
        current = restarted.snapshot;
        assert.equal(current.revision, 0);
        assert.equal(current.phase, 'Collecting');
        assert.equal(current.board.length, 32);
        assert.equal(current.audit.totalTileCount, 48);
        assert.equal(current.buffer.length, 0);
        assert.equal(current.melds.length, 0);
    }
    const selected = assertAccepted(select(session, 'B01'));
    assert.equal(selected.snapshot.revision, 1);
    session.dispose();
});

test('dispose prevents dispatch and subscription without erasing the last read-only snapshot', () => {
    const session = newSession();
    const snapshot = session.getSnapshot();
    session.dispose();
    assert.strictEqual(session.getSnapshot(), snapshot);
    assert.throws(() => session.dispatch({ kind: 'select', sessionId: 'test-1', blockId: 'B01' }), /disposed/);
    assert.throws(() => session.subscribe(() => {}), /disposed/);
    session.dispose();
});

test('constructor rejects an invalid level and initial snapshot is independent of config mutation', () => {
    const broken = structuredClone(LEVEL_888);
    broken.blocks.pop();
    assert.throws(() => new GameSession({ level: broken, nextSessionId: () => 'bad-1' }), /Invalid level/);

    const source = structuredClone(LEVEL_888);
    let sequence = 0;
    const session = new GameSession({
        level: source,
        nextSessionId: () => 'isolated-' + (++sequence),
    });
    const snapshot = session.getSnapshot();
    source.contentVersion = 'mutated';
    source.blocks[0].cards[0].rank = 9;
    assert.equal(snapshot.contentVersion, '888-v3');
    assert.equal(session.getSnapshot().contentVersion, '888-v3');
    assert.equal(session.getSnapshot().board.find(block => block.definition.id === 'B01').definition.cards[0].rank, 1);
    session.dispose();
});

test('phase, combination and ultimate event payloads stay within the declared envelope', () => {
    const session = newSession();
    let snapshot = session.getSnapshot();
    const events = [];
    for (const blockId of FIRST_HAND) {
        const result = assertAccepted(select(session, blockId));
        events.push(...result.events);
        snapshot = result.snapshot;
    }
    const phaseEvents = events.filter(event => event.kind === 'phase-changed');
    assert.deepEqual(phaseEvents.map(event => [event.payload.from, event.payload.to]), [
        ['Collecting', 'Tenpai'],
        ['Tenpai', 'Collecting'],
    ]);
    const combinations = events.filter(event => event.kind === 'combination-resolved');
    assert.equal(combinations.length, 4);
    assert.equal(combinations.every(event => event.payload.meld.cards.length >= 3), true);
    const ultimate = events.find(event => event.kind === 'ultimate-resolved');
    assert.ok(ultimate);
    assert.equal(ultimate.payload.sessionId, snapshot.sessionId);
    assert.equal(ultimate.payload.revision, session.getSnapshot().revision);
    assert.equal(typeof ultimate.payload.effectId, 'string');
    assert.equal(events.every(event => event.revision >= 1 && event.revision <= 10), true);
    assert.equal(events.every(event => event.eventId.startsWith('test-1:')), true);
    session.dispose();
});

test('R01-01: a 9-block four-chi hand uses a single identical double block as pair', () => {
    const session = newSession();
    advanceFirstHand(session);
    const chis = [
        ['B21', 'B22'], ['B23', 'B24'], ['B27', 'B28'], ['B29', 'B30'],
    ];
    for (const pair of chis) {
        assertAccepted(select(session, pair[0]));
        assertAccepted(select(session, pair[1]));
    }
    const tenpai = session.getSnapshot();
    assert.equal(tenpai.phase, 'Tenpai');
    assert.equal(tenpai.melds.length, 4);
    assert.equal(tenpai.board.find(block => block.definition.id === 'B26').highlight, 'winning-pair');
    assert.equal(tenpai.board.find(block => block.definition.id === 'B26').selectable, true);

    const result = assertAccepted(select(session, 'B26'));
    const ultimate = result.events.find(event => event.kind === 'ultimate-resolved');
    assert.ok(ultimate);
    assert.equal(ultimate.payload.fan, 'pinghu');
    assert.equal(ultimate.payload.power, 1);
    assert.equal(ultimate.payload.hand.pair.pairKind, 'doubleBlock');
    assert.deepEqual(ultimate.payload.hand.pair.blockIds, ['B26']);
    assert.deepEqual(ultimate.payload.hand.pair.cards, [
        { suit: 'tiao', rank: 9 }, { suit: 'tiao', rank: 9 },
    ]);
    const handBlockIds = ultimate.payload.hand.melds.flatMap(meld => meld.blockIds)
        .concat(ultimate.payload.hand.pair.blockIds);
    assert.equal(new Set(handBlockIds).size, 9);
    assert.deepEqual(ultimate.payload.pairCleanup, [{
        sourceGroupId: 'G13',
        blockId: 'B25',
        previousLocation: 'board',
        cards: [{ suit: 'tiao', rank: 9 }],
    }]);
    assert.equal(result.snapshot.phase, 'Won');
    assert.deepEqual(result.snapshot.board.map(block => block.definition.id), []);
    assert.equal(result.snapshot.melds.length, 0);
    session.dispose();
});

test('R01-01: first-hand two-single pair remains a 10-block hand', () => {
    const session = newSession();
    let snapshot = session.getSnapshot();
    let ultimate = null;
    for (const blockId of FIRST_HAND) {
        const result = assertAccepted(select(session, blockId));
        snapshot = result.snapshot;
        const found = result.events.find(event => event.kind === 'ultimate-resolved');
        if (found) ultimate = found.payload;
    }
    assert.ok(ultimate);
    assert.equal(ultimate.hand.pair.pairKind, 'twoSingles');
    assert.deepEqual(ultimate.hand.pair.blockIds, ['B09', 'B10']);
    const handBlockIds = ultimate.hand.melds.flatMap(meld => meld.blockIds)
        .concat(ultimate.hand.pair.blockIds);
    assert.equal(new Set(handBlockIds).size, 10);
    assert.equal(snapshot.phase, 'Collecting');
    session.dispose();
});

test('R01-02: stable full seven is Lost immediately even when a board rescue exists', () => {
    const session = newSession();
    advanceFirstHand(session);
    for (const blockId of ['B22', 'B24', 'B26']) {
        assertAccepted(select(session, blockId));
    }
    const before = session.getSnapshot();
    assert.equal(before.occupiedSlots, 6);
    assert.equal(before.phase, 'Collecting');
    const lost = assertAccepted(select(session, 'B27'));
    assert.equal(lost.snapshot.occupiedSlots, 7);
    assert.equal(lost.snapshot.phase, 'Lost');
    assert.deepEqual(lost.snapshot.terminal, {
        outcome: 'Lost',
        reason: 'full-buffer-stable',
    });
    assert.equal(lost.events.filter(event => event.kind === 'session-ended').length, 1);
    assert.equal(lost.events.find(event => event.kind === 'session-ended').payload.reason, 'full-buffer-stable');
    assert.deepEqual(lost.snapshot.buffer.map(entry => entry.blockId), ['B22', 'B24', 'B26', 'B27']);
    assert.ok(lost.snapshot.board.some(block => block.definition.id === 'B28'));
    const rejected = select(session, 'B28');
    assert.equal(rejected.accepted, false);
    assert.equal(rejected.reason, 'terminal');
    const restarted = assertAccepted(session.dispatch({
        kind: 'restart',
        sessionId: lost.snapshot.sessionId,
    }));
    assert.equal(restarted.snapshot.phase, 'Collecting');
    assert.equal(restarted.snapshot.revision, 0);
    session.dispose();
});

test('R01-02: a legal combination that leaves fewer than seven slots does not lose', () => {
    const session = newSession();
    const snapshotBefore = advanceFirstHand(session);
    const initialRevision = snapshotBefore.revision;
    assertAccepted(select(session, 'B21'));
    assertAccepted(select(session, 'B23'));
    assertAccepted(select(session, 'B25'));
    assertAccepted(select(session, 'B27'));
    assertAccepted(select(session, 'B29'));
    assertAccepted(select(session, 'B31'));
    assert.equal(session.getSnapshot().occupiedSlots, 6);
    const accepted = assertAccepted(select(session, 'B22'));
    assert.equal(accepted.snapshot.phase, 'Collecting');
    assert.equal(accepted.snapshot.terminal, null);
    assert.ok(accepted.snapshot.occupiedSlots < 7);
    assert.ok(accepted.snapshot.revision > initialRevision);
    session.dispose();
});

test('R01-01: fourth chi immediately promotes an existing buffer double block to pair', () => {
    const session = newSession();
    advanceFirstHand(session);
    for (const blockId of ['B21', 'B22', 'B23', 'B24', 'B27', 'B28']) {
        assertAccepted(select(session, blockId));
    }
    assert.equal(session.getSnapshot().phase, 'Collecting');
    assert.equal(session.getSnapshot().melds.length, 3);
    assertAccepted(select(session, 'B26'));
    assert.equal(session.getSnapshot().occupiedSlots, 2);
    assertAccepted(select(session, 'B29'));
    const result = assertAccepted(select(session, 'B30'));
    const ultimate = result.events.find(event => event.kind === 'ultimate-resolved');
    assert.ok(ultimate);
    assert.equal(ultimate.payload.hand.pair.pairKind, 'doubleBlock');
    assert.deepEqual(ultimate.payload.hand.pair.blockIds, ['B26']);
    assert.equal(ultimate.payload.hand.melds.length, 4);
    assert.equal(ultimate.payload.fan, 'pinghu');
    assert.deepEqual(ultimate.payload.pairCleanup.map(entry => entry.blockId), ['B25']);
    assert.equal(result.snapshot.phase, 'Won');
    session.dispose();
});
