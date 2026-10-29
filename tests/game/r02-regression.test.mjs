import test from 'node:test';
import assert from 'node:assert/strict';
import { LEVEL_888 } from '../../assets/Game/Config/Level888.ts';
import { RECOMMENDED_SOLUTION_888 } from '../../assets/Game/Config/RecommendedSolution888.ts';
import { GameSession } from '../../assets/Game/Application/GameSession.ts';
import { replay } from '../../assets/Game/Application/GameReplay.ts';
import { selectPairCleanupTargets } from '../../assets/Game/Domain/HandResolver.ts';
import * as F from './fixtures/rules-fixtures.mjs';

const FIRST_HAND = ['B01', 'B02', 'B03', 'B04', 'B05', 'B06', 'B07', 'B08', 'B09', 'B10'];
const CARD_BY_BLOCK = new Map(LEVEL_888.blocks.map(block => [block.id, block.cards]));

function newSession() {
    let ids = 0;
    return new GameSession({
        level: LEVEL_888,
        nextSessionId: () => 'r02-' + (++ids),
    });
}

function select(session, blockId) {
    const snapshot = session.getSnapshot();
    return session.dispatch({ kind: 'select', sessionId: snapshot.sessionId, blockId });
}

function accepted(session, blockId) {
    const result = select(session, blockId);
    assert.equal(result.accepted, true, result.accepted ? '' : `${blockId}: ${result.reason}`);
    return result;
}

function reachFirstHand(session) {
    for (const blockId of FIRST_HAND) accepted(session, blockId);
}

function reachTenpaiFourChis(session) {
    for (const blockId of ['B21', 'B22', 'B23', 'B24', 'B27', 'B28', 'B29', 'B30']) {
        accepted(session, blockId);
    }
    const snapshot = session.getSnapshot();
    assert.equal(snapshot.phase, 'Tenpai');
    assert.equal(snapshot.melds.length, 4);
    return snapshot;
}

function assertConserved(session, label) {
    const snapshot = session.getSnapshot();
    const ids = snapshot.audit.blocks.map(block => block.blockId);
    assert.equal(ids.length, 32, label + ': 32 audit blocks');
    assert.equal(new Set(ids).size, 32, label + ': unique block ids');
    let tiles = 0;
    for (const block of snapshot.audit.blocks) {
        const cards = CARD_BY_BLOCK.get(block.blockId);
        assert.ok(cards, `${label}: missing definition ${block.blockId}`);
        tiles += cards.length;
    }
    assert.equal(tiles, 48, label + ': card sum 48');
    assert.equal(snapshot.audit.totalTileCount, 48, label + ': audit total 48');
    return snapshot;
}

function assertCleanup(ultimate, expected) {
    assert.deepEqual(ultimate.payload.pairCleanup, expected);
    const cleanupIds = ultimate.payload.pairCleanup.map(entry => entry.blockId);
    const handIds = ultimate.payload.hand.melds.flatMap(meld => meld.blockIds)
        .concat(ultimate.payload.hand.pair.blockIds);
    const targetIds = ultimate.payload.targets.flatMap(target => target.blocks.map(block => block.definition.id));
    for (const id of cleanupIds) {
        assert.equal(handIds.includes(id), false, `cleanup ${id} is not in hand`);
        assert.equal(targetIds.includes(id), false, `cleanup ${id} is not a target`);
    }
    assert.equal(new Set([...handIds, ...targetIds, ...cleanupIds]).size,
        handIds.length + targetIds.length + cleanupIds.length,
        'hand/target/cleanup blocks do not overlap');
}

