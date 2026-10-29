/**
 * G02 纯规则测试的白盒状态工厂。
 * 仅用于测试构造；不进入 assets，也不调用被测规则算法生成期望答案。
 */

import { LEVEL_888 } from '../../../assets/Game/Config/Level888.ts';

export const card = (suit, rank) => ({ suit, rank });

const cloneCard = value => ({ suit: value.suit, rank: value.rank });
const cloneCards = cards => cards.map(cloneCard);

function cloneBlock(block) {
    return {
        definition: {
            id: block.definition.id,
            groupId: block.definition.groupId,
            kind: block.definition.kind,
            cards: cloneCards(block.definition.cards),
        },
        placement: {
            blockId: block.placement.blockId,
            x: block.placement.x,
            y: block.placement.y,
            layer: block.placement.layer,
            blockedBy: Array.from(block.placement.blockedBy),
        },
        location: block.location,
        enterOrder: block.enterOrder,
    };
}

export function makeBlock(id, groupId, kind, cards, options = {}) {
    return {
        definition: { id, groupId, kind, cards: cloneCards(cards) },
        placement: {
            blockId: id,
            x: options.x ?? 0,
            y: options.y ?? 0,
            layer: options.layer ?? 1,
            blockedBy: Array.from(options.blockedBy ?? []),
        },
        location: options.location ?? 'board',
        enterOrder: options.enterOrder ?? null,
    };
}

export function single(id, groupId, suit, rank, options = {}) {
    return makeBlock(id, groupId, 'single', [card(suit, rank)], options);
}

export function identicalPair(id, groupId, suit, rank, options = {}) {
    return makeBlock(id, groupId, 'identicalPair', [card(suit, rank), card(suit, rank)], options);
}

export function sequencePair(id, groupId, suit, firstRank, options = {}) {
    return makeBlock(id, groupId, 'sequencePair', [card(suit, firstRank), card(suit, firstRank + 1)], options);
}

function autoGroups(blocks) {
    const byGroup = new Map();
    for (const block of blocks) {
        const groupId = block.definition.groupId;
        const members = byGroup.get(groupId) ?? [];
        members.push(block);
        byGroup.set(groupId, members);
    }
    const usedIds = new Set(blocks.map(block => block.definition.id));
    let companionCounter = 99;
    const allocateCompanionId = () => {
        while (companionCounter > 0) {
            const candidateId = 'B' + String(companionCounter).padStart(2, '0');
            companionCounter--;
            if (!usedIds.has(candidateId)) {
                usedIds.add(candidateId);
                return candidateId;
            }
        }
        throw new Error('fixture cannot allocate a companion block id');
    };
    const groups = [];
    for (const [groupId, members] of byGroup) {
        if (members.length === 1) {
            const source = members[0];
            const companion = cloneBlock(source);
            companion.definition.id = allocateCompanionId();
            companion.placement.blockId = companion.definition.id;
            companion.placement.blockedBy = [];
            companion.location = 'removed';
            companion.enterOrder = null;
            members.push(companion);
            blocks.push(companion);
        }
        if (members.length !== 2) {
            throw new Error(`fixture group ${groupId} must contain exactly two blocks`);
        }
        const onBoard = members.filter(block => block.location === 'board').length;
        const hasEntered = members.some(block => block.enterOrder !== null);
        groups.push({
            definition: { id: groupId, blockIds: [members[0].definition.id, members[1].definition.id] },
            integrity: onBoard === 2 ? 'intact' : onBoard === 0 ? 'removed' : 'broken',
            everBroken: onBoard === 2 ? false : onBoard === 1 ? true : hasEntered,
        });
    }
    return groups;
}

export function makePosition(options) {
    const blocks = (options.blocks ?? []).map(cloneBlock);
    const groups = options.groups
        ? options.groups.map(group => ({
            definition: {
                id: group.definition.id,
                blockIds: Array.from(group.definition.blockIds),
            },
            integrity: group.integrity,
            everBroken: group.everBroken,
        }))
        : autoGroups(blocks);
    const bufferIds = options.bufferIds
        ? Array.from(options.bufferIds)
        : blocks.filter(block => block.location === 'buffer').map(block => block.definition.id);
    return {
        phase: options.phase ?? 'Collecting',
        blocks,
        groups,
        bufferIds,
        melds: (options.melds ?? []).map(meld => ({
            meldId: meld.meldId,
            kind: meld.kind,
            blockIds: Array.from(meld.blockIds),
            cards: cloneCards(meld.cards),
        })),
        logicalLocks: Array.from(options.logicalLocks ?? []),
    };
}

export function positionFromLevel(level) {
    const blocks = level.blocks.map(definition => {
        const placement = level.placements.find(entry => entry.blockId === definition.id);
        if (!placement) throw new Error(`fixture level is missing placement for ${definition.id}`);
        return {
            definition: {
                id: definition.id,
                groupId: definition.groupId,
                kind: definition.kind,
                cards: cloneCards(definition.cards),
            },
            placement: {
                blockId: placement.blockId,
                x: placement.x,
                y: placement.y,
                layer: placement.layer,
                blockedBy: Array.from(placement.blockedBy),
            },
            location: 'board',
            enterOrder: null,
        };
    });
    return {
        phase: 'Collecting',
        blocks,
        groups: level.groups.map(group => ({
            definition: { id: group.id, blockIds: Array.from(group.blockIds) },
            integrity: 'intact',
            everBroken: false,
        })),
        bufferIds: [],
        melds: [],
        logicalLocks: [],
    };
}

export function initialFixedPosition() {
    return positionFromLevel(LEVEL_888);
}

