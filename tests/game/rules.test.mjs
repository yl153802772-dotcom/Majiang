import test from 'node:test';
import assert from 'node:assert/strict';
import { enumerateCandidates, chooseCandidate } from '../../assets/Game/Domain/CombinationResolver.ts';
import { applyCombination } from '../../assets/Game/Domain/HandResolver.ts';
import { canSelect } from '../../assets/Game/Domain/BoardRules.ts';
import { canVirtualInsert, evaluateTerminal } from '../../assets/Game/Domain/TerminalRules.ts';
import { calculateFan, selectUltimateTargets } from '../../assets/Game/Domain/UltimateResolver.ts';
import { assertPositionInvariants } from '../../assets/Game/Domain/GameState.ts';
import * as F from './fixtures/rules-fixtures.mjs';

const card = F.card;
const blockOf = (position, blockId) => {
    const block = position.blocks.find(entry => entry.definition.id === blockId);
    assert.ok(block, `missing block ${blockId}`);
    return block;
};
const groupOf = (position, groupId) => {
    const group = position.groups.find(entry => entry.definition.id === groupId);
    assert.ok(group, `missing group ${groupId}`);
    return group;
};
const candidate = (kind, blockIds, bufferIndices, enterOrders, cards) => ({
    kind,
    ...(kind === 'pair'
        ? { pairKind: blockIds.length === 1 ? 'doubleBlock' : 'twoSingles' }
        : {}),
    blockIds,
    bufferIndices,
    enterOrders,
    cards,
});
const anchorBlocks = () => [
    F.single('B49', 'G49', 'wan', 9, { layer: 3 }),
    F.single('B50', 'G49', 'tiao', 9, { layer: 3 }),
];
const collectingWith = (bufferBlocks, extraBoard = []) => F.makePosition({
    blocks: anchorBlocks().concat(bufferBlocks, extraBoard),
    bufferIds: bufferBlocks.map(block => block.definition.id),
});
const tenpaiWith = (bufferBlocks, extraBoard = []) => {
    const melds = F.fourMelds();
    return F.makePosition({
        blocks: melds.blocks.concat(anchorBlocks(), bufferBlocks, extraBoard),
        melds: melds.melds,
        phase: 'Tenpai',
        bufferIds: bufferBlocks.map(block => block.definition.id),
    });
};

const FIRST_HAND_MELDS = [
    { blocks: ['B01', 'B02'], kind: 'peng', cards: [card('tong', 1), card('tong', 1), card('tong', 1)] },
    { blocks: ['B03', 'B04'], kind: 'peng', cards: [card('tong', 2), card('tong', 2), card('tong', 2)] },
    { blocks: ['B05', 'B06'], kind: 'peng', cards: [card('tong', 3), card('tong', 3), card('tong', 3)] },
    { blocks: ['B07', 'B08'], kind: 'kong', cards: [card('tong', 4), card('tong', 4), card('tong', 4), card('tong', 4)] },
];

function applyFixedMelds(position, count) {
    let next = position;
    for (let index = 0; index < count; index++) {
        const meld = FIRST_HAND_MELDS[index];
        next = F.selectBlocks(next, meld.blocks);
        const first = blockOf(next, meld.blocks[0]);
        const second = blockOf(next, meld.blocks[1]);
        const step = applyCombination(next, candidate(
            meld.kind,
            meld.blocks,
            [0, 1],
            [first.enterOrder, second.enterOrder],
            meld.cards,
        ));
        next = step.next;
    }
    return next;
}

function fixedFirstHandPosition() {
    let position = applyFixedMelds(F.initialFixedPosition(), 4);
    position = F.selectBlocks(position, ['B09', 'B10']);
    const first = blockOf(position, 'B09');
    const second = blockOf(position, 'B10');
    const step = applyCombination(position, candidate(
        'pair',
        ['B09', 'B10'],
        [0, 1],
        [first.enterOrder, second.enterOrder],
        [card('tong', 5), card('tong', 5)],
    ));
    return { position: step.next, winningHand: step.winningHand };
}

function removeBoardBlocks(position) {
    const next = F.clonePosition(position);
    for (const block of next.blocks) {
        if (block.location === 'board') {
            block.location = 'removed';
            block.enterOrder = null;
        }
    }
    const blockById = new Map(next.blocks.map(block => [block.definition.id, block]));
    next.groups = next.groups.map(group => {
        const members = group.definition.blockIds.map(id => blockById.get(id));
        const onBoard = members.filter(member => member.location === 'board').length;
        const hasEntered = members.some(member => member.enterOrder !== null);
        return {
            ...group,
            integrity: onBoard === 2 ? 'intact' : onBoard === 0 ? 'removed' : 'broken',
            everBroken: onBoard === 2 ? false : onBoard === 1 ? true : group.everBroken || hasEntered,
        };
    });
    return next;
}

function removeFourthMeld(position) {
    const next = F.clonePosition(position);
    const meld = next.melds[3];
    if (!meld) throw new Error('fixture expected a fourth meld');
    next.melds = next.melds.slice(0, 3);
    for (const blockId of meld.blockIds) {
        const block = next.blocks.find(entry => entry.definition.id === blockId);
        block.location = 'removed';
        block.enterOrder = null;
    }
    const group = next.groups.find(entry => entry.definition.id === 'G04');
    if (group) {
        group.integrity = 'removed';
        group.everBroken = false;
    }
    return next;
}

function deepFreeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.freeze(value);
        for (const key of Object.keys(value)) deepFreeze(value[key]);
    }
    return value;
}

function expectInvariantFailure(position, pattern = /RulesPosition invariant violated/) {
    assert.throws(() => assertPositionInvariants(position), pattern);
}

function fanMeld(meldId, kind, cards) {
    return { meldId, kind, cards: cards.map(entry => card(entry[0], entry[1])) };
}

function fanHand(meldSpecs, pairCards) {
    let blockIndex = 1;
    const nextId = () => 'B' + String(blockIndex++).padStart(2, '0');
    const melds = meldSpecs.map(meld => ({
        meldId: meld.meldId,
        kind: meld.kind,
        blockIds: [nextId(), nextId()],
        cards: meld.cards,
    }));
    return {
        melds,
        pair: {
            pairKind: 'twoSingles',
            blockIds: [nextId(), nextId()],
            cards: pairCards.map(entry => card(entry[0], entry[1])),
        },
    };
}

function targetPosition(specs) {
    const blocks = [];
    let blockIndex = 1;
    specs.forEach((spec, groupIndex) => {
        const nextId = () => 'B' + String(blockIndex++).padStart(2, '0');
        const firstId = nextId();
        const secondId = nextId();
        const suit = ['wan', 'tong', 'tiao'][groupIndex % 3];
        const rank = (groupIndex % 9) + 1;
        const make = (id, location, enterOrder) => F.single(id, spec.groupId, suit, rank, {
            layer: spec.layer,
            location,
            enterOrder,
            blockedBy: spec.blockedBy ?? [],
        });
        if (spec.status === 'intact') {
            blocks.push(make(firstId, 'board', null), make(secondId, 'board', null));
        } else if (spec.status === 'broken') {
            blocks.push(make(firstId, 'board', null), make(secondId, 'buffer', 1));
        } else {
            blocks.push(make(firstId, 'removed', null), make(secondId, 'removed', null));
        }
    });
    return F.makePosition({ blocks, phase: 'Collecting' });
}

/* ------------------------------------------------------------------ */
/* 配方与比较器                                                        */
/* ------------------------------------------------------------------ */

test('TC-01/TC-02: chi uses one single plus one sequence pair; three singles and cross-suit pairs are illegal', () => {
    const singleFiveWan = F.single('B51', 'G51', 'wan', 5, { location: 'buffer', enterOrder: 1 });
    const pairThreeFourWan = F.sequencePair('B52', 'G52', 'wan', 3, { location: 'buffer', enterOrder: 2 });
    const position = collectingWith([singleFiveWan, pairThreeFourWan]);

    const candidates = enumerateCandidates(position);
    assert.equal(candidates.length, 1);
    assert.deepEqual(candidates[0], {
        kind: 'chi',
        blockIds: ['B51', 'B52'],
        bufferIndices: [0, 1],
        enterOrders: [1, 2],
        cards: [card('wan', 3), card('wan', 4), card('wan', 5)],
    });
    assert.deepEqual(chooseCandidate(position, null), candidates[0]);

    const step = applyCombination(position, candidates[0]);
    assert.equal(step.counted, true);
    assert.equal(step.winningHand, null);
    assert.equal(step.next.phase, 'Collecting');
    assert.equal(step.next.melds.length, 1);
    assert.equal(step.next.melds[0].kind, 'chi');
    assert.deepEqual(step.next.melds[0].cards, [card('wan', 3), card('wan', 4), card('wan', 5)]);
    assert.deepEqual(step.next.bufferIds, []);
    assert.equal(blockOf(step.next, 'B51').location, 'meld');
    assert.equal(blockOf(step.next, 'B52').location, 'meld');

    const crossSuit = collectingWith([
        F.single('B51', 'G51', 'tong', 5, { location: 'buffer', enterOrder: 1 }),
        F.sequencePair('B52', 'G52', 'wan', 3, { location: 'buffer', enterOrder: 2 }),
    ]);
    assert.deepEqual(enumerateCandidates(crossSuit), []);

    const threeSingles = collectingWith([
        F.single('B51', 'G51', 'wan', 3, { location: 'buffer', enterOrder: 1 }),
        F.single('B52', 'G52', 'wan', 4, { location: 'buffer', enterOrder: 2 }),
        F.single('B53', 'G53', 'wan', 5, { location: 'buffer', enterOrder: 3 }),
    ]);
    assert.deepEqual(enumerateCandidates(threeSingles), []);

    const nonConsecutive = collectingWith([
        F.single('B51', 'G51', 'wan', 5, { location: 'buffer', enterOrder: 1 }),
        F.makeBlock('B52', 'G52', 'sequencePair', [card('wan', 3), card('wan', 6)], { location: 'buffer', enterOrder: 2 }),
    ]);
    assert.deepEqual(enumerateCandidates(nonConsecutive), []);
});