test('R02-01: exact four-chi + B26 double pair removes B25 and clears the level', () => {
    const session = newSession();
    reachFirstHand(session);
    reachTenpaiFourChis(session);
    const before = session.getSnapshot();
    assert.equal(before.board.find(block => block.definition.id === 'B26').highlight, 'winning-pair');
    assert.equal(before.board.find(block => block.definition.id === 'B25').highlight, 'normal');
    const result = accepted(session, 'B26');
    const ultimate = result.events.find(event => event.kind === 'ultimate-resolved');
    assert.ok(ultimate);
    assert.equal(ultimate.payload.fan, 'pinghu');
    assert.equal(ultimate.payload.power, 1);
    assert.deepEqual(ultimate.payload.targets.map(target => target.groupId), ['G16']);
    assert.deepEqual(
        ultimate.payload.targets.flatMap(target => target.blocks.map(block => block.definition.id)),
        ['B31', 'B32'],
    );
    assert.equal(ultimate.payload.hand.pair.pairKind, 'doubleBlock');
    assert.deepEqual(ultimate.payload.hand.pair.blockIds, ['B26']);
    assert.equal(ultimate.payload.hand.melds.length, 4);
    assert.equal(ultimate.payload.hand.melds.every(meld => meld.kind === 'chi'), true);
    assertCleanup(ultimate, [{
        sourceGroupId: 'G13',
        blockId: 'B25',
        previousLocation: 'board',
        cards: [{ suit: 'tiao', rank: 9 }],
    }]);
    const handIds = ultimate.payload.hand.melds.flatMap(meld => meld.blockIds)
        .concat(ultimate.payload.hand.pair.blockIds);
    assert.equal(handIds.length, 9);
    assert.equal(new Set(handIds).size, 9);
    assert.equal(result.snapshot.phase, 'Won');
    assert.deepEqual(result.snapshot.terminal, { outcome: 'Won', reason: 'board-and-buffer-cleared' });
    assert.equal(result.snapshot.board.length, 0);
    assert.equal(result.snapshot.buffer.length, 0);
    assert.equal(result.snapshot.melds.length, 0);
    assertConserved(session, 'R02-01');
    session.dispose();
});

test('R02-02: a B25 in the buffer is removed and the buffer compresses to empty', () => {
    const session = newSession();
    reachFirstHand(session);
    reachTenpaiFourChis(session);
    accepted(session, 'B25');
    assert.equal(session.getSnapshot().occupiedSlots, 1);
    assert.deepEqual(session.getSnapshot().buffer.map(entry => entry.blockId), ['B25']);
    const result = accepted(session, 'B26');
    const ultimate = result.events.find(event => event.kind === 'ultimate-resolved');
    assert.ok(ultimate);
    assertCleanup(ultimate, [{
        sourceGroupId: 'G13',
        blockId: 'B25',
        previousLocation: 'buffer',
        cards: [{ suit: 'tiao', rank: 9 }],
    }]);
    assert.equal(result.snapshot.phase, 'Won');
    assert.equal(result.snapshot.buffer.length, 0);
    assert.equal(result.snapshot.occupiedSlots, 0);
    assertConserved(session, 'R02-02');
    session.dispose();
});

test('R02-03: taking B26 before the fourth chi still cleans B25 on the immediate pair win', () => {
    const session = newSession();
    reachFirstHand(session);
    for (const blockId of ['B21', 'B22', 'B23', 'B24', 'B27', 'B28']) accepted(session, blockId);
    assert.equal(session.getSnapshot().phase, 'Collecting');
    assert.equal(session.getSnapshot().melds.length, 3);
    accepted(session, 'B26');
    assert.equal(session.getSnapshot().occupiedSlots, 2);
    accepted(session, 'B29');
    const result = accepted(session, 'B30');
    const ultimate = result.events.find(event => event.kind === 'ultimate-resolved');
    assert.ok(ultimate);
    assert.equal(ultimate.payload.hand.pair.pairKind, 'doubleBlock');
    assert.deepEqual(ultimate.payload.hand.pair.blockIds, ['B26']);
    assertCleanup(ultimate, [{
        sourceGroupId: 'G13',
        blockId: 'B25',
        previousLocation: 'board',
        cards: [{ suit: 'tiao', rank: 9 }],
    }]);
    assert.equal(result.snapshot.phase, 'Won');
    assertConserved(session, 'R02-03');
    session.dispose();
});