/** 模拟 G03 的取牌入槽：board -> buffer，赋单调 enterOrder，并更新组状态。 */
export function selectBlock(position, blockId) {
    const next = structuredClone(position);
    const block = next.blocks.find(entry => entry.definition.id === blockId);
    if (!block) throw new Error(`fixture select: unknown block ${blockId}`);
    if (block.location !== 'board') throw new Error(`fixture select: ${blockId} is not on board`);
    let maximum = 0;
    for (const entry of next.blocks) {
        if (entry.enterOrder !== null && entry.enterOrder > maximum) maximum = entry.enterOrder;
    }
    block.location = 'buffer';
    block.enterOrder = maximum + 1;
    next.bufferIds.push(blockId);
    const blockById = new Map(next.blocks.map(entry => [entry.definition.id, entry]));
    next.groups = next.groups.map(group => {
        const members = group.definition.blockIds.map(id => blockById.get(id));
        const onBoard = members.filter(member => member.location === 'board').length;
        const hasEntered = members.some(member => member.enterOrder !== null);
        if (onBoard === 2) return { ...group, integrity: 'intact', everBroken: false };
        if (onBoard === 0) return { ...group, integrity: 'removed', everBroken: group.everBroken || hasEntered };
        return { ...group, integrity: 'broken', everBroken: true };
    });
    return next;
}

export function selectBlocks(position, blockIds) {
    let next = position;
    for (const blockId of blockIds) next = selectBlock(next, blockId);
    return next;
}

export function nextEnterOrder(position) {
    let maximum = 0;
    for (const block of position.blocks) {
        if (block.enterOrder !== null && block.enterOrder > maximum) maximum = block.enterOrder;
    }
    return maximum + 1;
}

export function makeMeldRecord(meldId, kind, blockIds, cards) {
    return { meldId, kind, blockIds: Array.from(blockIds), cards: cloneCards(cards) };
}

function pengSetup(firstId, secondId, groupId, suit, rank, firstOrder, meldId) {
    const first = single(firstId, groupId, suit, rank, { location: 'meld', enterOrder: firstOrder });
    const second = identicalPair(secondId, groupId, suit, rank, { location: 'meld', enterOrder: firstOrder + 1 });
    return {
        blocks: [first, second],
        meld: makeMeldRecord(meldId, 'peng', [first.definition.id, second.definition.id], [card(suit, rank), card(suit, rank), card(suit, rank)]),
    };
}

function kongSetup(firstId, secondId, groupId, suit, rank, firstOrder, meldId) {
    const first = identicalPair(firstId, groupId, suit, rank, { location: 'meld', enterOrder: firstOrder });
    const second = identicalPair(secondId, groupId, suit, rank, { location: 'meld', enterOrder: firstOrder + 1 });
    return {
        blocks: [first, second],
        meld: makeMeldRecord(meldId, 'kong', [first.definition.id, second.definition.id], [card(suit, rank), card(suit, rank), card(suit, rank), card(suit, rank)]),
    };
}

function chiSetup(firstId, secondId, groupId, suit, startRank, firstOrder, meldId) {
    const first = single(firstId, groupId, suit, startRank, { location: 'meld', enterOrder: firstOrder });
    const second = sequencePair(secondId, groupId, suit, startRank + 1, { location: 'meld', enterOrder: firstOrder + 1 });
    return {
        blocks: [first, second],
        meld: makeMeldRecord(meldId, 'chi', [first.definition.id, second.definition.id], [card(suit, startRank), card(suit, startRank + 1), card(suit, startRank + 2)]),
    };
}

export function fourMelds() {
    const setups = [
        pengSetup('B41', 'B42', 'G41', 'wan', 1, 1, 'M01'),
        pengSetup('B43', 'B44', 'G42', 'wan', 2, 3, 'M02'),
        kongSetup('B45', 'B46', 'G43', 'tong', 3, 5, 'M03'),
        chiSetup('B47', 'B48', 'G44', 'tiao', 4, 7, 'M04'),
    ];
    return {
        blocks: setups.flatMap(setup => setup.blocks),
        melds: setups.map(setup => setup.meld),
    };
}

export function threeMelds() {
    const all = fourMelds();
    return { blocks: all.blocks.slice(0, 6), melds: all.melds.slice(0, 3) };
}

/** 四副吃，供 R0.1 将牌番型/四吃回归使用；可指定同一花色。 */
export function fourChis(suit = 'wan') {
    const specs = [
        { first: 'B61', second: 'B62', group: 'G61', start: 1, order: 1, meldId: 'M61' },
        { first: 'B63', second: 'B64', group: 'G62', start: 2, order: 3, meldId: 'M62' },
        { first: 'B65', second: 'B66', group: 'G63', start: 3, order: 5, meldId: 'M63' },
        { first: 'B67', second: 'B68', group: 'G64', start: 4, order: 7, meldId: 'M64' },
    ];
    const setups = specs.map(spec => chiSetup(spec.first, spec.second, spec.group, suit, spec.start, spec.order, spec.meldId));
    return {
        blocks: setups.flatMap(setup => setup.blocks),
        melds: setups.map(setup => setup.meld),
    };
}

/** 听牌局附加两块完整桌面锚牌，避免空桌面被误判为通关。 */
export function tenpaiPosition(bufferBlocks, options = {}) {
    const melds = options.melds ?? fourMelds();
    const anchor = options.anchor === false ? [] : [
        single('B49', 'G49', 'wan', 9, { layer: 3 }),
        single('B50', 'G49', 'tiao', 9, { layer: 3 }),
    ];
    return makePosition({
        blocks: melds.blocks.concat(anchor, bufferBlocks),
        melds: melds.melds,
        phase: 'Tenpai',
        logicalLocks: options.logicalLocks ?? [],
    });
}

export function clonePosition(position) {
    return structuredClone(position);
}