test('TC-01: capacity counts a single as one slot and a double as two slots', () => {
    const sixSlots = [
        F.identicalPair('B51', 'G51', 'wan', 1, { location: 'buffer', enterOrder: 1 }),
        F.identicalPair('B52', 'G52', 'wan', 2, { location: 'buffer', enterOrder: 2 }),
        F.identicalPair('B53', 'G53', 'wan', 3, { location: 'buffer', enterOrder: 3 }),
    ];
    const singleFits = F.makePosition({
        blocks: sixSlots.concat([F.single('B54', 'G54', 'tong', 9, { layer: 2 })]),
        bufferIds: sixSlots.map(block => block.definition.id),
        phase: 'Collecting',
    });
    assert.deepEqual(canVirtualInsert(singleFits, 'B54'), { legal: true });

    const doubleOverflows = F.makePosition({
        blocks: sixSlots.concat([F.identicalPair('B54', 'G54', 'tong', 9, { layer: 2 })]),
        bufferIds: sixSlots.map(block => block.definition.id),
        phase: 'Collecting',
    });
    assert.deepEqual(canVirtualInsert(doubleOverflows, 'B54'), { legal: false, reason: 'insufficient-space' });
});

test('TC-03: peng uses a single plus an identical pair, independent of buffer order', () => {
    const pair = F.identicalPair('B51', 'G51', 'tong', 2, { location: 'buffer', enterOrder: 1 });
    const single = F.single('B52', 'G52', 'tong', 2, { location: 'buffer', enterOrder: 2 });
    const position = collectingWith([pair, single]);
    const candidates = enumerateCandidates(position);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].kind, 'peng');
    assert.deepEqual(candidates[0].blockIds, ['B51', 'B52']);
    assert.deepEqual(candidates[0].cards, [card('tong', 2), card('tong', 2), card('tong', 2)]);
    const step = applyCombination(position, candidates[0]);
    assert.equal(step.counted, true);
    assert.equal(step.next.melds[0].kind, 'peng');

    const reversed = collectingWith([
        F.single('B51', 'G51', 'tong', 2, { location: 'buffer', enterOrder: 1 }),
        F.identicalPair('B52', 'G52', 'tong', 2, { location: 'buffer', enterOrder: 2 }),
    ]);
    const reversedCandidates = enumerateCandidates(reversed);
    assert.equal(reversedCandidates.length, 1);
    assert.deepEqual(reversedCandidates[0].blockIds, ['B51', 'B52']);
    assert.equal(reversedCandidates[0].kind, 'peng');
});

test('TC-04: kong uses two identical pairs and keeps all four cards', () => {
    const first = F.identicalPair('B51', 'G51', 'tong', 4, { location: 'buffer', enterOrder: 1 });
    const second = F.identicalPair('B52', 'G52', 'tong', 4, { location: 'buffer', enterOrder: 2 });
    const position = collectingWith([first, second]);
    const candidates = enumerateCandidates(position);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].kind, 'kong');
    assert.equal(candidates[0].cards.length, 4);
    const step = applyCombination(position, candidates[0]);
    assert.equal(step.counted, true);
    assert.equal(step.next.melds.length, 1);
    assert.equal(step.next.melds[0].kind, 'kong');
    assert.equal(step.next.melds[0].cards.length, 4);
    assert.deepEqual(step.next.melds[0].cards, [
        card('tong', 4), card('tong', 4), card('tong', 4), card('tong', 4),
    ]);

    const differentPairs = collectingWith([
        F.identicalPair('B51', 'G51', 'tong', 4, { location: 'buffer', enterOrder: 1 }),
        F.identicalPair('B52', 'G52', 'tong', 5, { location: 'buffer', enterOrder: 2 }),
    ]);
    assert.deepEqual(enumerateCandidates(differentPairs), []);
});

test('TC-06: pair candidates exist only in Tenpai and win before chi/peng/kong', () => {
    const first = F.single('B51', 'G51', 'tong', 5, { location: 'buffer', enterOrder: 9 });
    const second = F.single('B52', 'G52', 'tong', 5, { location: 'buffer', enterOrder: 10 });
    const collecting = collectingWith([first, second]);
    assert.deepEqual(enumerateCandidates(collecting), []);

    const tenpai = tenpaiWith([first, second]);
    const pairCandidates = enumerateCandidates(tenpai);
    assert.equal(pairCandidates.length, 1);
    assert.equal(pairCandidates[0].kind, 'pair');
    const step = applyCombination(tenpai, pairCandidates[0]);
    assert.throws(() => applyCombination(step.next, pairCandidates[0]), /not legal/);
    assert.equal(step.counted, false);
    assert.ok(step.winningHand);
    assert.deepEqual(step.winningHand.pair.blockIds, ['B51', 'B52']);
    assert.equal(step.next.melds.length, 4);
    assert.equal(step.next.phase, 'Tenpai');
    assert.equal(blockOf(step.next, 'B51').location, 'pair');
    assert.equal(blockOf(step.next, 'B52').location, 'pair');
    assert.deepEqual(step.next.bufferIds, []);

    const chiSingle = F.single('B53', 'G53', 'wan', 6, { location: 'buffer', enterOrder: 11 });
    const chiPair = F.sequencePair('B54', 'G54', 'wan', 7, { location: 'buffer', enterOrder: 12 });
    const priority = tenpaiWith([first, second, chiSingle, chiPair]);
    const chosen = chooseCandidate(priority, null);
    assert.ok(chosen);
    assert.equal(chosen.kind, 'pair');
    assert.deepEqual(chosen.blockIds, ['B51', 'B52']);
    const chiCandidate = candidate('chi', ['B53', 'B54'], [2, 3], [11, 12], [
        card('wan', 6), card('wan', 7), card('wan', 8),
    ]);
    assert.throws(() => applyCombination(priority, chiCandidate), /pair must take priority/);

    const threeSingles = tenpaiWith([
        F.single('B51', 'G51', 'tong', 5, { location: 'buffer', enterOrder: 9 }),
        F.single('B52', 'G52', 'tong', 5, { location: 'buffer', enterOrder: 10 }),
        F.single('B53', 'G53', 'tong', 5, { location: 'buffer', enterOrder: 11 }),
    ]);
    assert.equal(enumerateCandidates(threeSingles).filter(entry => entry.kind === 'pair').length, 3);
    assert.equal(enumerateCandidates(threeSingles).some(entry => entry.kind !== 'pair'), false);
});

test('R-01: cross-group combinations are legal and multi-candidate ordering is deterministic', () => {
    const three = F.single('B51', 'G51', 'wan', 3, { location: 'buffer', enterOrder: 1 });
    const six = F.single('B52', 'G52', 'wan', 6, { location: 'buffer', enterOrder: 2 });
    const pair45 = F.sequencePair('B53', 'G53', 'wan', 4, { location: 'buffer', enterOrder: 3 });
    const pair12 = F.sequencePair('B54', 'G54', 'wan', 1, { location: 'buffer', enterOrder: 4 });
    const position = collectingWith([three, six, pair45, pair12]);
    const candidates = enumerateCandidates(position);
    assert.equal(candidates.length, 3);
    assert.deepEqual(new Set(candidates.map(entry => entry.blockIds.join('+'))), new Set([
        'B51+B53', 'B52+B53', 'B51+B54',
    ]));

    const chosen = chooseCandidate(position, null);
    assert.ok(chosen);
    assert.deepEqual(chosen.blockIds, ['B51', 'B54']);
    assert.equal(chosen.enterOrders[0], 1);
    assert.equal(chosen.enterOrders[1], 4);

    const withNewSix = chooseCandidate(position, 'B52');
    assert.ok(withNewSix);
    assert.deepEqual(withNewSix.blockIds, ['B52', 'B53']);

    const shuffled = F.makePosition({
        blocks: anchorBlocks().concat([pair12, six, three, pair45]),
        bufferIds: ['B51', 'B52', 'B53', 'B54'],
    });
    assert.deepEqual(chooseCandidate(shuffled, null), chooseCandidate(position, null));
    assert.deepEqual(enumerateCandidates(shuffled), candidates);
});

test('R-01: equal max enterOrder prefers the higher min before any fallback', () => {
    const three = F.single('B51', 'G51', 'wan', 3, { location: 'buffer', enterOrder: 1 });
    const six = F.single('B52', 'G52', 'wan', 6, { location: 'buffer', enterOrder: 2 });
    const pair45 = F.sequencePair('B53', 'G53', 'wan', 4, { location: 'buffer', enterOrder: 4 });
    const position = collectingWith([three, six, pair45]);
    const chosen = chooseCandidate(position, null);
    assert.ok(chosen);
    assert.deepEqual(chosen.blockIds, ['B52', 'B53']);
    assert.deepEqual(chosen.enterOrders, [2, 4]);
    const withNewThree = chooseCandidate(position, 'B51');
    assert.ok(withNewThree);
    assert.deepEqual(withNewThree.blockIds, ['B51', 'B53']);
});

/* ------------------------------------------------------------------ */
/* 结算、听牌与瞬胡                                                    */
/* ------------------------------------------------------------------ */

test('TC-09: removing a combination keeps remaining buffer order compact', () => {
    const pair34 = F.sequencePair('B51', 'G51', 'wan', 3, { location: 'buffer', enterOrder: 1 });
    const unrelated = F.single('B52', 'G52', 'tong', 1, { location: 'buffer', enterOrder: 2 });
    const five = F.single('B53', 'G53', 'wan', 5, { location: 'buffer', enterOrder: 3 });
    const position = collectingWith([pair34, unrelated, five]);
    const target = enumerateCandidates(position).find(entry => entry.blockIds.includes('B53'));
    assert.ok(target);
    assert.deepEqual(target.bufferIndices, [0, 2]);
    const step = applyCombination(position, target);
    assert.deepEqual(step.next.bufferIds, ['B52']);
    assert.equal(blockOf(step.next, 'B52').location, 'buffer');
    assert.equal(blockOf(step.next, 'B52').enterOrder, 2);
});