test('R02-04: partner in meld/pair/removed and two-single pairs produce no cleanup', () => {
    const pair = {
        pairKind: 'doubleBlock',
        blockIds: ['B26'],
        cards: [{ suit: 'tiao', rank: 9 }, { suit: 'tiao', rank: 9 }],
    };
    const make = (partnerLocation, partnerEnterOrder = 9) => F.makePosition({
        blocks: [
            F.identicalPair('B26', 'G13', 'tiao', 9, { location: 'pair', enterOrder: 8 }),
            F.single('B25', 'G13', 'tiao', 9, { location: partnerLocation, enterOrder: partnerEnterOrder }),
        ],
        phase: 'Tenpai',
    });
    assert.deepEqual(selectPairCleanupTargets(make('board'), pair).map(entry => entry.blockId), ['B25']);
    assert.deepEqual(selectPairCleanupTargets(make('buffer'), pair).map(entry => entry.blockId), ['B25']);
    assert.deepEqual(selectPairCleanupTargets(make('meld'), pair), []);
    assert.deepEqual(selectPairCleanupTargets(make('pair'), pair), []);
    assert.deepEqual(selectPairCleanupTargets(make('removed', null), pair), []);
    const twoSingles = {
        pairKind: 'twoSingles',
        blockIds: ['B25', 'B26'],
        cards: [{ suit: 'tiao', rank: 9 }, { suit: 'tiao', rank: 9 }],
    };
    assert.deepEqual(selectPairCleanupTargets(make('board'), twoSingles), []);

    const session = newSession();
    let firstHandUltimate = null;
    for (const blockId of FIRST_HAND) {
        const result = accepted(session, blockId);
        const found = result.events.find(event => event.kind === 'ultimate-resolved');
        if (found) firstHandUltimate = found;
    }
    assert.ok(firstHandUltimate);
    assert.equal(firstHandUltimate.payload.hand.pair.pairKind, 'twoSingles');
    assert.deepEqual(firstHandUltimate.payload.pairCleanup, []);
    assert.equal(session.getSnapshot().phase, 'Collecting');
    session.dispose();
});

test('R02-05: only the true group partner is selected; unrelated groups/orphans are ignored', () => {
    const position = F.makePosition({
        blocks: [
            F.identicalPair('B26', 'G13', 'tiao', 9, { location: 'pair', enterOrder: 8 }),
            F.single('B25', 'G13', 'tiao', 9, { location: 'board' }),
            F.single('B60', 'G60', 'wan', 1, { location: 'board' }),
            F.single('B61', 'G61', 'wan', 2, { location: 'buffer', enterOrder: 9 }),
        ],
        phase: 'Tenpai',
    });
    const cleanup = selectPairCleanupTargets(position, {
        pairKind: 'doubleBlock',
        blockIds: ['B26'],
        cards: [{ suit: 'tiao', rank: 9 }, { suit: 'tiao', rank: 9 }],
    });
    assert.deepEqual(cleanup.map(entry => entry.blockId), ['B25']);
    assert.equal(cleanup.some(entry => entry.blockId === 'B60' || entry.blockId === 'B61'), false);
});

test('R02-06: a two-card partner is removed whole; target/power/hand accounting is unchanged', () => {
    const partner = F.sequencePair('B25', 'G13', 'tiao', 8, { location: 'board' });
    const position = F.makePosition({
        blocks: [
            F.identicalPair('B26', 'G13', 'tiao', 9, { location: 'pair', enterOrder: 8 }),
            partner,
        ],
        phase: 'Tenpai',
    });
    const cleanup = selectPairCleanupTargets(position, {
        pairKind: 'doubleBlock',
        blockIds: ['B26'],
        cards: [{ suit: 'tiao', rank: 9 }, { suit: 'tiao', rank: 9 }],
    });
    assert.equal(cleanup.length, 1);
    assert.equal(cleanup[0].blockId, 'B25');
    assert.equal(cleanup[0].cards.length, 2);
});

