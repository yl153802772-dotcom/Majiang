/**
 * 配方枚举与唯一比较器。
 * 所有配方由真实牌面推导，不使用 GroupID、预设组类型或推荐路线。
 * 将牌支持两个相同单块，也支持一个同牌双块独立成将。
 */

import { cardsEqual } from './CardTypes';
import type { Card } from './CardTypes';
import type { BlockID } from './BlockTypes';
import type {
    DoubleBlockPairCandidate,
    MatchCandidate,
    MeldKind,
    MeldMatchCandidate,
    RuleBlock,
    RulesPosition,
    TwoSinglesPairCandidate,
} from './GameState';

function copyCard(card: Card): Card {
    return { suit: card.suit, rank: card.rank };
}

function matchSingleWithPair(single: Card, pair: readonly Card[]): { readonly kind: 'chi' | 'peng'; readonly cards: readonly Card[] } | null {
    if (pair.length !== 2) return null;
    if (cardsEqual(pair[0], pair[1])) {
        if (!cardsEqual(single, pair[0])) return null;
        return { kind: 'peng', cards: [copyCard(single), copyCard(pair[0]), copyCard(pair[1])] };
    }
    if (single.suit !== pair[0].suit || pair[0].suit !== pair[1].suit) return null;
    const ranks = [single.rank, pair[0].rank, pair[1].rank].sort((a, b) => a - b);
    if (ranks[0] + 1 !== ranks[1] || ranks[1] + 1 !== ranks[2]) return null;
    const ordered = [single, pair[0], pair[1]].slice().sort((a, b) => a.rank - b.rank);
    return { kind: 'chi', cards: ordered.map(copyCard) };
}

function buildTwoBlockCandidate(
    position: RulesPosition,
    first: RuleBlock,
    second: RuleBlock,
    firstIndex: number,
    secondIndex: number,
): MeldMatchCandidate | TwoSinglesPairCandidate | null {
    const firstCards = first.definition.cards;
    const secondCards = second.definition.cards;
    let kind: MeldKind | 'pair' | null = null;
    let cards: readonly Card[] | null = null;

    if (firstCards.length === 1 && secondCards.length === 1) {
        if (position.phase === 'Tenpai' && cardsEqual(firstCards[0], secondCards[0])) {
            kind = 'pair';
            cards = [copyCard(firstCards[0]), copyCard(secondCards[0])];
        }
    } else if (firstCards.length === 1 && secondCards.length === 2) {
        const matched = matchSingleWithPair(firstCards[0], secondCards);
        if (matched) {
            kind = matched.kind;
            cards = matched.cards;
        }
    } else if (firstCards.length === 2 && secondCards.length === 1) {
        const matched = matchSingleWithPair(secondCards[0], firstCards);
        if (matched) {
            kind = matched.kind;
            cards = matched.cards;
        }
    } else if (firstCards.length === 2 && secondCards.length === 2) {
        if (cardsEqual(firstCards[0], firstCards[1]) &&
            cardsEqual(secondCards[0], secondCards[1]) &&
            cardsEqual(firstCards[0], secondCards[0])) {
            kind = 'kong';
            cards = [
                copyCard(firstCards[0]), copyCard(firstCards[1]),
                copyCard(secondCards[0]), copyCard(secondCards[1]),
            ];
        }
    }

    if (kind === null || cards === null) return null;
    if (first.enterOrder === null || second.enterOrder === null) {
        throw new Error('enumerateCandidates: buffer blocks must have enterOrder');
    }
    if (kind === 'pair') {
        return {
            kind: 'pair',
            pairKind: 'twoSingles',
            blockIds: [first.definition.id, second.definition.id],
            bufferIndices: [firstIndex, secondIndex],
            enterOrders: [first.enterOrder, second.enterOrder],
            cards: [copyCard(cards[0]), copyCard(cards[1])],
        };
    }
    return {
        kind,
        blockIds: [first.definition.id, second.definition.id],
        bufferIndices: [firstIndex, secondIndex],
        enterOrders: [first.enterOrder, second.enterOrder],
        cards,
    };
}

function buildDoubleBlockPair(
    position: RulesPosition,
    block: RuleBlock,
    bufferIndex: number,
): DoubleBlockPairCandidate | null {
    if (position.phase !== 'Tenpai' || block.definition.kind !== 'identicalPair') return null;
    if (block.enterOrder === null) {
        throw new Error('enumerateCandidates: buffer block is missing enterOrder');
    }
    const cards = block.definition.cards;
    if (!cardsEqual(cards[0], cards[1])) return null;
    return {
        kind: 'pair',
        pairKind: 'doubleBlock',
        blockIds: [block.definition.id],
        bufferIndices: [bufferIndex],
        enterOrders: [block.enterOrder],
        cards: [copyCard(cards[0]), copyCard(cards[1])],
    };
}

