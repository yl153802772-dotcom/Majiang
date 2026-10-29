/**
 * 单次配方结算步骤：进入计番区、听牌转态、既有将牌瞬胡、听牌就地抵消。
 * 不实现 GameSession、事件发布、大招清除或完整事务提交。
 */

import { cardsEqual } from './CardTypes';
import type { Card } from './CardTypes';
import type { BlockID } from './BlockTypes';
import { chooseCandidate, enumerateCandidates } from './CombinationResolver';
import { deriveGroupState } from './GameState';
import type {
    BlockLocation,
    GamePhase,
    HandStep,
    MatchCandidate,
    MeldRecord,
    MeldKind,
    PairCleanupRecord,
    PairRecord,
    RuleBlock,
    RulesPosition,
    WinningHand,
} from './GameState';

function copyCard(card: Card): Card {
    return { suit: card.suit, rank: card.rank };
}

function candidateIds(candidate: MatchCandidate): readonly BlockID[] {
    return Array.from(candidate.blockIds);
}

function candidateIndices(candidate: MatchCandidate): readonly number[] {
    return Array.from(candidate.bufferIndices);
}

function candidateOrders(candidate: MatchCandidate): readonly number[] {
    return Array.from(candidate.enterOrders);
}

function sameCandidate(a: MatchCandidate, b: MatchCandidate): boolean {
    if (a.kind !== b.kind) return false;
    if (a.kind === 'pair' && b.kind === 'pair' && a.pairKind !== b.pairKind) return false;
    const aIds = candidateIds(a);
    const bIds = candidateIds(b);
    if (aIds.length !== bIds.length) return false;
    for (let index = 0; index < aIds.length; index++) {
        if (aIds[index] !== bIds[index]) return false;
    }
    const aIndices = candidateIndices(a);
    const bIndices = candidateIndices(b);
    if (aIndices.length !== bIndices.length) return false;
    for (let index = 0; index < aIndices.length; index++) {
        if (aIndices[index] !== bIndices[index]) return false;
    }
    const aOrders = candidateOrders(a);
    const bOrders = candidateOrders(b);
    if (aOrders.length !== bOrders.length) return false;
    for (let index = 0; index < aOrders.length; index++) {
        if (aOrders[index] !== bOrders[index]) return false;
    }
    if (a.cards.length !== b.cards.length) return false;
    for (let index = 0; index < a.cards.length; index++) {
        if (!cardsEqual(a.cards[index], b.cards[index])) return false;
    }
    return true;
}

function copyMeld(meld: MeldRecord): MeldRecord {
    return {
        meldId: meld.meldId,
        kind: meld.kind,
        blockIds: [meld.blockIds[0], meld.blockIds[1]],
        cards: Array.from(meld.cards, copyCard),
    };
}

function copyBlocks(blocks: readonly RuleBlock[]): RuleBlock[] {
    return blocks.map(block => ({
        definition: block.definition,
        placement: block.placement,
        location: block.location,
        enterOrder: block.enterOrder,
    }));
}

function withLocation(
    blocks: readonly RuleBlock[],
    blockIds: ReadonlySet<BlockID>,
    location: BlockLocation,
): RuleBlock[] {
    return blocks.map(block => blockIds.has(block.definition.id)
        ? {
            definition: block.definition,
            placement: block.placement,
            location,
            enterOrder: block.enterOrder,
        }
        : block);
}

function createMeld(candidate: MatchCandidate, meldsBefore: number): MeldRecord {
    if (candidate.kind === 'pair') throw new Error('createMeld: pair is not a meld');
    const kind: MeldKind = candidate.kind;
    return {
        meldId: 'M' + String(meldsBefore + 1).padStart(2, '0'),
        kind,
        blockIds: [candidate.blockIds[0], candidate.blockIds[1]],
        cards: Array.from(candidate.cards, copyCard),
    };
}

function createPairRecord(pair: MatchCandidate): PairRecord {
    if (pair.kind !== 'pair') throw new Error('createPairRecord: candidate is not a pair');
    if (pair.cards.length !== 2) throw new Error('createPairRecord: pair must contain two cards');
    if (pair.pairKind === 'doubleBlock') {
        return {
            pairKind: 'doubleBlock',
            blockIds: [pair.blockIds[0]],
            cards: [copyCard(pair.cards[0]), copyCard(pair.cards[1])],
        };
    }
    return {
        pairKind: 'twoSingles',
        blockIds: [pair.blockIds[0], pair.blockIds[1]],
        cards: [copyCard(pair.cards[0]), copyCard(pair.cards[1])],
    };
}

function createWinningHand(melds: readonly MeldRecord[], pair: MatchCandidate): WinningHand {
    if (melds.length !== 4) throw new Error('createWinningHand: expected exactly four melds');
    if (pair.kind !== 'pair' || pair.cards.length !== 2) {
        throw new Error('createWinningHand: pair candidate must contain two cards');
    }
    const copiedMelds: MeldRecord[] = melds.map(copyMeld);
    return {
        melds: [copiedMelds[0], copiedMelds[1], copiedMelds[2], copiedMelds[3]],
        pair: createPairRecord(pair),
    };
}