test('TC-05: fourth meld enters Tenpai and immediately wins with the latest existing pair', () => {
    const three = F.threeMelds();
    const buffer = [
        F.single('B51', 'G51', 'tong', 5, { location: 'buffer', enterOrder: 7 }),
        F.single('B52', 'G52', 'tong', 5, { location: 'buffer', enterOrder: 8 }),
        F.single('B53', 'G53', 'tong', 5, { location: 'buffer', enterOrder: 9 }),
        F.single('B54', 'G54', 'tong', 5, { location: 'buffer', enterOrder: 10 }),
        F.single('B55', 'G55', 'wan', 1, { location: 'buffer', enterOrder: 11 }),
        F.sequencePair('B56', 'G56', 'wan', 2, { location: 'buffer', enterOrder: 12 }),
    ];
    const position = F.makePosition({
        blocks: three.blocks.concat(anchorBlocks(), buffer),
        melds: three.melds,
        phase: 'Collecting',
        bufferIds: buffer.map(block => block.definition.id),
    });
    const fourth = candidate('chi', ['B55', 'B56'], [4, 5], [11, 12], [
        card('wan', 1), card('wan', 2), card('wan', 3),
    ]);
    const step = applyCombination(position, fourth);
    assert.equal(step.counted, true);
    assert.equal(step.next.melds.length, 4);
    assert.equal(step.next.phase, 'Tenpai');
    assert.ok(step.winningHand);
    assert.deepEqual(step.winningHand.pair.blockIds, ['B53', 'B54']);
    assert.deepEqual(step.winningHand.pair.cards, [card('tong', 5), card('tong', 5)]);
    const preservedKong = step.winningHand.melds.find(meld => meld.kind === 'kong');
    assert.ok(preservedKong);
    assert.equal(preservedKong.cards.length, 4);
    assert.equal(blockOf(step.next, 'B53').location, 'pair');
    assert.equal(blockOf(step.next, 'B54').location, 'pair');
    assert.deepEqual(step.next.bufferIds, ['B51', 'B52']);
});

test('TC-05/R-02: a winning pair that clears the table commits phase Won', () => {
    const melds = F.fourMelds();
    const position = F.makePosition({
        blocks: melds.blocks.concat([
            F.single('B51', 'G51', 'tong', 5, { location: 'buffer', enterOrder: 9 }),
            F.single('B52', 'G52', 'tong', 5, { location: 'buffer', enterOrder: 10 }),
        ]),
        melds: melds.melds,
        phase: 'Tenpai',
    });
    const pair = candidate('pair', ['B51', 'B52'], [0, 1], [9, 10], [
        card('tong', 5), card('tong', 5),
    ]);
    const step = applyCombination(position, pair);
    assert.equal(step.next.phase, 'Won');
    assert.equal(step.next.bufferIds.length, 0);
    assert.equal(step.next.blocks.some(block => block.location === 'board'), false);
    assert.deepEqual(evaluateTerminal(step.next), {
        terminal: { outcome: 'Won', reason: 'board-and-buffer-cleared' },
        stalled: false,
    });
});

test('TC-06: a Tenpai chi cancels in the buffer without creating a fifth meld', () => {
    const singleSix = F.single('B51', 'G51', 'wan', 6, { location: 'buffer', enterOrder: 9 });
    const pairSevenEight = F.sequencePair('B52', 'G52', 'wan', 7, { location: 'buffer', enterOrder: 10 });
    const position = tenpaiWith([singleSix, pairSevenEight]);
    const chi = enumerateCandidates(position);
    assert.equal(chi.length, 1);
    const step = applyCombination(position, chi[0]);
    assert.equal(step.counted, false);
    assert.equal(step.winningHand, null);
    assert.equal(step.next.melds.length, 4);
    assert.equal(step.next.phase, 'Tenpai');
    assert.deepEqual(step.next.bufferIds, []);
    assert.equal(blockOf(step.next, 'B51').location, 'removed');
    assert.equal(blockOf(step.next, 'B52').location, 'removed');
});

test('applyCombination rejects stale, fabricated and terminal candidates without consuming cards', () => {
    const position = collectingWith([
        F.single('B51', 'G51', 'wan', 5, { location: 'buffer', enterOrder: 1 }),
        F.sequencePair('B52', 'G52', 'wan', 3, { location: 'buffer', enterOrder: 2 }),
    ]);
    const legal = enumerateCandidates(position)[0];
    const step = applyCombination(position, legal);
    assert.throws(() => applyCombination(step.next, legal), /not legal/);

    const staleOrders = { ...legal, enterOrders: [99, 100] };
    assert.throws(() => applyCombination(position, staleOrders), /not legal/);
    const reversed = { ...legal, blockIds: [legal.blockIds[1], legal.blockIds[0]] };
    assert.throws(() => applyCombination(position, reversed), /not legal/);
    const wrongCards = { ...legal, cards: [card('tong', 1), card('tong', 1), card('tong', 1)] };
    assert.throws(() => applyCombination(position, wrongCards), /not legal/);
    assert.throws(() => applyCombination({ ...position, phase: 'Won' }, legal), /does not accept combinations/);

    const pairInCollecting = candidate('pair', ['B51', 'B52'], [0, 1], [1, 2], [card('tong', 5), card('tong', 5)]);
    assert.throws(() => applyCombination(position, pairInCollecting), /not legal/);
    assert.throws(() => applyCombination(position, null), /malformed candidate/);
    assert.throws(() => applyCombination(position, { ...legal, cards: null }), /malformed candidate/);
});

test('applyCombination and chooseCandidate do not mutate frozen inputs', () => {
    const position = collectingWith([
        F.single('B51', 'G51', 'wan', 5, { location: 'buffer', enterOrder: 1 }),
        F.sequencePair('B52', 'G52', 'wan', 3, { location: 'buffer', enterOrder: 2 }),
    ]);
    const before = JSON.stringify(position);
    deepFreeze(position);
    const legal = chooseCandidate(position, null);
    assert.ok(legal);
    const step = applyCombination(position, legal);
    assert.equal(JSON.stringify(position), before);
    assert.notEqual(step.next.blocks, position.blocks);
    assert.notEqual(step.next.melds, position.melds);
    assert.notEqual(step.next.bufferIds, position.bufferIds);
});

/* ------------------------------------------------------------------ */
/* 遮挡与可选状态                                                      */
/* ------------------------------------------------------------------ */

test('TC-14: blockedBy is the only input occlusion; both blocks must leave before a group unlocks', () => {
    const a1 = F.single('B01', 'G01', 'wan', 1, { layer: 3 });
    const a2 = F.single('B02', 'G01', 'wan', 2, { layer: 3 });
    const b1 = F.single('B03', 'G02', 'tong', 1, { layer: 2, blockedBy: ['G01'] });
    const b2 = F.single('B04', 'G02', 'tong', 2, { layer: 2, blockedBy: ['G01'] });
    const c1 = F.single('B05', 'G03', 'tiao', 1, { layer: 1, blockedBy: ['G01', 'G02'] });
    const c2 = F.single('B06', 'G03', 'tiao', 2, { layer: 1, blockedBy: ['G01', 'G02'] });
    const position = F.makePosition({ blocks: [a1, a2, b1, b2, c1, c2] });

    assert.deepEqual(canSelect(position, 'B01'), { legal: true });
    assert.deepEqual(canSelect(position, 'B03'), { legal: false, reason: 'blocked' });
    assert.deepEqual(canSelect(position, 'B05'), { legal: false, reason: 'blocked' });

    const afterA1 = F.selectBlock(position, 'B01');
    assert.equal(groupOf(afterA1, 'G01').integrity, 'broken');
    assert.equal(groupOf(afterA1, 'G01').everBroken, true);
    assert.deepEqual(canSelect(afterA1, 'B03'), { legal: false, reason: 'blocked' });

    const afterA2 = F.selectBlock(afterA1, 'B02');
    assert.equal(groupOf(afterA2, 'G01').integrity, 'removed');
    assert.deepEqual(canSelect(afterA2, 'B03'), { legal: true });
    assert.deepEqual(canSelect(afterA2, 'B05'), { legal: false, reason: 'blocked' });

    const afterB1 = F.selectBlock(afterA2, 'B03');
    assert.equal(groupOf(afterB1, 'G02').integrity, 'broken');
    assert.deepEqual(canSelect(afterB1, 'B05'), { legal: false, reason: 'blocked' });

    const afterB2 = F.selectBlock(afterB1, 'B04');
    assert.equal(groupOf(afterB2, 'G02').integrity, 'removed');
    assert.deepEqual(canSelect(afterB2, 'B05'), { legal: true });
});

test('canSelect reports terminal, unknown, not-on-board, blocked and locked reasons', () => {
    const a1 = F.single('B01', 'G01', 'wan', 1, { layer: 3 });
    const a2 = F.single('B02', 'G01', 'wan', 2, { layer: 3 });
    const b1 = F.single('B03', 'G02', 'tong', 1, { layer: 2, blockedBy: ['G01'] });
    const b2 = F.single('B04', 'G02', 'tong', 2, { layer: 2, blockedBy: ['G01'] });
    const position = F.makePosition({ blocks: [a1, a2, b1, b2] });

    assert.deepEqual(canSelect({ ...position, phase: 'Lost' }, 'B01'), { legal: false, reason: 'terminal' });
    assert.deepEqual(canSelect(position, 'B99'), { legal: false, reason: 'unknown-block' });
    const afterA1 = F.selectBlock(position, 'B01');
    assert.deepEqual(canSelect(afterA1, 'B01'), { legal: false, reason: 'not-on-board' });
    assert.deepEqual(canSelect(afterA1, 'B03'), { legal: false, reason: 'blocked' });
    const afterA2 = F.selectBlock(afterA1, 'B02');
    assert.deepEqual(canSelect(afterA2, 'B03'), { legal: true });
    assert.deepEqual(canSelect({ ...afterA2, logicalLocks: ['B03'] }, 'B03'), { legal: false, reason: 'locked' });

    const unknownBlocker = F.makePosition({
        blocks: [
            F.single('B51', 'G51', 'wan', 1, { layer: 2, blockedBy: ['G99'] }),
            F.single('B52', 'G52', 'tiao', 1, { layer: 3 }),
        ],
        phase: 'Collecting',
    });
    assert.deepEqual(canSelect(unknownBlocker, 'B51'), { legal: false, reason: 'blocked' });
    assert.deepEqual(canVirtualInsert({ ...unknownBlocker, phase: 'Won' }, 'B51'), { legal: false, reason: 'terminal' });
});