test('R02-07: recommended route still wins and retains a 10-block first-hand pair', () => {
    const session = newSession();
    let firstUltimate = null;
    for (const blockId of RECOMMENDED_SOLUTION_888) {
        const result = accepted(session, blockId);
        const ultimate = result.events.find(event => event.kind === 'ultimate-resolved');
        if (ultimate && firstUltimate === null) firstUltimate = ultimate;
    }
    assert.ok(firstUltimate);
    assert.equal(firstUltimate.payload.hand.pair.pairKind, 'twoSingles');
    assert.equal(firstUltimate.payload.pairCleanup.length, 0);
    const snapshot = session.getSnapshot();
    assert.equal(snapshot.phase, 'Won');
    assert.equal(snapshot.audit.totalTileCount, 48);
    assertConserved(session, 'R02-07');
    session.dispose();
});

test('R02-09: replay is deterministic, carries pair cleanup, and rejects 888-v2 input', () => {
    const order = [
        ...FIRST_HAND,
        'B21', 'B22', 'B23', 'B24', 'B27', 'B28', 'B29', 'B30', 'B26',
    ];
    const commands = order.map(blockId => ({ kind: 'select', sessionId: 'replay-1', blockId }));
    const input = { levelId: '888', contentVersion: '888-v3', commands };
    const first = replay(LEVEL_888, input);
    const second = replay(LEVEL_888, input);
    assert.deepEqual(first, second);
    const ultimateStep = first.steps.find(step => step.ultimate?.pairKind === 'doubleBlock');
    assert.ok(ultimateStep);
    assert.deepEqual(ultimateStep.ultimate.pairCleanupBlockIds, ['B25']);
    assert.equal(ultimateStep.ultimate.pairCleanupTileCount, 1);
    assert.equal(first.final.phase, 'Won');
    assert.throws(
        () => replay(LEVEL_888, { levelId: '888', contentVersion: '888-v2', commands }),
        /contentVersion/,
    );
});

const FOUR_CHI_GROUPS = [
    ['B21', 'B22'],
    ['B23', 'B24'],
    ['B27', 'B28'],
    ['B29', 'B30'],
];

function permutations(items) {
    if (items.length === 0) return [[]];
    const result = [];
    for (let index = 0; index < items.length; index++) {
        const rest = items.slice(0, index).concat(items.slice(index + 1));
        for (const tail of permutations(rest)) result.push([items[index], ...tail]);
    }
    return result;
}

function assertSnapshotRegions(snapshot, label) {
    const ids = snapshot.audit.blocks.map(block => block.blockId);
    assert.equal(ids.length, 32, label + ': audit has 32 blocks');
    assert.equal(new Set(ids).size, 32, label + ': audit ids unique');
    for (const id of ids) assert.ok(CARD_BY_BLOCK.has(id), label + ': unknown block ' + id);

    const boardIds = snapshot.board.map(block => block.definition.id).sort();
    const bufferIds = snapshot.buffer.map(entry => entry.blockId).sort();
    const meldIds = snapshot.melds.flatMap(meld => meld.blockIds).sort();
    const auditBoard = snapshot.audit.blocks.filter(block => block.location === 'board').map(block => block.blockId).sort();
    const auditBuffer = snapshot.audit.blocks.filter(block => block.location === 'buffer').map(block => block.blockId).sort();
    const auditMeld = snapshot.audit.blocks.filter(block => block.location === 'meld').map(block => block.blockId).sort();
    assert.deepEqual(boardIds, auditBoard, label + ': board regions match');
    assert.deepEqual(bufferIds, auditBuffer, label + ': buffer regions match');
    assert.deepEqual(meldIds, auditMeld, label + ': meld regions match');
    assert.equal(new Set([...boardIds, ...bufferIds, ...meldIds]).size, boardIds.length + bufferIds.length + meldIds.length,
        label + ': one region per block');
    assert.equal(snapshot.occupiedSlots, snapshot.buffer.reduce((total, entry) => total + entry.slotCount, 0),
        label + ': occupied slots');
    let cursor = 0;
    for (const entry of snapshot.buffer) {
        assert.equal(entry.startSlot, cursor, label + ': compact buffer start');
        assert.equal(entry.slotCount, entry.cards.length === 2 ? 2 : 1, label + ': slot count');
        cursor += entry.slotCount;
    }
    assert.equal(cursor, snapshot.occupiedSlots, label + ': compact buffer end');
    let tiles = 0;
    for (const block of snapshot.audit.blocks) {
        tiles += CARD_BY_BLOCK.get(block.blockId).length;
    }
    assert.equal(tiles, 48, label + ': card sum');
    assert.equal(snapshot.audit.totalTileCount, 48, label + ': audit total');
}