function requireBufferBlock(
    blockById: ReadonlyMap<BlockID, RuleBlock>,
    blockId: BlockID,
    bufferIndex: number,
): RuleBlock {
    const block = blockById.get(blockId);
    if (!block) {
        throw new Error(`enumerateCandidates: bufferIds[${bufferIndex}] references missing block ${blockId}`);
    }
    if (block.location !== 'buffer') {
        throw new Error(`enumerateCandidates: bufferIds[${bufferIndex}] block ${blockId} is not in buffer`);
    }
    if (block.enterOrder === null) {
        throw new Error(`enumerateCandidates: buffer block ${blockId} is missing enterOrder`);
    }
    return block;
}

/** 返回底槽中所有合法配方；终局阶段不产生候选。 */
export function enumerateCandidates(position: RulesPosition): readonly MatchCandidate[] {
    if (position.phase === 'Won' || position.phase === 'Lost') return [];
    const blockById = new Map<BlockID, RuleBlock>();
    for (const block of position.blocks) blockById.set(block.definition.id, block);

    const candidates: MatchCandidate[] = [];
    for (let index = 0; index < position.bufferIds.length; index++) {
        const block = requireBufferBlock(blockById, position.bufferIds[index], index);
        const doublePair = buildDoubleBlockPair(position, block, index);
        if (doublePair) candidates.push(doublePair);
        for (let secondIndex = index + 1; secondIndex < position.bufferIds.length; secondIndex++) {
            const second = requireBufferBlock(blockById, position.bufferIds[secondIndex], secondIndex);
            const candidate = buildTwoBlockCandidate(position, block, second, index, secondIndex);
            if (candidate) candidates.push(candidate);
        }
    }
    return candidates;
}

function maxMin(orders: readonly [number] | readonly [number, number]): readonly [number, number] {
    if (orders.length === 1) return [orders[0], orders[0]];
    return [Math.max(orders[0], orders[1]), Math.min(orders[0], orders[1])];
}

function slotIndices(indices: readonly [number] | readonly [number, number]): readonly [number, number] {
    if (indices.length === 1) return [indices[0], indices[0]];
    return [indices[0], indices[1]];
}

function compareIdTuples(
    a: readonly [BlockID] | readonly [BlockID, BlockID],
    b: readonly [BlockID] | readonly [BlockID, BlockID],
): number {
    const aIds = Array.from(a).sort();
    const bIds = Array.from(b).sort();
    const length = Math.min(aIds.length, bIds.length);
    for (let index = 0; index < length; index++) {
        if (aIds[index] !== bIds[index]) return aIds[index] < bIds[index] ? -1 : 1;
    }
    return aIds.length - bIds.length;
}

/**
 * 唯一比较器：
 * 1. 听牌将牌优先；2. 含本次新块优先；3. 参与块 enterOrder (max,min) 降序；
 * 4. 槽索引排序元组升序；5. 参与 BlockID 排序元组升序。
 * 同牌双块将和两单块将共用同一比较器，不额外偏好某一种。
 */
function compareCandidates(a: MatchCandidate, b: MatchCandidate, newBlockId: BlockID | null): number {
    const aPair = a.kind === 'pair' ? 1 : 0;
    const bPair = b.kind === 'pair' ? 1 : 0;
    if (aPair !== bPair) return bPair - aPair;

    if (newBlockId !== null) {
        const aNew = a.blockIds.includes(newBlockId) ? 1 : 0;
        const bNew = b.blockIds.includes(newBlockId) ? 1 : 0;
        if (aNew !== bNew) return bNew - aNew;
    }

    const aOrders = maxMin(a.enterOrders);
    const bOrders = maxMin(b.enterOrders);
    if (aOrders[0] !== bOrders[0]) return bOrders[0] - aOrders[0];
    if (aOrders[1] !== bOrders[1]) return bOrders[1] - aOrders[1];

    const aIndices = slotIndices(a.bufferIndices);
    const bIndices = slotIndices(b.bufferIndices);
    if (aIndices[0] !== bIndices[0]) return aIndices[0] - bIndices[0];
    if (aIndices[1] !== bIndices[1]) return aIndices[1] - bIndices[1];

    return compareIdTuples(a.blockIds, b.blockIds);
}

/** 使用同一枚举器与比较器选唯一候选；newBlockId=null 表示稳定扫描。 */
export function chooseCandidate(position: RulesPosition, newBlockId: BlockID | null): MatchCandidate | null {
    const candidates = Array.from(enumerateCandidates(position));
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => compareCandidates(a, b, newBlockId));
    return candidates[0];
}