/* ------------------------------------------------------------------ */
/* 七槽、虚拟入槽与终局                                                */
/* ------------------------------------------------------------------ */

test('TC-07/TC-08: 6+2 virtual insert works only when the new block directly combines', () => {
    const buffer = [
        F.identicalPair('B51', 'G51', 'wan', 4, { location: 'buffer', enterOrder: 1 }),
        F.identicalPair('B52', 'G52', 'wan', 1, { location: 'buffer', enterOrder: 2 }),
        F.identicalPair('B53', 'G53', 'wan', 2, { location: 'buffer', enterOrder: 3 }),
    ];
    const matching = collectingWith(buffer, [F.identicalPair('B54', 'G54', 'wan', 4, { layer: 2 })]);
    const before = JSON.stringify(matching);
    assert.deepEqual(canVirtualInsert(matching, 'B54'), { legal: true });
    assert.equal(JSON.stringify(matching), before);

    const nonMatching = collectingWith(buffer, [F.identicalPair('B54', 'G54', 'wan', 9, { layer: 2 })]);
    const nonMatchingBefore = JSON.stringify(nonMatching);
    deepFreeze(nonMatching);
    assert.deepEqual(canVirtualInsert(nonMatching, 'B54'), { legal: false, reason: 'insufficient-space' });
    assert.equal(JSON.stringify(nonMatching), nonMatchingBefore);
});

test('R-02: 7+1 pair rescue is Tenpai-only; 7+2 peng/kong and non-combining cases are strict', () => {
    const sevenBuffer = [
        F.single('B51', 'G51', 'tong', 5, { location: 'buffer', enterOrder: 1 }),
        F.identicalPair('B52', 'G52', 'wan', 1, { location: 'buffer', enterOrder: 2 }),
        F.identicalPair('B53', 'G53', 'wan', 2, { location: 'buffer', enterOrder: 3 }),
        F.identicalPair('B54', 'G54', 'wan', 3, { location: 'buffer', enterOrder: 4 }),
    ];
    const pairBoard = F.single('B55', 'G55', 'tong', 5, { layer: 2 });
    const collecting = collectingWith(sevenBuffer, [pairBoard]);
    assert.deepEqual(canVirtualInsert(collecting, 'B55'), { legal: false, reason: 'insufficient-space' });

    const tenpai = tenpaiWith(sevenBuffer, [pairBoard]);
    assert.deepEqual(canVirtualInsert(tenpai, 'B55'), { legal: true });

    const pengBuffer = [
        F.single('B51', 'G51', 'wan', 6, { location: 'buffer', enterOrder: 1 }),
        F.identicalPair('B52', 'G52', 'wan', 1, { location: 'buffer', enterOrder: 2 }),
        F.identicalPair('B53', 'G53', 'wan', 2, { location: 'buffer', enterOrder: 3 }),
        F.identicalPair('B54', 'G54', 'wan', 3, { location: 'buffer', enterOrder: 4 }),
    ];
    const peng = collectingWith(pengBuffer, [F.identicalPair('B55', 'G55', 'wan', 6, { layer: 2 })]);
    assert.deepEqual(canVirtualInsert(peng, 'B55'), { legal: true });

    const kongBuffer = [
        F.identicalPair('B51', 'G51', 'wan', 4, { location: 'buffer', enterOrder: 1 }),
        F.identicalPair('B52', 'G52', 'wan', 1, { location: 'buffer', enterOrder: 2 }),
        F.identicalPair('B53', 'G53', 'wan', 2, { location: 'buffer', enterOrder: 3 }),
        F.single('B54', 'G54', 'wan', 9, { location: 'buffer', enterOrder: 4 }),
    ];
    const kong = collectingWith(kongBuffer, [F.identicalPair('B55', 'G55', 'wan', 4, { layer: 2 })]);
    assert.deepEqual(canVirtualInsert(kong, 'B55'), { legal: true });

    const sevenForChi = [
        F.sequencePair('B51', 'G51', 'wan', 3, { location: 'buffer', enterOrder: 1 }),
        F.single('B52', 'G52', 'tong', 1, { location: 'buffer', enterOrder: 2 }),
        F.single('B53', 'G53', 'tong', 2, { location: 'buffer', enterOrder: 3 }),
        F.single('B54', 'G54', 'tiao', 1, { location: 'buffer', enterOrder: 4 }),
        F.single('B55', 'G55', 'tiao', 2, { location: 'buffer', enterOrder: 5 }),
        F.single('B56', 'G56', 'wan', 9, { location: 'buffer', enterOrder: 6 }),
    ];
    const chiRescue = collectingWith(sevenForChi, [F.single('B57', 'G57', 'wan', 5, { layer: 2 })]);
    assert.deepEqual(canVirtualInsert(chiRescue, 'B57'), { legal: true });

    const sevenForDoubleChi = [
        F.single('B51', 'G51', 'wan', 6, { location: 'buffer', enterOrder: 1 }),
        F.single('B52', 'G52', 'tong', 1, { location: 'buffer', enterOrder: 2 }),
        F.single('B53', 'G53', 'tong', 2, { location: 'buffer', enterOrder: 3 }),
        F.identicalPair('B54', 'G54', 'tiao', 9, { location: 'buffer', enterOrder: 4 }),
        F.identicalPair('B55', 'G55', 'tiao', 8, { location: 'buffer', enterOrder: 5 }),
    ];
    const doubleChi = collectingWith(sevenForDoubleChi, [
        F.sequencePair('B56', 'G56', 'wan', 7, { layer: 2 }),
    ]);
    assert.deepEqual(canVirtualInsert(doubleChi, 'B56'), { legal: true });

    const sevenSingles = [
        F.single('B51', 'G51', 'wan', 1, { location: 'buffer', enterOrder: 1 }),
        F.single('B52', 'G52', 'wan', 2, { location: 'buffer', enterOrder: 2 }),
        F.single('B53', 'G53', 'wan', 3, { location: 'buffer', enterOrder: 3 }),
        F.single('B54', 'G54', 'wan', 4, { location: 'buffer', enterOrder: 4 }),
        F.single('B55', 'G55', 'wan', 5, { location: 'buffer', enterOrder: 5 }),
        F.single('B56', 'G56', 'wan', 6, { location: 'buffer', enterOrder: 6 }),
        F.single('B57', 'G57', 'wan', 7, { location: 'buffer', enterOrder: 7 }),
    ];
    const noCombine = collectingWith(sevenSingles, [F.identicalPair('B58', 'G58', 'wan', 9, { layer: 2 })]);
    assert.deepEqual(canVirtualInsert(noCombine, 'B58'), { legal: false, reason: 'insufficient-space' });
});

test('R-02: blocked, locked or removed blocks cannot rescue a full buffer', () => {
    const buffer = [
        F.single('B51', 'G51', 'wan', 6, { location: 'buffer', enterOrder: 1 }),
        F.identicalPair('B52', 'G52', 'wan', 1, { location: 'buffer', enterOrder: 2 }),
        F.identicalPair('B53', 'G53', 'wan', 2, { location: 'buffer', enterOrder: 3 }),
        F.identicalPair('B54', 'G54', 'wan', 3, { location: 'buffer', enterOrder: 4 }),
    ];
    const blocked = collectingWith(buffer, [
        F.identicalPair('B55', 'G55', 'wan', 6, { layer: 2, blockedBy: ['G56'] }),
        F.single('B56', 'G56', 'tiao', 1, { layer: 3 }),
    ]);
    assert.deepEqual(canVirtualInsert(blocked, 'B55'), { legal: false, reason: 'blocked' });

    const locked = collectingWith(buffer, [F.identicalPair('B55', 'G55', 'wan', 6, { layer: 2 })]);
    assert.deepEqual(canVirtualInsert({ ...locked, logicalLocks: ['B55'] }, 'B55'), { legal: false, reason: 'locked' });

    const removed = collectingWith(buffer, [F.identicalPair('B55', 'G55', 'wan', 6, { layer: 2, location: 'removed' })]);
    assert.deepEqual(canVirtualInsert(removed, 'B55'), { legal: false, reason: 'not-on-board' });
});

test('R-02: virtual insert still enforces canSelect when buffer capacity is available', () => {
    const blocked = F.makePosition({
        blocks: [
            F.single('B51', 'G51', 'wan', 1, { layer: 2, blockedBy: ['G52'] }),
            F.single('B52', 'G52', 'tiao', 1, { layer: 3 }),
        ],
        phase: 'Collecting',
    });
    assert.deepEqual(canVirtualInsert(blocked, 'B51'), { legal: false, reason: 'blocked' });

    const open = F.makePosition({
        blocks: [
            F.single('B51', 'G51', 'wan', 1, { layer: 2 }),
            F.single('B52', 'G52', 'tiao', 1, { layer: 3 }),
        ],
        phase: 'Collecting',
        logicalLocks: ['B51'],
    });
    assert.deepEqual(canVirtualInsert(open, 'B51'), { legal: false, reason: 'locked' });

    const removed = F.makePosition({
        blocks: [
            F.single('B51', 'G51', 'wan', 1, { layer: 2, location: 'removed' }),
            F.single('B52', 'G52', 'tiao', 1, { layer: 3 }),
        ],
        phase: 'Collecting',
    });
    assert.deepEqual(canVirtualInsert(removed, 'B51'), { legal: false, reason: 'not-on-board' });
});

test('R0.1/R-02: a new identical pair can self-pair in Tenpai and qualify for virtual insert', () => {
    const buffer = [
        F.single('B51', 'G51', 'wan', 6, { location: 'buffer', enterOrder: 9 }),
        F.sequencePair('B52', 'G52', 'wan', 7, { location: 'buffer', enterOrder: 10 }),
        F.single('B53', 'G53', 'tong', 1, { location: 'buffer', enterOrder: 11 }),
        F.single('B54', 'G54', 'tong', 2, { location: 'buffer', enterOrder: 12 }),
        F.single('B55', 'G55', 'tong', 3, { location: 'buffer', enterOrder: 13 }),
        F.single('B56', 'G56', 'tong', 4, { location: 'buffer', enterOrder: 14 }),
    ];
    const position = tenpaiWith(buffer, [F.identicalPair('B57', 'G57', 'wan', 9, { layer: 2 })]);
    assert.equal(enumerateCandidates(position).some(entry => entry.kind === 'chi'), true);
    assert.deepEqual(canVirtualInsert(position, 'B57'), { legal: true });
});