function candidateShapeValid(candidate: MatchCandidate): boolean {
    if (!candidate || typeof candidate !== 'object' ||
        !Array.isArray(candidate.blockIds) ||
        !Array.isArray(candidate.bufferIndices) ||
        !Array.isArray(candidate.enterOrders) ||
        !Array.isArray(candidate.cards)) {
        return false;
    }
    const expectedLength = candidate.kind === 'pair' && candidate.pairKind === 'doubleBlock' ? 1 : 2;
    if (candidate.blockIds.length !== expectedLength ||
        candidate.bufferIndices.length !== expectedLength ||
        candidate.enterOrders.length !== expectedLength) {
        return false;
    }
    if (candidate.kind === 'pair') {
        if (candidate.pairKind !== 'twoSingles' && candidate.pairKind !== 'doubleBlock') return false;
        return candidate.cards.length === 2;
    }
    if (candidate.kind !== 'chi' && candidate.kind !== 'peng' && candidate.kind !== 'kong') return false;
    return candidate.cards.length === (candidate.kind === 'kong' ? 4 : 3);
}

/** 执行一次合法组合；返回新状态，不修改传入 position 或关卡定义。 */
export function applyCombination(position: RulesPosition, candidate: MatchCandidate): HandStep {
    if (position.phase === 'Won' || position.phase === 'Lost') {
        throw new Error(`applyCombination: phase ${position.phase} does not accept combinations`);
    }
    if (position.phase === 'Tenpai' && position.melds.length !== 4) {
        throw new Error('applyCombination: Tenpai requires exactly four melds');
    }
    if (position.phase === 'Collecting' && position.melds.length >= 4) {
        throw new Error('applyCombination: Collecting cannot already have four melds');
    }
    if (!candidateShapeValid(candidate)) throw new Error('applyCombination: malformed candidate');

    const legalCandidates = Array.from(enumerateCandidates(position));
    const legal = legalCandidates.find(entry => sameCandidate(entry, candidate));
    if (!legal) throw new Error('applyCombination: candidate is not legal for the current position');
    if (position.phase === 'Tenpai' && legal.kind !== 'pair' &&
        legalCandidates.some(entry => entry.kind === 'pair')) {
        throw new Error('applyCombination: a pair must take priority in Tenpai');
    }

    const involved = new Set<BlockID>(candidateIds(legal));
    const isPair = legal.kind === 'pair';
    const counted = position.phase === 'Collecting' && !isPair;
    const destination: BlockLocation = isPair ? 'pair' : counted ? 'meld' : 'removed';

    let blocks = withLocation(copyBlocks(position.blocks), involved, destination);
    let bufferIds = position.bufferIds.filter(blockId => !involved.has(blockId));
    const melds: MeldRecord[] = position.melds.map(copyMeld);
    let phase: GamePhase = position.phase;
    let winningHand: WinningHand | null = null;

    if (counted) {
        melds.push(createMeld(legal, position.melds.length));
        if (melds.length > 4) throw new Error('applyCombination: melds would exceed four');
        if (melds.length === 4) phase = 'Tenpai';
    }

    if (isPair) {
        winningHand = createWinningHand(melds, legal);
    } else if (position.phase === 'Collecting' && melds.length === 4) {
        // 第四副进入计番区后立即检查底槽既有合法将牌；同一比较器选择最新候选。
        const tentative: RulesPosition = {
            phase: 'Tenpai',
            blocks,
            groups: position.groups,
            bufferIds,
            melds,
            logicalLocks: position.logicalLocks,
        };
        const latestPair = chooseCandidate(tentative, null);
        if (latestPair !== null && latestPair.kind === 'pair') {
            const pairIds = new Set<BlockID>(candidateIds(latestPair));
            blocks = withLocation(blocks, pairIds, 'pair');
            bufferIds = bufferIds.filter(blockId => !pairIds.has(blockId));
            winningHand = createWinningHand(melds, latestPair);
        }
    }

    const boardEmpty = blocks.every(block => block.location !== 'board');
    if (boardEmpty && bufferIds.length === 0) phase = 'Won';

    const blockById = new Map<BlockID, RuleBlock>();
    for (const block of blocks) blockById.set(block.definition.id, block);
    const groups = position.groups.map(group => deriveGroupState(group, blockById));

    const next: RulesPosition = {
        phase,
        blocks,
        groups,
        bufferIds,
        melds,
        logicalLocks: phase === 'Won' ? [] : Array.from(position.logicalLocks),
    };
    return { next, combination: legal, counted, winningHand };
}

/**
 * 双块将的原始同组残块：只按真实 GroupID 找同组另一个 Block。
 * 仅 board/buffer 进入清单；meld/pair/removed 或其他组不处理。
 * 该函数不修改 position，不参与番型/目标/手牌计数。
 */
export function selectPairCleanupTargets(
    position: RulesPosition,
    pair: PairRecord,
): readonly PairCleanupRecord[] {
    if (pair.pairKind !== 'doubleBlock') return [];
    const pairBlockId = pair.blockIds[0];
    const pairBlock = position.blocks.find(block => block.definition.id === pairBlockId);
    if (!pairBlock || pairBlock.location !== 'pair') return [];
    if (pairBlock.definition.kind !== 'identicalPair') return [];
    const group = position.groups.find(entry => entry.definition.id === pairBlock.definition.groupId);
    if (!group || group.definition.blockIds.length !== 2) return [];
    const partnerId = group.definition.blockIds.find(blockId => blockId !== pairBlockId);
    if (!partnerId) return [];
    const partner = position.blocks.find(block => block.definition.id === partnerId);
    if (!partner) return [];
    if (partner.location !== 'board' && partner.location !== 'buffer') return [];
    return [{
        sourceGroupId: pairBlock.definition.groupId,
        blockId: partner.definition.id,
        previousLocation: partner.location,
        cards: Array.from(partner.definition.cards, copyCard),
    }];
}
