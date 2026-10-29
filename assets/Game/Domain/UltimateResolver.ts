/**
 * 番型与不可变大招目标快照。
 * 只读取传入手牌/局面，不修改输入，不依赖会话、UI 或随机。
 */

import { cardsEqual, isCard } from './CardTypes';
import type { Card } from './CardTypes';
import type { BlockDefinition, BlockID } from './BlockTypes';
import type { Placement } from './LevelDefinition';
import { meldCardsMatch } from './GameState';
import type {
    FanResult,
    MeldKind,
    MeldRecord,
    RuleBlock,
    RulesPosition,
    TargetBlock,
    UltimateTarget,
    WinningHand,
} from './GameState';

const MELD_KINDS: readonly MeldKind[] = ['chi', 'peng', 'kong'];

function handFailure(message: string): never {
    throw new Error('calculateFan: ' + message);
}

function validateMeld(
    meld: MeldRecord,
    index: number,
    usedBlockIds: Set<string>,
    meldIds: Set<string>,
): void {
    const path = `melds[${index}]`;
    if (!meld || typeof meld !== 'object') handFailure(`${path} must be an object`);
    if (typeof meld.meldId !== 'string' || meld.meldId.length === 0) {
        handFailure(`${path}.meldId must be a non-empty string`);
    }
    if (meldIds.has(meld.meldId)) handFailure(`${path}.meldId is duplicated`);
    meldIds.add(meld.meldId);
    if (!MELD_KINDS.includes(meld.kind)) handFailure(`${path}.kind is invalid`);
    if (!Array.isArray(meld.blockIds) || meld.blockIds.length !== 2 || meld.blockIds[0] === meld.blockIds[1]) {
        handFailure(`${path}.blockIds must contain two distinct ids`);
    }
    for (const blockId of meld.blockIds) {
        if (typeof blockId !== 'string' || blockId.length === 0) {
            handFailure(`${path}.blockIds must contain non-empty string ids`);
        }
        if (usedBlockIds.has(blockId)) handFailure(`${path} reuses block ${blockId}`);
        usedBlockIds.add(blockId);
    }
    if (!meldCardsMatch(meld.kind, meld.cards)) {
        handFailure(`${path} card faces do not form a legal ${meld.kind}`);
    }
}

function validatePair(hand: WinningHand, usedBlockIds: Set<string>): void {
    if (!hand.pair || typeof hand.pair !== 'object') handFailure('pair must be an object');
    if (hand.pair.pairKind !== 'twoSingles' && hand.pair.pairKind !== 'doubleBlock') {
        handFailure('pairKind must be twoSingles or doubleBlock');
    }
    if (!Array.isArray(hand.pair.cards) || hand.pair.cards.length !== 2) {
        handFailure('pair must contain exactly two cards');
    }
    const expectedBlocks = hand.pair.pairKind === 'doubleBlock' ? 1 : 2;
    if (!Array.isArray(hand.pair.blockIds) || hand.pair.blockIds.length !== expectedBlocks) {
        handFailure(`pair ${hand.pair.pairKind} must contain ${expectedBlocks} block id`);
    }
    if (hand.pair.pairKind === 'twoSingles' &&
        hand.pair.blockIds[0] === hand.pair.blockIds[1]) {
        handFailure('twoSingles pair blockIds must contain two distinct ids');
    }
    for (const blockId of hand.pair.blockIds) {
        if (typeof blockId !== 'string' || blockId.length === 0) {
            handFailure('pair blockIds must contain non-empty string ids');
        }
        if (usedBlockIds.has(blockId)) handFailure(`pair reuses block ${blockId}`);
        usedBlockIds.add(blockId);
    }
    for (const card of hand.pair.cards) {
        if (!isCard(card)) handFailure('pair contains an invalid card');
    }
    if (!cardsEqual(hand.pair.cards[0], hand.pair.cards[1])) {
        handFailure('pair cards must be identical');
    }
}