test('R-02: terminal detection is Won only when cleared; Lost requires full/no combination/no rescue', () => {
    const melds = F.fourMelds();
    const won = F.makePosition({ blocks: melds.blocks, melds: melds.melds, phase: 'Won' });
    assert.deepEqual(evaluateTerminal(won), {
        terminal: { outcome: 'Won', reason: 'board-and-buffer-cleared' },
        stalled: false,
    });

    const sevenSingles = [];
    for (let index = 0; index < 7; index++) {
        sevenSingles.push(F.single(
            'B' + String(51 + index).padStart(2, '0'),
            'G' + String(51 + index).padStart(2, '0'),
            'wan',
            index + 1,
            { location: 'buffer', enterOrder: index + 1 },
        ));
    }
    const lost = F.makePosition({ blocks: sevenSingles, phase: 'Collecting' });
    assert.deepEqual(evaluateTerminal(lost), {
        terminal: { outcome: 'Lost', reason: 'full-buffer-stable' },
        stalled: false,
    });

    const withCandidate = fullBufferWithCandidate();
    assert.deepEqual(evaluateTerminal(withCandidate), { terminal: null, stalled: false });

    const rescue = collectingWith(sevenSingles, [F.identicalPair('B58', 'G58', 'wan', 1, { layer: 2 })]);
    assert.deepEqual(evaluateTerminal(rescue), {
        terminal: { outcome: 'Lost', reason: 'full-buffer-stable' },
        stalled: false,
    });

    const selectableButUseless = collectingWith(sevenSingles, [
        F.identicalPair('B58', 'G58', 'tiao', 9, { layer: 2 }),
    ]);
    assert.equal(evaluateTerminal(selectableButUseless).terminal?.outcome, 'Lost');

    const blockedRescue = collectingWith(sevenSingles, [
        F.identicalPair('B58', 'G58', 'wan', 1, { layer: 2, blockedBy: ['G59'] }),
        F.single('B59', 'G59', 'tiao', 1, { layer: 3 }),
    ]);
    assert.equal(evaluateTerminal(blockedRescue).terminal?.outcome, 'Lost');

    const lockedRescue = collectingWith(sevenSingles, [F.identicalPair('B58', 'G58', 'wan', 1, { layer: 2 })]);
    assert.equal(evaluateTerminal({ ...lockedRescue, logicalLocks: ['B58'] }).terminal?.outcome, 'Lost');

    const removedRescue = collectingWith(sevenSingles, [F.identicalPair('B58', 'G58', 'wan', 1, { layer: 2, location: 'removed' })]);
    assert.equal(evaluateTerminal(removedRescue).terminal?.outcome, 'Lost');
});

function fullBufferWithCandidate() {
    const blocks = [
        F.single('B51', 'G51', 'wan', 1, { location: 'buffer', enterOrder: 1 }),
        F.identicalPair('B52', 'G52', 'wan', 1, { location: 'buffer', enterOrder: 2 }),
        F.identicalPair('B53', 'G53', 'wan', 2, { location: 'buffer', enterOrder: 3 }),
        F.identicalPair('B54', 'G54', 'wan', 3, { location: 'buffer', enterOrder: 4 }),
    ];
    return F.makePosition({ blocks, phase: 'Collecting' });
}

test('R-02: incomplete buffer with no move is Stalled, never Lost', () => {
    const three = [
        F.single('B51', 'G51', 'wan', 1, { location: 'buffer', enterOrder: 1 }),
        F.single('B52', 'G52', 'wan', 2, { location: 'buffer', enterOrder: 2 }),
        F.single('B53', 'G53', 'wan', 3, { location: 'buffer', enterOrder: 3 }),
    ];
    const stalled = F.makePosition({ blocks: three, phase: 'Collecting' });
    assert.deepEqual(evaluateTerminal(stalled), { terminal: null, stalled: true });

    const six = [
        F.identicalPair('B51', 'G51', 'wan', 1, { location: 'buffer', enterOrder: 1 }),
        F.identicalPair('B52', 'G52', 'wan', 2, { location: 'buffer', enterOrder: 2 }),
        F.identicalPair('B53', 'G53', 'wan', 3, { location: 'buffer', enterOrder: 3 }),
    ];
    const sixIds = six.map(block => block.definition.id);
    const movable = F.makePosition({
        blocks: six.concat([F.single('B54', 'G54', 'tong', 9, { layer: 2 })]),
        bufferIds: sixIds,
        phase: 'Collecting',
    });
    assert.deepEqual(evaluateTerminal(movable), { terminal: null, stalled: false });

    const blockedMove = F.makePosition({
        blocks: six.concat([F.identicalPair('B54', 'G54', 'tong', 9, { layer: 2 })]),
        bufferIds: sixIds,
        phase: 'Collecting',
    });
    assert.deepEqual(evaluateTerminal(blockedMove), { terminal: null, stalled: true });

    const lockedMove = F.makePosition({
        blocks: six.concat([F.single('B54', 'G54', 'tong', 9, { layer: 2 })]),
        bufferIds: sixIds,
        phase: 'Collecting',
        logicalLocks: ['B54'],
    });
    assert.deepEqual(evaluateTerminal(lockedMove), { terminal: null, stalled: true });

    const withCombination = F.makePosition({
        blocks: [
            F.single('B51', 'G51', 'wan', 1, { location: 'buffer', enterOrder: 1 }),
            F.identicalPair('B52', 'G52', 'wan', 1, { location: 'buffer', enterOrder: 2 }),
        ],
        phase: 'Collecting',
    });
    assert.deepEqual(evaluateTerminal(withCombination), { terminal: null, stalled: false });
});

test('evaluateTerminal is pure and does not modify its input', () => {
    const position = collectingWith([
        F.single('B51', 'G51', 'wan', 5, { location: 'buffer', enterOrder: 1 }),
        F.sequencePair('B52', 'G52', 'wan', 3, { location: 'buffer', enterOrder: 2 }),
    ]);
    const before = JSON.stringify(position);
    deepFreeze(position);
    evaluateTerminal(position);
    assert.equal(JSON.stringify(position), before);
});

/* ------------------------------------------------------------------ */
/* 番型与大招目标                                                      */
/* ------------------------------------------------------------------ */

test('TC-10/R-03: qingyise has power 5 and includes every kong card in the suit check', () => {
    const hand = fanHand([
        fanMeld('M01', 'chi', [['tong', 1], ['tong', 2], ['tong', 3]]),
        fanMeld('M02', 'peng', [['tong', 4], ['tong', 4], ['tong', 4]]),
        fanMeld('M03', 'kong', [['tong', 5], ['tong', 5], ['tong', 5], ['tong', 5]]),
        fanMeld('M04', 'chi', [['tong', 6], ['tong', 7], ['tong', 8]]),
    ], [['tong', 9], ['tong', 9]]);
    deepFreeze(hand);
    const before = JSON.stringify(hand);
    const usedBlockIds = hand.melds.flatMap(meld => meld.blockIds).concat(hand.pair.blockIds);
    assert.equal(new Set(usedBlockIds).size, 10);
    assert.equal(new Set(hand.melds.map(meld => meld.meldId)).size, 4);
    assert.deepEqual(calculateFan(hand), { fan: 'qingyise', power: 5 });
    assert.equal(JSON.stringify(hand), before);
});

test('R-03: pengpenghu is power 2 but never overrides qingyise', () => {
    const mixed = fanHand([
        fanMeld('M01', 'peng', [['wan', 1], ['wan', 1], ['wan', 1]]),
        fanMeld('M02', 'peng', [['tong', 2], ['tong', 2], ['tong', 2]]),
        fanMeld('M03', 'kong', [['tiao', 3], ['tiao', 3], ['tiao', 3], ['tiao', 3]]),
        fanMeld('M04', 'peng', [['wan', 4], ['wan', 4], ['wan', 4]]),
    ], [['tong', 5], ['tong', 5]]);
    assert.deepEqual(calculateFan(mixed), { fan: 'pengpenghu', power: 2 });

    const allTong = fanHand([
        fanMeld('M01', 'peng', [['tong', 1], ['tong', 1], ['tong', 1]]),
        fanMeld('M02', 'peng', [['tong', 2], ['tong', 2], ['tong', 2]]),
        fanMeld('M03', 'kong', [['tong', 3], ['tong', 3], ['tong', 3], ['tong', 3]]),
        fanMeld('M04', 'peng', [['tong', 4], ['tong', 4], ['tong', 4]]),
    ], [['tong', 5], ['tong', 5]]);
    assert.deepEqual(calculateFan(allTong), { fan: 'qingyise', power: 5 });
});