function assertFinalRoute(snapshot, ultimate, label, previousLocation) {
    assert.equal(snapshot.phase, 'Won', label + ': Won');
    assert.deepEqual(snapshot.terminal, { outcome: 'Won', reason: 'board-and-buffer-cleared' }, label + ': terminal');
    assert.equal(snapshot.board.length, 0, label + ': board empty');
    assert.equal(snapshot.buffer.length, 0, label + ': buffer empty');
    assert.equal(snapshot.melds.length, 0, label + ': melds empty');
    assert.equal(snapshot.audit.blocks.every(block => block.location === 'removed'), true, label + ': all removed');
    assertSnapshotRegions(snapshot, label);
    assert.ok(ultimate, label + ': ultimate event');
    assert.equal(ultimate.payload.fan, 'pinghu', label + ': pinghu');
    assert.equal(ultimate.payload.power, 1, label + ': power 1');
    assert.deepEqual(ultimate.payload.targets.map(target => target.groupId), ['G16'], label + ': target G16');
    assert.deepEqual(ultimate.payload.hand.melds.map(meld => meld.kind), ['chi', 'chi', 'chi', 'chi'], label + ': four chis');
    assert.equal(ultimate.payload.hand.pair.pairKind, 'doubleBlock', label + ': double pair');
    assert.deepEqual(ultimate.payload.hand.pair.blockIds, ['B26'], label + ': B26 pair');
    assert.deepEqual(ultimate.payload.pairCleanup, [{
        sourceGroupId: 'G13',
        blockId: 'B25',
        previousLocation,
        cards: [{ suit: 'tiao', rank: 9 }],
    }], label + ': B25 only cleanup');
    const handIds = ultimate.payload.hand.melds.flatMap(meld => meld.blockIds)
        .concat(ultimate.payload.hand.pair.blockIds);
    const targetIds = ultimate.payload.targets.flatMap(target => target.blocks.map(block => block.definition.id));
    const cleanupIds = ultimate.payload.pairCleanup.map(entry => entry.blockId);
    assert.equal(new Set([...handIds, ...targetIds, ...cleanupIds]).size,
        handIds.length + targetIds.length + cleanupIds.length, label + ': no overlap');
    assert.equal(handIds.length, 9, label + ': 9 hand ids');
}