function allCards(hand: WinningHand): readonly Card[] {
    const cards: Card[] = [];
    for (const meld of hand.melds) {
        for (const card of meld.cards) cards.push(card);
    }
    for (const card of hand.pair.cards) cards.push(card);
    return cards;
}

/** 只取最高番：清一色 5 > 碰碰胡 2 > 平胡 1。 */
export function calculateFan(hand: WinningHand): FanResult {
    if (!hand || !Array.isArray(hand.melds) || hand.melds.length !== 4) {
        handFailure('winning hand must contain exactly four melds');
    }
    const usedBlockIds = new Set<string>();
    const meldIds = new Set<string>();
    for (let index = 0; index < hand.melds.length; index++) {
        validateMeld(hand.melds[index], index, usedBlockIds, meldIds);
    }
    validatePair(hand, usedBlockIds);

    const cards = allCards(hand);
    const suit = cards[0].suit;
    const allSameSuit = cards.every(card => card.suit === suit);
    if (allSameSuit) return { fan: 'qingyise', power: 5 };

    const allPungs = hand.melds.every(meld => meld.kind === 'peng' || meld.kind === 'kong');
    if (allPungs) return { fan: 'pengpenghu', power: 2 };

    return { fan: 'pinghu', power: 1 };
}

function copyCard(card: Card): Card {
    return { suit: card.suit, rank: card.rank };
}

function copyDefinition(definition: BlockDefinition): BlockDefinition {
    if (definition.kind === 'single') {
        return {
            id: definition.id,
            groupId: definition.groupId,
            kind: 'single',
            cards: [copyCard(definition.cards[0])],
        };
    }
    return {
        id: definition.id,
        groupId: definition.groupId,
        kind: definition.kind,
        cards: [copyCard(definition.cards[0]), copyCard(definition.cards[1])],
    };
}

function copyPlacement(placement: Placement): Placement {
    return {
        blockId: placement.blockId,
        x: placement.x,
        y: placement.y,
        layer: placement.layer,
        blockedBy: Array.from(placement.blockedBy),
    };
}

function copyTargetBlock(block: RuleBlock): TargetBlock {
    return {
        definition: copyDefinition(block.definition),
        placement: copyPlacement(block.placement),
    };
}

function compareGroupIds(a: string, b: string): number {
    if (a === b) return 0;
    return a < b ? -1 : 1;
}

interface EligibleGroup {
    readonly groupId: string;
    readonly layer: Placement['layer'];
    readonly first: RuleBlock;
    readonly second: RuleBlock;
}

/** 目标必须 intact 且两块仍在桌面；blockedBy 不参与资格判断。 */
export function selectUltimateTargets(position: RulesPosition, limit: 1 | 2 | 5): readonly UltimateTarget[] {
    if (limit !== 1 && limit !== 2 && limit !== 5) {
        throw new Error('selectUltimateTargets: limit must be 1, 2 or 5');
    }
    const blockById = new Map<BlockID, RuleBlock>();
    for (const block of position.blocks) blockById.set(block.definition.id, block);

    const eligible: EligibleGroup[] = [];
    for (const group of position.groups) {
        if (group.integrity !== 'intact') continue;
        const blockIds = group.definition.blockIds;
        if (!Array.isArray(blockIds) || blockIds.length !== 2) continue;
        const first = blockById.get(blockIds[0]);
        const second = blockById.get(blockIds[1]);
        if (!first || !second) continue;
        if (first.location !== 'board' || second.location !== 'board') continue;
        if (first.placement.layer !== second.placement.layer) continue;
        eligible.push({
            groupId: group.definition.id,
            layer: first.placement.layer,
            first,
            second,
        });
    }

    eligible.sort((a, b) => {
        if (a.layer !== b.layer) return b.layer - a.layer;
        return compareGroupIds(a.groupId, b.groupId);
    });

    return eligible.slice(0, limit).map(entry => ({
        groupId: entry.groupId,
        layer: entry.layer,
        blocks: [copyTargetBlock(entry.first), copyTargetBlock(entry.second)],
    }));
}