test('R-03: other legal hands are pinghu and malformed hands are rejected', () => {
    const pinghu = fanHand([
        fanMeld('M01', 'chi', [['wan', 1], ['wan', 2], ['wan', 3]]),
        fanMeld('M02', 'peng', [['tong', 4], ['tong', 4], ['tong', 4]]),
        fanMeld('M03', 'chi', [['tiao', 5], ['tiao', 6], ['tiao', 7]]),
        fanMeld('M04', 'peng', [['wan', 8], ['wan', 8], ['wan', 8]]),
    ], [['tiao', 9], ['tiao', 9]]);
    assert.deepEqual(calculateFan(pinghu), { fan: 'pinghu', power: 1 });

    const threeMelds = fanHand([
        fanMeld('M01', 'peng', [['wan', 1], ['wan', 1], ['wan', 1]]),
        fanMeld('M02', 'peng', [['wan', 2], ['wan', 2], ['wan', 2]]),
        fanMeld('M03', 'peng', [['wan', 3], ['wan', 3], ['wan', 3]]),
    ], [['wan', 4], ['wan', 4]]);
    assert.throws(() => calculateFan(threeMelds), /calculateFan/);

    const shortKong = fanHand([
        fanMeld('M01', 'kong', [['wan', 1], ['wan', 1], ['wan', 1]]),
        fanMeld('M02', 'peng', [['wan', 2], ['wan', 2], ['wan', 2]]),
        fanMeld('M03', 'peng', [['wan', 3], ['wan', 3], ['wan', 3]]),
        fanMeld('M04', 'peng', [['wan', 4], ['wan', 4], ['wan', 4]]),
    ], [['wan', 5], ['wan', 5]]);
    assert.throws(() => calculateFan(shortKong), /calculateFan/);

    const mixedKong = fanHand([
        fanMeld('M01', 'kong', [['tong', 1], ['tong', 1], ['tong', 1], ['wan', 1]]),
        fanMeld('M02', 'peng', [['wan', 2], ['wan', 2], ['wan', 2]]),
        fanMeld('M03', 'peng', [['wan', 3], ['wan', 3], ['wan', 3]]),
        fanMeld('M04', 'peng', [['wan', 4], ['wan', 4], ['wan', 4]]),
    ], [['wan', 5], ['wan', 5]]);
    assert.throws(() => calculateFan(mixedKong), /calculateFan/);

    const brokenChi = fanHand([
        fanMeld('M01', 'chi', [['wan', 1], ['wan', 2], ['wan', 4]]),
        fanMeld('M02', 'peng', [['wan', 5], ['wan', 5], ['wan', 5]]),
        fanMeld('M03', 'peng', [['wan', 6], ['wan', 6], ['wan', 6]]),
        fanMeld('M04', 'peng', [['wan', 7], ['wan', 7], ['wan', 7]]),
    ], [['wan', 8], ['wan', 8]]);
    assert.throws(() => calculateFan(brokenChi), /calculateFan/);

    const badPair = fanHand([
        fanMeld('M01', 'peng', [['wan', 1], ['wan', 1], ['wan', 1]]),
        fanMeld('M02', 'peng', [['wan', 2], ['wan', 2], ['wan', 2]]),
        fanMeld('M03', 'peng', [['wan', 3], ['wan', 3], ['wan', 3]]),
        fanMeld('M04', 'peng', [['wan', 4], ['wan', 4], ['wan', 4]]),
    ], [['wan', 5], ['wan', 6]]);
    assert.throws(() => calculateFan(badPair), /calculateFan/);
});

test('R-03: calculateFan rejects mislabeled melds and duplicate/reused BlockIDs', () => {
    const mislabeledPeng = fanHand([
        fanMeld('M01', 'chi', [['tong', 1], ['tong', 1], ['tong', 1]]),
        fanMeld('M02', 'peng', [['wan', 2], ['wan', 2], ['wan', 2]]),
        fanMeld('M03', 'peng', [['wan', 3], ['wan', 3], ['wan', 3]]),
        fanMeld('M04', 'peng', [['wan', 4], ['wan', 4], ['wan', 4]]),
    ], [['wan', 5], ['wan', 5]]);
    assert.throws(() => calculateFan(mislabeledPeng), /legal chi/);

    const valid = fanHand([
        fanMeld('M01', 'peng', [['wan', 1], ['wan', 1], ['wan', 1]]),
        fanMeld('M02', 'peng', [['wan', 2], ['wan', 2], ['wan', 2]]),
        fanMeld('M03', 'peng', [['wan', 3], ['wan', 3], ['wan', 3]]),
        fanMeld('M04', 'peng', [['wan', 4], ['wan', 4], ['wan', 4]]),
    ], [['wan', 5], ['wan', 5]]);

    const duplicateWithin = structuredClone(valid);
    duplicateWithin.melds[0].blockIds[1] = duplicateWithin.melds[0].blockIds[0];
    assert.throws(() => calculateFan(duplicateWithin), /distinct ids/);

    const duplicateAcross = structuredClone(valid);
    duplicateAcross.melds[1].blockIds[0] = duplicateAcross.melds[0].blockIds[0];
    assert.throws(() => calculateFan(duplicateAcross), /reuses block/);

    const pairReusesMeld = structuredClone(valid);
    pairReusesMeld.pair.blockIds[0] = pairReusesMeld.melds[0].blockIds[0];
    assert.throws(() => calculateFan(pairReusesMeld), /pair reuses block/);

    const pairDuplicatesItself = structuredClone(valid);
    pairDuplicatesItself.pair.blockIds[1] = pairDuplicatesItself.pair.blockIds[0];
    assert.throws(() => calculateFan(pairDuplicatesItself), /distinct ids/);

    const duplicateMeldId = structuredClone(valid);
    duplicateMeldId.melds[1].meldId = duplicateMeldId.melds[0].meldId;
    assert.throws(() => calculateFan(duplicateMeldId), /meldId is duplicated/);
});

test('TC-11: four intact groups plus one broken group yields exactly four targets', () => {
    const position = targetPosition([
        { groupId: 'G01', layer: 1, status: 'intact' },
        { groupId: 'G02', layer: 1, status: 'intact' },
        { groupId: 'G03', layer: 1, status: 'intact' },
        { groupId: 'G04', layer: 1, status: 'intact' },
        { groupId: 'G05', layer: 1, status: 'broken' },
    ]);
    const targets = selectUltimateTargets(position, 5);
    assert.deepEqual(targets.map(target => target.groupId), ['G01', 'G02', 'G03', 'G04']);
    assert.equal(targets.flatMap(target => target.blocks).length, 8);
});

test('R-03: targets sort by layer then GroupID, ignore blockedBy and handle shortage/zero', () => {
    const position = targetPosition([
        { groupId: 'G09', layer: 1, status: 'intact' },
        { groupId: 'G01', layer: 3, status: 'intact', blockedBy: ['G02'] },
        { groupId: 'G05', layer: 3, status: 'intact' },
        { groupId: 'G02', layer: 2, status: 'intact' },
        { groupId: 'G03', layer: 2, status: 'intact' },
    ]);
    const targets = selectUltimateTargets(position, 5);
    assert.deepEqual(targets.map(target => target.groupId), ['G01', 'G05', 'G02', 'G03', 'G09']);
    assert.deepEqual(selectUltimateTargets(position, 2).map(target => target.groupId), ['G01', 'G05']);
    assert.deepEqual(selectUltimateTargets(position, 1).map(target => target.groupId), ['G01']);
    assert.equal(new Set(targets.map(target => target.groupId)).size, targets.length);

    const reordered = F.makePosition({
        blocks: Array.from(position.blocks).reverse(),
        groups: Array.from(position.groups).reverse(),
        bufferIds: [],
        phase: 'Collecting',
    });
    assert.deepEqual(
        selectUltimateTargets(reordered, 5).map(target => target.groupId),
        ['G01', 'G05', 'G02', 'G03', 'G09'],
    );

    const broken = targetPosition([
        { groupId: 'G01', layer: 3, status: 'broken' },
        { groupId: 'G02', layer: 2, status: 'intact' },
        { groupId: 'G03', layer: 2, status: 'intact' },
        { groupId: 'G04', layer: 1, status: 'removed' },
        { groupId: 'G05', layer: 1, status: 'intact' },
    ]);
    const filtered = selectUltimateTargets(broken, 5);
    assert.deepEqual(filtered.map(target => target.groupId), ['G02', 'G03', 'G05']);

    const four = targetPosition([
        { groupId: 'G01', layer: 1, status: 'intact' },
        { groupId: 'G02', layer: 1, status: 'intact' },
        { groupId: 'G03', layer: 1, status: 'intact' },
        { groupId: 'G04', layer: 1, status: 'intact' },
    ]);
    assert.equal(selectUltimateTargets(four, 5).length, 4);

    const none = targetPosition([
        { groupId: 'G01', layer: 1, status: 'broken' },
        { groupId: 'G02', layer: 1, status: 'removed' },
    ]);
    assert.deepEqual(selectUltimateTargets(none, 5), []);
    assert.throws(() => selectUltimateTargets(four, 3), /limit/);
});

test('R-03: selected targets are independent copies of the position', () => {
    const position = targetPosition([
        { groupId: 'G01', layer: 3, status: 'intact' },
        { groupId: 'G02', layer: 2, status: 'intact' },
    ]);
    const before = JSON.stringify(position);
    deepFreeze(position);
    const targets = selectUltimateTargets(position, 2);
    assert.equal(JSON.stringify(position), before);
    assert.equal(targets.length, 2);
    targets[0].blocks[0].definition.cards[0].rank = 9;
    targets[0].blocks[0].placement.blockedBy.push('G02');
    assert.equal(JSON.stringify(position), before);
});

/* ------------------------------------------------------------------ */
/* 固定关首手与推荐路径的纯规则部分                                    */
/* ------------------------------------------------------------------ */