test('R02-CLOSE: all 144 four-chi order variants preserve per-step regions, 48 tiles, target and cleanup', () => {
    let variants = 0;
    for (const groupOrder of permutations(FOUR_CHI_GROUPS)) {
        for (const mode of ['after-fourth', 'buffer-before-pair', 'pair-before-fourth']) {
            for (const blockOrder of ['single-first', 'double-first']) {
                const session = newSession();
                let revision = 0;
                let ultimate = null;
                const commands = [];
                for (const blockId of FIRST_HAND) commands.push(blockId);
                const ordered = groupOrder.map(group => blockOrder === 'single-first' ? group : [group[1], group[0]]);
                const firstThree = ordered.slice(0, 3);
                const fourth = ordered[3];
                const pushGroup = group => {
                    for (const blockId of group) commands.push(blockId);
                };
                if (mode === 'pair-before-fourth') {
                    firstThree.forEach(pushGroup);
                    commands.push('B26');
                    pushGroup(fourth);
                } else {
                    ordered.forEach(pushGroup);
                    if (mode === 'buffer-before-pair') commands.push('B25');
                    commands.push('B26');
                }
                for (const blockId of commands) {
                    const result = accepted(session, blockId);
                    revision++;
                    assert.equal(result.snapshot.revision, revision, `${mode}/${blockOrder}: revision`);
                    assertSnapshotRegions(result.snapshot, `${mode}/${blockOrder}/${blockId}`);
                    const found = result.events.find(event => event.kind === 'ultimate-resolved');
                    if (found) ultimate = found;
                }
                assert.ok(ultimate, `${mode}/${blockOrder}: ultimate`);
                assertFinalRoute(session.getSnapshot(), ultimate, `${mode}/${blockOrder}`, mode === 'buffer-before-pair' ? 'buffer' : 'board');
                session.dispose();
                variants++;
            }
        }
    }
    assert.equal(variants, 144);
});

test('R02-CLOSE: a two-card same-group partner is removed as one block in a session white-box level', () => {
    const level = structuredClone(LEVEL_888);
    // Test-only layout unlock: B11-B20 no longer wait for G04. The fixed
    // inventory, cards, groups and all other blockers remain untouched.
    for (const placement of level.placements) {
        if (placement.blockId >= 'B11' && placement.blockId <= 'B20') {
            placement.blockedBy = ['G01', 'G02', 'G03'];
        }
    }
    let ids = 0;
    const session = new GameSession({
        level,
        nextSessionId: () => 'r02-two-card-' + (++ids),
    });
    let ultimate = null;
    for (const blockId of ['B01', 'B02', 'B03', 'B04', 'B05', 'B06', 'B11', 'B12', 'B07']) {
        const result = accepted(session, blockId);
        assertSnapshotRegions(result.snapshot, 'two-card/' + blockId);
        const found = result.events.find(event => event.kind === 'ultimate-resolved');
        if (found) ultimate = found;
    }
    assert.ok(ultimate);
    assert.deepEqual(ultimate.payload.pairCleanup, [{
        sourceGroupId: 'G04',
        blockId: 'B08',
        previousLocation: 'board',
        cards: [{ suit: 'tong', rank: 4 }, { suit: 'tong', rank: 4 }],
    }]);
    assert.equal(ultimate.payload.hand.pair.pairKind, 'doubleBlock');
    assert.deepEqual(ultimate.payload.hand.pair.blockIds, ['B07']);
    assert.deepEqual(ultimate.payload.targets.map(target => target.groupId), ['G05']);
    assert.equal(ultimate.payload.fan, 'pinghu');
    assert.equal(ultimate.payload.power, 1);
    const snapshot = session.getSnapshot();
    assert.equal(snapshot.phase, 'Collecting');
    assert.equal(snapshot.terminal, null);
    assert.equal(snapshot.board.some(block => block.definition.id === 'B08'), false);
    assert.equal(snapshot.board.some(block => block.definition.id === 'B09'), false);
    assert.equal(snapshot.board.some(block => block.definition.id === 'B15'), true);
    const handIds = ultimate.payload.hand.melds.flatMap(meld => meld.blockIds)
        .concat(ultimate.payload.hand.pair.blockIds);
    const targetIds = ultimate.payload.targets.flatMap(target => target.blocks.map(block => block.definition.id));
    assert.equal(handIds.includes('B08'), false);
    assert.equal(targetIds.includes('B08'), false);
    assertSnapshotRegions(snapshot, 'two-card/final');
    session.dispose();
});