test('TC-10: the fixed first hand is qingyise and targets exactly G06-G10', () => {
    let position = F.initialFixedPosition();
    assert.equal(position.blocks.length, 32);

    for (const blockId of ['B01', 'B02', 'B03', 'B04', 'B05', 'B06', 'B07', 'B08', 'B09', 'B10']) {
        assert.deepEqual(canSelect(position, blockId), { legal: true }, `${blockId} should be selectable`);
    }

    const melds = [
        { blocks: ['B01', 'B02'], kind: 'peng', cards: [card('tong', 1), card('tong', 1), card('tong', 1)] },
        { blocks: ['B03', 'B04'], kind: 'peng', cards: [card('tong', 2), card('tong', 2), card('tong', 2)] },
        { blocks: ['B05', 'B06'], kind: 'peng', cards: [card('tong', 3), card('tong', 3), card('tong', 3)] },
        { blocks: ['B07', 'B08'], kind: 'kong', cards: [card('tong', 4), card('tong', 4), card('tong', 4), card('tong', 4)] },
    ];
    for (const meld of melds) {
        position = F.selectBlocks(position, meld.blocks);
        const first = blockOf(position, meld.blocks[0]);
        const second = blockOf(position, meld.blocks[1]);
        const step = applyCombination(position, candidate(meld.kind, meld.blocks, [0, 1], [first.enterOrder, second.enterOrder], meld.cards));
        assert.equal(step.counted, true);
        assert.equal(step.next.phase, step.next.melds.length === 4 ? 'Tenpai' : 'Collecting');
        position = step.next;
        assertPositionInvariants(position);
    }
    assert.equal(position.phase, 'Tenpai');
    assert.equal(position.melds.length, 4);
    assert.deepEqual(position.melds.map(meld => meld.meldId), ['M01', 'M02', 'M03', 'M04']);
    assert.equal(position.melds[3].kind, 'kong');
    assert.equal(position.melds[3].cards.length, 4);

    position = F.selectBlocks(position, ['B09', 'B10']);
    const firstPair = blockOf(position, 'B09');
    const secondPair = blockOf(position, 'B10');
    const pairStep = applyCombination(position, candidate(
        'pair', ['B09', 'B10'], [0, 1], [firstPair.enterOrder, secondPair.enterOrder],
        [card('tong', 5), card('tong', 5)],
    ));
    assert.equal(pairStep.counted, false);
    assert.ok(pairStep.winningHand);
    assert.equal(pairStep.winningHand.melds.length, 4);
    assert.equal(blockOf(pairStep.next, 'B09').location, 'pair');
    assert.equal(blockOf(pairStep.next, 'B10').location, 'pair');
    assert.equal(pairStep.next.phase, 'Tenpai');

    assert.deepEqual(calculateFan(pairStep.winningHand), { fan: 'qingyise', power: 5 });
    const targets = selectUltimateTargets(pairStep.next, 5);
    assert.deepEqual(targets.map(target => target.groupId), ['G06', 'G07', 'G08', 'G09', 'G10']);
    assert.deepEqual(
        targets.flatMap(target => target.blocks.map(block => block.definition.id)),
        ['B11', 'B12', 'B13', 'B14', 'B15', 'B16', 'B17', 'B18', 'B19', 'B20'],
    );
    assert.equal(targets.every(target => target.layer === 2), true);
    assert.equal(pairStep.next.blocks.length, 32);
    assert.equal(pairStep.next.blocks.reduce((total, block) => total + block.definition.cards.length, 0), 48);
});

/* ------------------------------------------------------------------ */
/* 不变量                                                              */
/* ------------------------------------------------------------------ */

test('assertPositionInvariants accepts a full-level Won state with residual melds and pair', () => {
    const firstHand = fixedFirstHandPosition();
    const won = removeBoardBlocks(firstHand.position);
    won.phase = 'Won';
    assertPositionInvariants(won);
    assert.deepEqual(evaluateTerminal(won), {
        terminal: { outcome: 'Won', reason: 'board-and-buffer-cleared' },
        stalled: false,
    });
});

test('assertPositionInvariants accepts the fixed initial state and stays pure', () => {
    const position = F.initialFixedPosition();
    const before = JSON.stringify(position);
    deepFreeze(position);
    assertPositionInvariants(position);
    assert.equal(JSON.stringify(position), before);

    const zeroBased = F.selectBlock(F.initialFixedPosition(), 'B01');
    zeroBased.blocks.find(block => block.definition.id === 'B01').enterOrder = 0;
    assertPositionInvariants(zeroBased);
});

test('assertPositionInvariants enforces fixed-level inventory and bidirectional group membership', () => {
    const initial = F.initialFixedPosition();

    const missingInventory = F.clonePosition(initial);
    missingInventory.blocks = missingInventory.blocks.filter(block => !['B31', 'B32'].includes(block.definition.id));
    missingInventory.groups = missingInventory.groups.filter(group => group.definition.id !== 'G16');
    expectInvariantFailure(missingInventory, /exactly 32 blocks/);

    const missingTile = F.clonePosition(initial);
    blockOf(missingTile, 'B02').definition = {
        id: 'B02',
        groupId: 'G01',
        kind: 'single',
        cards: [card('tong', 1)],
    };
    expectInvariantFailure(missingTile, /conserve exactly 48 tiles/);

    const extraBlock = F.clonePosition(initial);
    const template = blockOf(extraBlock, 'B31');
    extraBlock.blocks.push({
        definition: { id: 'B33', groupId: 'G16', kind: 'single', cards: [card('wan', 1)] },
        placement: { ...template.placement, blockId: 'B33', blockedBy: [] },
        location: 'board',
        enterOrder: null,
    });
    expectInvariantFailure(extraBlock, /not a member of declared group G16/);

    const wrongDeclaredGroup = F.clonePosition(initial);
    blockOf(wrongDeclaredGroup, 'B31').definition.groupId = 'G15';
    expectInvariantFailure(wrongDeclaredGroup, /owned by group G15/);

    const missingBlock = F.clonePosition(initial);
    missingBlock.blocks = missingBlock.blocks.filter(block => block.definition.id !== 'B31');
    expectInvariantFailure(missingBlock, /references missing block B31/);

    const missingGroup = F.clonePosition(initial);
    missingGroup.groups = missingGroup.groups.filter(group => group.definition.id !== 'G16');
    expectInvariantFailure(missingGroup, /references missing group G16/);

    const wrongOwner = F.clonePosition(initial);
    wrongOwner.groups[0].definition.blockIds = ['B01', 'B03'];
    expectInvariantFailure(wrongOwner, /owned by group G02/);
});

test('assertPositionInvariants rejects ID, location, buffer and meld inconsistencies', () => {
    const initial = F.initialFixedPosition();

    const duplicate = F.clonePosition(initial);
    duplicate.blocks[1].definition.id = duplicate.blocks[0].definition.id;
    duplicate.blocks[1].placement.blockId = duplicate.blocks[0].definition.id;
    expectInvariantFailure(duplicate, /duplicates BlockID B01/);

    const unknownBuffer = F.clonePosition(initial);
    unknownBuffer.bufferIds = ['B99'];
    expectInvariantFailure(unknownBuffer, /references missing block B99/);

    const locationMismatch = F.clonePosition(initial);
    locationMismatch.blocks[0].location = 'buffer';
    locationMismatch.blocks[0].enterOrder = 1;
    locationMismatch.groups[0] = {
        definition: locationMismatch.groups[0].definition,
        integrity: 'broken',
        everBroken: true,
    };
    expectInvariantFailure(locationMismatch, /missing from bufferIds/);

    const overflow = F.selectBlocks(initial, ['B01', 'B03', 'B05', 'B09', 'B11', 'B13', 'B15', 'B17']);
    expectInvariantFailure(overflow, /more than seven blocks/);

    const fourMelds = applyFixedMelds(initial, 4);

    const tooManyMelds = F.clonePosition(fourMelds);
    tooManyMelds.melds.push(F.clonePosition(fourMelds).melds[0]);
    expectInvariantFailure(tooManyMelds, /must not exceed four/);

    const shortKong = F.clonePosition(fourMelds);
    shortKong.melds[3].cards = shortKong.melds[3].cards.slice(0, 3);
    expectInvariantFailure(shortKong, /legal kong/);

    const badMeldCards = F.clonePosition(fourMelds);
    badMeldCards.melds[0].cards[0].rank = 9;
    expectInvariantFailure(badMeldCards, /legal peng/);

    const wrongMeldType = F.clonePosition(fourMelds);
    wrongMeldType.melds[0].kind = 'chi';
    expectInvariantFailure(wrongMeldType, /legal chi/);
});

test('assertPositionInvariants rejects unresolved combinations in stable positions', () => {
    const pendingPeng = F.selectBlocks(F.initialFixedPosition(), ['B01', 'B02']);
    expectInvariantFailure(pendingPeng, /unresolved combination/);

    const tenpai = applyFixedMelds(F.initialFixedPosition(), 4);
    const pendingPair = F.selectBlocks(tenpai, ['B13', 'B31']);
    expectInvariantFailure(pendingPair, /unresolved combination/);
});

test('assertPositionInvariants rejects phase and group integrity inconsistencies', () => {
    const initial = F.initialFixedPosition();

    const wrongGroup = F.clonePosition(initial);
    wrongGroup.groups[0].integrity = 'broken';
    expectInvariantFailure(wrongGroup, /integrity is broken, expected intact/);

    const wrongEverBroken = F.clonePosition(initial);
    wrongEverBroken.groups[0].everBroken = true;
    expectInvariantFailure(wrongEverBroken, /intact but marked everBroken/);

    const wrongLayer = F.clonePosition(initial);
    blockOf(wrongLayer, 'B02').placement.layer = 2;
    expectInvariantFailure(wrongLayer, /blocks must share the same layer/);

    const selectTwo = F.selectBlocks(initial, ['B01', 'B02']);
    selectTwo.groups[0].everBroken = false;
    expectInvariantFailure(selectTwo, /everBroken is false, expected true/);

    const tenpaiWithThree = applyFixedMelds(initial, 3);
    tenpaiWithThree.phase = 'Tenpai';
    expectInvariantFailure(tenpaiWithThree, /Tenpai phase must have exactly four melds/);

    const collectingWithFour = applyFixedMelds(initial, 4);
    collectingWithFour.phase = 'Collecting';
    expectInvariantFailure(collectingWithFour, /Collecting phase must have fewer than four melds/);

    const wonWithBoard = F.clonePosition(initial);
    wonWithBoard.phase = 'Won';
    expectInvariantFailure(wonWithBoard, /Won phase does not satisfy/);

    const lostWithoutFullBuffer = F.clonePosition(initial);
    lostWithoutFullBuffer.phase = 'Lost';
    expectInvariantFailure(lostWithoutFullBuffer, /Lost phase does not satisfy/);

    const firstHand = fixedFirstHandPosition();
    const clearedTenpai = removeBoardBlocks(firstHand.position);
    expectInvariantFailure(clearedTenpai, /terminal outcome Won/);

    const mismatchedPair = F.clonePosition(firstHand.position);
    blockOf(mismatchedPair, 'B10').definition.cards[0].rank = 6;
    expectInvariantFailure(mismatchedPair, /two-block pair must have the same card face/);

    const pairWithoutFourMelds = removeFourthMeld(firstHand.position);
    pairWithoutFourMelds.phase = 'Won';
    const clearedWithoutFour = removeBoardBlocks(pairWithoutFourMelds);
    expectInvariantFailure(clearedWithoutFour, /pair blocks require exactly four melds/);
});

test('assertPositionInvariants rejects enterOrder and logical lock inconsistencies', () => {
    const initial = F.initialFixedPosition();
    const position = F.selectBlocks(initial, ['B01', 'B03']);

    const duplicateOrder = F.clonePosition(position);
    blockOf(duplicateOrder, 'B03').enterOrder = 1;
    expectInvariantFailure(duplicateOrder, /reuses enterOrder 1/);

    const boardOrder = F.clonePosition(initial);
    blockOf(boardOrder, 'B01').enterOrder = 99;
    expectInvariantFailure(boardOrder, /on board but already has an enterOrder/);

    const missingOrder = F.clonePosition(position);
    blockOf(missingOrder, 'B03').enterOrder = null;
    expectInvariantFailure(missingOrder, /missing enterOrder/);

    const wrongBufferOrder = F.clonePosition(position);
    wrongBufferOrder.bufferIds = ['B03', 'B01'];
    expectInvariantFailure(wrongBufferOrder, /ascending enterOrder/);

    const duplicateLock = F.clonePosition(initial);
    duplicateLock.logicalLocks = ['B01', 'B01'];
    expectInvariantFailure(duplicateLock, /duplicates B01/);

    const unknownLock = F.clonePosition(initial);
    unknownLock.logicalLocks = ['B99'];
    expectInvariantFailure(unknownLock, /missing block B99/);

    const terminalLock = F.clonePosition(initial);
    terminalLock.phase = 'Won';
    terminalLock.logicalLocks = ['B01'];
    expectInvariantFailure(terminalLock, /terminal phase Won must not keep logical locks/);

    const invalid = F.clonePosition(position);
    invalid.bufferIds = ['B03', 'B01'];
    const invalidBefore = JSON.stringify(invalid);
    expectInvariantFailure(invalid, /ascending enterOrder/);
    assert.equal(JSON.stringify(invalid), invalidBefore);
});

/* ------------------------------------------------------------------ */
/* R0.1 将牌双形式与稳定满七                                           */
/* ------------------------------------------------------------------ */

test('R01-01: four chis + one identical double block wins as a 9-block hand', () => {
    const chis = F.fourChis('wan');
    const doublePair = F.identicalPair('B69', 'G69', 'wan', 9, { location: 'buffer', enterOrder: 9 });
    const position = F.makePosition({
        blocks: chis.blocks.concat(doublePair),
        melds: chis.melds,
        phase: 'Tenpai',
    });
    const pairCandidate = enumerateCandidates(position).find(entry => entry.kind === 'pair');
    assert.ok(pairCandidate);
    assert.equal(pairCandidate.pairKind, 'doubleBlock');
    assert.deepEqual(pairCandidate.blockIds, ['B69']);
    assert.deepEqual(pairCandidate.enterOrders, [9]);
    const step = applyCombination(position, pairCandidate);
    assert.ok(step.winningHand);
    assert.equal(step.winningHand.pair.pairKind, 'doubleBlock');
    assert.deepEqual(step.winningHand.pair.blockIds, ['B69']);
    assert.deepEqual(step.winningHand.pair.cards, [card('wan', 9), card('wan', 9)]);
    const handBlockIds = step.winningHand.melds.flatMap(meld => meld.blockIds)
        .concat(step.winningHand.pair.blockIds);
    assert.equal(new Set(handBlockIds).size, 9);
    assert.deepEqual(calculateFan(step.winningHand), { fan: 'qingyise', power: 5 });
    assert.equal(blockOf(step.next, 'B69').location, 'pair');
    assert.equal(step.next.phase, 'Won');
});

test('R01-01: four chis + two identical single blocks remains a 10-block winning hand', () => {
    const chis = F.fourChis('tong');
    const first = F.single('B69', 'G69', 'tong', 9, { location: 'buffer', enterOrder: 9 });
    const second = F.single('B70', 'G70', 'tong', 9, { location: 'buffer', enterOrder: 10 });
    const position = F.makePosition({
        blocks: chis.blocks.concat(first, second),
        melds: chis.melds,
        phase: 'Tenpai',
    });
    const pairCandidate = enumerateCandidates(position).find(entry => entry.kind === 'pair');
    assert.ok(pairCandidate);
    assert.equal(pairCandidate.pairKind, 'twoSingles');
    const step = applyCombination(position, pairCandidate);
    assert.ok(step.winningHand);
    assert.equal(step.winningHand.pair.pairKind, 'twoSingles');
    assert.deepEqual(step.winningHand.pair.blockIds, ['B69', 'B70']);
    const handBlockIds = step.winningHand.melds.flatMap(meld => meld.blockIds)
        .concat(step.winningHand.pair.blockIds);
    assert.equal(new Set(handBlockIds).size, 10);
    assert.deepEqual(calculateFan(step.winningHand), { fan: 'qingyise', power: 5 });
});

test('R01-01: four mixed chis are pinghu and four same-suit chis are qingyise', () => {
    const mixed = fanHand([
        fanMeld('M01', 'chi', [['wan', 1], ['wan', 2], ['wan', 3]]),
        fanMeld('M02', 'chi', [['tong', 2], ['tong', 3], ['tong', 4]]),
        fanMeld('M03', 'chi', [['tiao', 3], ['tiao', 4], ['tiao', 5]]),
        fanMeld('M04', 'chi', [['wan', 5], ['wan', 6], ['wan', 7]]),
    ], [['wan', 9], ['wan', 9]]);
    assert.deepEqual(calculateFan(mixed), { fan: 'pinghu', power: 1 });
    const sameSuit = fanHand([
        fanMeld('M01', 'chi', [['tong', 1], ['tong', 2], ['tong', 3]]),
        fanMeld('M02', 'chi', [['tong', 2], ['tong', 3], ['tong', 4]]),
        fanMeld('M03', 'chi', [['tong', 3], ['tong', 4], ['tong', 5]]),
        fanMeld('M04', 'chi', [['tong', 4], ['tong', 5], ['tong', 6]]),
    ], [['tong', 9], ['tong', 9]]);
    assert.deepEqual(calculateFan(sameSuit), { fan: 'qingyise', power: 5 });
});

test('R01-01: three melds do not produce a pair candidate or a winning hand', () => {
    const three = F.threeMelds();
    const doublePair = F.identicalPair('B69', 'G69', 'wan', 9, { location: 'buffer', enterOrder: 9 });
    const position = F.makePosition({
        blocks: three.blocks.concat(doublePair),
        melds: three.melds,
        phase: 'Collecting',
    });
    assert.equal(enumerateCandidates(position).some(entry => entry.kind === 'pair'), false);
    assert.equal(evaluateTerminal(position).terminal, null);
});

test('R01-01: sequence pairs and board-only identical pairs do not auto-win', () => {
    const chis = F.fourChis('wan');
    const sequence = F.sequencePair('B69', 'G69', 'wan', 7, { location: 'buffer', enterOrder: 9 });
    const sequencePosition = F.makePosition({
        blocks: chis.blocks.concat(sequence),
        melds: chis.melds,
        phase: 'Tenpai',
    });
    assert.equal(enumerateCandidates(sequencePosition).some(entry => entry.kind === 'pair'), false);

    const boardPair = F.identicalPair('B70', 'G70', 'wan', 9, { layer: 2 });
    const boardPosition = F.makePosition({
        blocks: chis.blocks.concat(boardPair),
        melds: chis.melds,
        phase: 'Tenpai',
    });
    assert.equal(enumerateCandidates(boardPosition).some(entry => entry.kind === 'pair'), false);
    assert.equal(evaluateTerminal(boardPosition).terminal, null);
});

test('R01-01: pair wins before a chi in Tenpai and supports the double-block form', () => {
    const chis = F.fourChis('wan');
    const doublePair = F.identicalPair('B69', 'G69', 'wan', 9, { location: 'buffer', enterOrder: 9 });
    const chiSingle = F.single('B71', 'G71', 'wan', 6, { location: 'buffer', enterOrder: 10 });
    const chiPair = F.sequencePair('B72', 'G72', 'wan', 7, { location: 'buffer', enterOrder: 11 });
    const position = F.makePosition({
        blocks: chis.blocks.concat(doublePair, chiSingle, chiPair),
        melds: chis.melds,
        phase: 'Tenpai',
    });
    const chosen = chooseCandidate(position, null);
    assert.ok(chosen);
    assert.equal(chosen.kind, 'pair');
    assert.equal(chosen.pairKind, 'doubleBlock');
    const chiCandidate = candidate('chi', ['B71', 'B72'], [1, 2], [10, 11], [
        card('wan', 6), card('wan', 7), card('wan', 8),
    ]);
    assert.throws(() => applyCombination(position, chiCandidate), /pair must take priority/);
});

test('R01-01: fourth meld immediately uses an existing double-block pair', () => {
    const three = F.threeMelds();
    const doublePair = F.identicalPair('B69', 'G69', 'wan', 9, { location: 'buffer', enterOrder: 7 });
    const chiSingle = F.single('B71', 'G71', 'wan', 1, { location: 'buffer', enterOrder: 8 });
    const chiPair = F.sequencePair('B72', 'G72', 'wan', 2, { location: 'buffer', enterOrder: 9 });
    const position = F.makePosition({
        blocks: three.blocks.concat(doublePair, chiSingle, chiPair),
        melds: three.melds,
        phase: 'Collecting',
        bufferIds: ['B69', 'B71', 'B72'],
    });
    const fourth = candidate('chi', ['B71', 'B72'], [1, 2], [8, 9], [
        card('wan', 1), card('wan', 2), card('wan', 3),
    ]);
    const step = applyCombination(position, fourth);
    assert.equal(step.counted, true);
    assert.equal(step.next.phase, 'Won');
    assert.ok(step.winningHand);
    assert.equal(step.winningHand.pair.pairKind, 'doubleBlock');
    assert.deepEqual(step.winningHand.pair.blockIds, ['B69']);
    assert.deepEqual(blockOf(step.next, 'B69').location, 'pair');
    assert.deepEqual(step.next.bufferIds, []);
});
