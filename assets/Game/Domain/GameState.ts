/**
 * 纯规则状态类型与不变量。
 * 仅属于 Domain：不依赖 cc、wx、Framework、Application、随机或存储。
 * 类型与 MVP_V2_CONTRACTS.md §4.1/§4.2 对齐；本文件不创建 GameSession 或事件系统。
 */

import { cardsEqual, isCard } from './CardTypes';
import type { Card } from './CardTypes';
import { isBlockId, isGroupId } from './BlockTypes';
import type { BlockDefinition, BlockID, GroupID } from './BlockTypes';
import type { GroupDefinition, Placement } from './LevelDefinition';
import { enumerateCandidates } from './CombinationResolver';
import { evaluateTerminal } from './TerminalRules';

export type GamePhase = 'Collecting' | 'Tenpai' | 'Won' | 'Lost';

export type BlockLocation = 'board' | 'buffer' | 'meld' | 'pair' | 'removed';

export type SelectionRejection =
    | 'terminal'
    | 'unknown-block'
    | 'not-on-board'
    | 'blocked'
    | 'locked'
    | 'insufficient-space';

export type GroupIntegrity = 'intact' | 'broken' | 'removed';

export type MeldKind = 'chi' | 'peng' | 'kong';

export type Fan = 'qingyise' | 'pengpenghu' | 'pinghu';

export type FanResult =
    | { readonly fan: 'qingyise'; readonly power: 5 }
    | { readonly fan: 'pengpenghu'; readonly power: 2 }
    | { readonly fan: 'pinghu'; readonly power: 1 };

export interface MeldRecord {
    readonly meldId: string;
    readonly kind: MeldKind;
    readonly blockIds: readonly [BlockID, BlockID];
    readonly cards: readonly Card[]; // chi/peng = 3；kong = 4，运行时校验
}

export interface TwoSinglesPairRecord {
    readonly pairKind: 'twoSingles';
    readonly blockIds: readonly [BlockID, BlockID];
    readonly cards: readonly [Card, Card];
}

export interface DoubleBlockPairRecord {
    readonly pairKind: 'doubleBlock';
    readonly blockIds: readonly [BlockID];
    readonly cards: readonly [Card, Card];
}

/** 将牌恒为两张相同牌；允许一个同牌双块或两个相同单块。 */
export type PairRecord = TwoSinglesPairRecord | DoubleBlockPairRecord;

export interface WinningHand {
    readonly melds: readonly [MeldRecord, MeldRecord, MeldRecord, MeldRecord];
    readonly pair: PairRecord;
}

export interface TargetBlock {
    readonly definition: BlockDefinition;
    readonly placement: Placement;
}

export interface UltimateTarget {
    readonly groupId: GroupID;
    readonly layer: Placement['layer'];
    readonly blocks: readonly [TargetBlock, TargetBlock];
}

/** 双块将的原始同组伙伴；仅 board/buffer 会进入清理清单。 */
export interface PairCleanupRecord {
    readonly sourceGroupId: GroupID;
    readonly blockId: BlockID;
    readonly previousLocation: 'board' | 'buffer';
    readonly cards: readonly Card[];
}

export type UltimateSnapshot = FanResult & {
    readonly effectId: string;
    readonly sessionId: string;
    readonly revision: number;
    readonly hand: WinningHand;
    readonly targets: readonly UltimateTarget[];
    readonly pairCleanup: readonly PairCleanupRecord[];
};

export type TerminalState =
    | { readonly outcome: 'Won'; readonly reason: 'board-and-buffer-cleared' }
    | { readonly outcome: 'Lost'; readonly reason: 'full-buffer-stable' }
    | null;

/** 单块规则的输入状态；不含局号、事件或引擎对象。 */
export interface RuleBlock {
    readonly definition: BlockDefinition;
    readonly placement: Placement;
    readonly location: BlockLocation;
    readonly enterOrder: number | null;
}

/** 组完整性由两块的实际位置派生，不能只由 UI 或点击历史猜测。 */
export interface RuleGroup {
    readonly definition: GroupDefinition;
    readonly integrity: GroupIntegrity;
    readonly everBroken: boolean;
}

export interface RulesPosition {
    readonly phase: GamePhase;
    readonly blocks: readonly RuleBlock[];
    readonly groups: readonly RuleGroup[];
    readonly bufferIds: readonly BlockID[];
    readonly melds: readonly MeldRecord[];
    readonly logicalLocks: readonly BlockID[];
}

export interface MeldMatchCandidate {
    readonly kind: MeldKind;
    readonly blockIds: readonly [BlockID, BlockID];
    readonly bufferIndices: readonly [number, number];
    readonly enterOrders: readonly [number, number];
    readonly cards: readonly Card[];
}

export interface TwoSinglesPairCandidate {
    readonly kind: 'pair';
    readonly pairKind: 'twoSingles';
    readonly blockIds: readonly [BlockID, BlockID];
    readonly bufferIndices: readonly [number, number];
    readonly enterOrders: readonly [number, number];
    readonly cards: readonly [Card, Card];
}

export interface DoubleBlockPairCandidate {
    readonly kind: 'pair';
    readonly pairKind: 'doubleBlock';
    readonly blockIds: readonly [BlockID];
    readonly bufferIndices: readonly [number];
    readonly enterOrders: readonly [number];
    readonly cards: readonly [Card, Card];
}

export type MatchCandidate = MeldMatchCandidate | TwoSinglesPairCandidate | DoubleBlockPairCandidate;

export type SelectionProbe =
    | { readonly legal: true }
    | { readonly legal: false; readonly reason: SelectionRejection };

export interface HandStep {
    readonly next: RulesPosition;
    readonly combination: MatchCandidate;
    readonly counted: boolean;
    readonly winningHand: WinningHand | null;
}

const PHASES: readonly GamePhase[] = ['Collecting', 'Tenpai', 'Won', 'Lost'];
const LOCATIONS: readonly BlockLocation[] = ['board', 'buffer', 'meld', 'pair', 'removed'];
const INTEGRITIES: readonly GroupIntegrity[] = ['intact', 'broken', 'removed'];
const MELD_KINDS: readonly MeldKind[] = ['chi', 'peng', 'kong'];

/** 固定关 888 的稳定库存；只含结构性 ID/数量，不复制牌池或布局。 */
const FIXED_BLOCK_IDS: readonly BlockID[] = Array.from(
    { length: 32 },
    (_, index) => 'B' + String(index + 1).padStart(2, '0'),
);
const FIXED_GROUP_IDS: readonly GroupID[] = Array.from(
    { length: 16 },
    (_, index) => 'G' + String(index + 1).padStart(2, '0'),
);
const FIXED_BLOCK_COUNT = 32;
const FIXED_GROUP_COUNT = 16;
const FIXED_TILE_COUNT = 48;
const MAX_COPIES_PER_FACE = 4;

function invariantFailure(message: string): never {
    throw new Error('RulesPosition invariant violated: ' + message);
}

function cardKey(card: Card): string {
    return card.suit + ':' + card.rank;
}

function sortedCardKeys(cards: readonly Card[]): readonly string[] {
    return cards.map(cardKey).sort();
}

/** 由两块实际位置派生组状态；Domain 内部辅助，不属于 §4.2 对 Application 的公共契约。 */
export function deriveGroupState(
    group: RuleGroup,
    blockById: ReadonlyMap<BlockID, RuleBlock>,
): RuleGroup {
    let onBoard = 0;
    for (const blockId of group.definition.blockIds) {
        const block = blockById.get(blockId);
        if (!block) {
            throw new Error(`deriveGroupState: group ${group.definition.id} references missing block ${blockId}`);
        }
        if (block.location === 'board') onBoard++;
    }
    if (onBoard === 2) {
        if (group.everBroken) {
            throw new Error(`deriveGroupState: group ${group.definition.id} is intact but marked everBroken`);
        }
        return { definition: group.definition, integrity: 'intact', everBroken: false };
    }
    if (onBoard === 0) {
        let everBroken = group.everBroken;
        for (const blockId of group.definition.blockIds) {
            const block = blockById.get(blockId);
            if (block && block.enterOrder !== null) everBroken = true;
        }
        return { definition: group.definition, integrity: 'removed', everBroken };
    }
    return { definition: group.definition, integrity: 'broken', everBroken: true };
}

function validateBlockDefinition(block: RuleBlock, path: string): void {
    if (!block || typeof block !== 'object') invariantFailure(`${path} must be an object`);
    const definition = block.definition;
    if (!definition || typeof definition !== 'object') invariantFailure(`${path}.definition must be an object`);
    const placement = block.placement;
    if (!placement || typeof placement !== 'object') invariantFailure(`${path}.placement must be an object`);
    if (!isBlockId(definition.id)) invariantFailure(`${path}.definition.id must match /^B\\d{2}$/`);
    if (!isGroupId(definition.groupId)) invariantFailure(`${path}.definition.groupId must match /^G\\d{2}$/`);
    if (!Array.isArray(definition.cards)) invariantFailure(`${path}.definition.cards must be an array`);
    for (const card of definition.cards) {
        if (!isCard(card)) invariantFailure(`${path}.definition.cards contains an invalid card`);
    }
    if (definition.kind === 'single') {
        if (definition.cards.length !== 1) invariantFailure(`${path} single block must have exactly one card`);
    } else if (definition.kind === 'identicalPair') {
        if (definition.cards.length !== 2 || !cardsEqual(definition.cards[0], definition.cards[1])) {
            invariantFailure(`${path} identicalPair must have two identical cards`);
        }
    } else if (definition.kind === 'sequencePair') {
        if (definition.cards.length !== 2) invariantFailure(`${path} sequencePair must have two cards`);
        if (definition.cards[0].suit !== definition.cards[1].suit) {
            invariantFailure(`${path} sequencePair must use one suit`);
        }
        if (definition.cards[0].rank + 1 !== definition.cards[1].rank) {
            invariantFailure(`${path} sequencePair must be ascending consecutive ranks`);
        }
    } else {
        invariantFailure(`${path} has unknown block kind`);
    }

    if (block.placement.blockId !== definition.id) {
        invariantFailure(`${path}.placement.blockId must equal the block definition id`);
    }
    if (block.placement.layer !== 1 && block.placement.layer !== 2 && block.placement.layer !== 3) {
        invariantFailure(`${path}.placement.layer must be 1, 2 or 3`);
    }
    if (!Array.isArray(block.placement.blockedBy)) {
        invariantFailure(`${path}.placement.blockedBy must be an array`);
    }
}

function validateMeld(
    meld: MeldRecord,
    index: number,
    blockById: ReadonlyMap<BlockID, RuleBlock>,
    meldIds: Set<string>,
    usedBlockIds: Set<BlockID>,
): void {
    const path = `melds[${index}]`;
    if (!meld || typeof meld !== 'object') invariantFailure(`${path} must be an object`);
    if (typeof meld.meldId !== 'string' || meld.meldId.length === 0) {
        invariantFailure(`${path}.meldId must be a non-empty string`);
    }
    if (meldIds.has(meld.meldId)) invariantFailure(`${path}.meldId is duplicated`);
    meldIds.add(meld.meldId);
    if (!MELD_KINDS.includes(meld.kind)) invariantFailure(`${path}.kind is invalid`);
    if (!Array.isArray(meld.blockIds) || meld.blockIds.length !== 2 || meld.blockIds[0] === meld.blockIds[1]) {
        invariantFailure(`${path}.blockIds must contain two distinct ids`);
    }
    for (const blockId of meld.blockIds) {
        if (typeof blockId !== 'string' || blockId.length === 0) {
            invariantFailure(`${path}.blockIds must contain non-empty string ids`);
        }
    }
    if (!Array.isArray(meld.cards)) invariantFailure(`${path}.cards must be an array`);
    for (const card of meld.cards) {
        if (!isCard(card)) invariantFailure(`${path}.cards contains an invalid card`);
    }
    if (!meldCardsMatch(meld.kind, meld.cards)) {
        invariantFailure(`${path} card faces do not form a legal ${meld.kind}`);
    }

    const expectedCards: Card[] = [];
    for (const blockId of meld.blockIds) {
        if (usedBlockIds.has(blockId)) invariantFailure(`${path} reuses block ${blockId} in another meld`);
        usedBlockIds.add(blockId);
        const block = blockById.get(blockId);
        if (!block) invariantFailure(`${path} references missing block ${blockId}`);
        if (block.location !== 'meld') invariantFailure(`${path} block ${blockId} is not located in a meld`);
        for (const card of block.definition.cards) expectedCards.push(card);
    }
    if (sortedCardKeys(expectedCards).join('|') !== sortedCardKeys(meld.cards).join('|')) {
        invariantFailure(`${path}.cards must exactly match the two block card faces`);
    }
}

/** 副牌类型与牌面的权威校验；Domain 内部复用，不复制 Application 类型。 */
export function meldCardsMatch(kind: MeldKind, cards: readonly Card[]): boolean {
    if (!Array.isArray(cards)) return false;
    for (const card of cards) {
        if (!isCard(card)) return false;
    }
    if (kind === 'kong') {
        return cards.length === 4 && cards.every(card => cardsEqual(card, cards[0]));
    }
    if (kind === 'peng') {
        return cards.length === 3 && cards.every(card => cardsEqual(card, cards[0]));
    }
    if (kind === 'chi') {
        if (cards.length !== 3) return false;
        const suit = cards[0].suit;
        if (!cards.every(card => card.suit === suit)) return false;
        const ranks = cards.map(card => card.rank).sort((a, b) => a - b);
        return ranks[0] + 1 === ranks[1] && ranks[1] + 1 === ranks[2];
    }
    return false;
}

/**
 * 固定关 888 的稳定提交点检查。
 * 除结构/去向/终局一致性外，还检查完整库存、双向组成员关系与未结算组合。
 * 非法状态抛出清晰错误，不自动修正。中间模拟或未完成稳定扫描的状态不得调用本函数。
 */
export function assertPositionInvariants(position: RulesPosition): void {
    if (!position || typeof position !== 'object') invariantFailure('position must be an object');
    if (!PHASES.includes(position.phase)) invariantFailure('phase is invalid');
    if (!Array.isArray(position.blocks)) invariantFailure('blocks must be an array');
    if (!Array.isArray(position.groups)) invariantFailure('groups must be an array');
    if (!Array.isArray(position.bufferIds)) invariantFailure('bufferIds must be an array');
    if (!Array.isArray(position.melds)) invariantFailure('melds must be an array');
    if (!Array.isArray(position.logicalLocks)) invariantFailure('logicalLocks must be an array');
    if (position.melds.length > 4) invariantFailure('melds must not exceed four');

    const blockById = new Map<BlockID, RuleBlock>();
    const usedEnterOrders = new Map<number, BlockID>();
    for (let index = 0; index < position.blocks.length; index++) {
        const block = position.blocks[index];
        const path = `blocks[${index}]`;
        validateBlockDefinition(block, path);
        if (blockById.has(block.definition.id)) {
            invariantFailure(`${path} duplicates BlockID ${block.definition.id}`);
        }
        blockById.set(block.definition.id, block);
        if (!LOCATIONS.includes(block.location)) invariantFailure(`${path}.location is invalid`);

        if (block.enterOrder !== null &&
            (typeof block.enterOrder !== 'number' || !Number.isInteger(block.enterOrder) || block.enterOrder < 0)) {
            invariantFailure(`${path}.enterOrder must be null or a non-negative integer`);
        }
        if (block.enterOrder !== null) {
            const previous = usedEnterOrders.get(block.enterOrder);
            if (previous !== undefined) {
                invariantFailure(`${path} reuses enterOrder ${block.enterOrder} from ${previous}`);
            }
            usedEnterOrders.set(block.enterOrder, block.definition.id);
        }
        if (block.location === 'board' && block.enterOrder !== null) {
            invariantFailure(`${path} is on board but already has an enterOrder`);
        }
        if ((block.location === 'buffer' || block.location === 'meld' || block.location === 'pair') &&
            block.enterOrder === null) {
            invariantFailure(`${path} is off board but missing enterOrder`);
        }
    }

    const groupById = new Map<GroupID, RuleGroup>();
    for (let index = 0; index < position.groups.length; index++) {
        const group = position.groups[index];
        const path = `groups[${index}]`;
        if (!group || typeof group !== 'object') invariantFailure(`${path} must be an object`);
        if (!group.definition || typeof group.definition !== 'object') {
            invariantFailure(`${path}.definition must be an object`);
        }
        if (!isGroupId(group.definition.id)) invariantFailure(`${path}.definition.id must match /^G\\d{2}$/`);
        if (groupById.has(group.definition.id)) {
            invariantFailure(`${path} duplicates GroupID ${group.definition.id}`);
        }
        groupById.set(group.definition.id, group);
        if (!Array.isArray(group.definition.blockIds) || group.definition.blockIds.length !== 2 ||
            group.definition.blockIds[0] === group.definition.blockIds[1]) {
            invariantFailure(`${path}.definition.blockIds must contain two distinct ids`);
        }
        for (const blockId of group.definition.blockIds) {
            const block = blockById.get(blockId);
            if (!block) invariantFailure(`${path} references missing block ${blockId}`);
            if (block.definition.groupId !== group.definition.id) {
                invariantFailure(`${path} references block ${blockId} owned by group ${block.definition.groupId}`);
            }
        }
        const firstBlock = blockById.get(group.definition.blockIds[0]);
        const secondBlock = blockById.get(group.definition.blockIds[1]);
        if (firstBlock && secondBlock && firstBlock.placement.layer !== secondBlock.placement.layer) {
            invariantFailure(`${path} blocks must share the same layer`);
        }
        if (!INTEGRITIES.includes(group.integrity)) invariantFailure(`${path}.integrity is invalid`);
        if (typeof group.everBroken !== 'boolean') invariantFailure(`${path}.everBroken must be boolean`);

        let onBoard = 0;
        for (const blockId of group.definition.blockIds) {
            const block = blockById.get(blockId);
            if (block && block.location === 'board') onBoard++;
        }
        if (onBoard === 2 && group.everBroken) {
            invariantFailure(`${path} is intact but marked everBroken`);
        }
        const derived = deriveGroupState(group, blockById);
        if (group.integrity !== derived.integrity) {
            invariantFailure(`${path}.integrity is ${group.integrity}, expected ${derived.integrity}`);
        }
        if (group.everBroken !== derived.everBroken) {
            invariantFailure(`${path}.everBroken is ${String(group.everBroken)}, expected ${String(derived.everBroken)}`);
        }
    }

    for (let index = 0; index < position.blocks.length; index++) {
        const block = position.blocks[index];
        const declaredGroup = groupById.get(block.definition.groupId);
        if (!declaredGroup) {
            invariantFailure(`blocks[${index}] references missing group ${block.definition.groupId}`);
        }
        if (!declaredGroup.definition.blockIds.includes(block.definition.id)) {
            invariantFailure(`blocks[${index}] ${block.definition.id} is not a member of declared group ${block.definition.groupId}`);
        }
        const blockers = new Set<GroupID>();
        for (const blockerId of block.placement.blockedBy) {
            if (!isGroupId(blockerId)) invariantFailure(`blocks[${index}].placement.blockedBy contains an invalid id`);
            if (blockers.has(blockerId)) invariantFailure(`blocks[${index}].placement.blockedBy repeats ${blockerId}`);
            if (!groupById.has(blockerId)) {
                invariantFailure(`blocks[${index}].placement.blockedBy references missing group ${blockerId}`);
            }
            blockers.add(blockerId);
        }
    }

    if (position.blocks.length !== FIXED_BLOCK_COUNT) {
        invariantFailure(`fixed level must contain exactly ${FIXED_BLOCK_COUNT} blocks, found ${position.blocks.length}`);
    }
    if (position.groups.length !== FIXED_GROUP_COUNT) {
        invariantFailure(`fixed level must contain exactly ${FIXED_GROUP_COUNT} groups, found ${position.groups.length}`);
    }
    let totalTiles = 0;
    const faceCounts = new Map<string, number>();
    for (const block of position.blocks) {
        totalTiles += block.definition.cards.length;
        for (const card of block.definition.cards) {
            const key = cardKey(card);
            faceCounts.set(key, (faceCounts.get(key) ?? 0) + 1);
        }
    }
    if (totalTiles !== FIXED_TILE_COUNT) {
        invariantFailure(`fixed level must conserve exactly ${FIXED_TILE_COUNT} tiles, found ${totalTiles}`);
    }
    for (const expected of FIXED_BLOCK_IDS) {
        if (!blockById.has(expected)) invariantFailure(`fixed level is missing BlockID ${expected}`);
    }
    for (const actual of blockById.keys()) {
        if (!FIXED_BLOCK_IDS.includes(actual)) invariantFailure(`fixed level contains unexpected BlockID ${actual}`);
    }
    for (const expected of FIXED_GROUP_IDS) {
        if (!groupById.has(expected)) invariantFailure(`fixed level is missing GroupID ${expected}`);
    }
    for (const actual of groupById.keys()) {
        if (!FIXED_GROUP_IDS.includes(actual)) invariantFailure(`fixed level contains unexpected GroupID ${actual}`);
    }
    for (const [face, count] of faceCounts) {
        if (count > MAX_COPIES_PER_FACE) {
            invariantFailure(`tile face ${face} appears ${count} times, exceeding four`);
        }
    }

    let occupiedSlots = 0;
    let previousEnterOrder = -1;
    const bufferedIds = new Set<BlockID>();
    for (let index = 0; index < position.bufferIds.length; index++) {
        const blockId = position.bufferIds[index];
        if (bufferedIds.has(blockId)) invariantFailure(`bufferIds[${index}] duplicates ${blockId}`);
        bufferedIds.add(blockId);
        const block = blockById.get(blockId);
        if (!block) invariantFailure(`bufferIds[${index}] references missing block ${blockId}`);
        if (block.location !== 'buffer') invariantFailure(`bufferIds[${index}] block ${blockId} is not located in buffer`);
        if (block.enterOrder === null || block.enterOrder <= previousEnterOrder) {
            invariantFailure(`bufferIds[${index}] must follow ascending enterOrder`);
        }
        previousEnterOrder = block.enterOrder;
        occupiedSlots += block.definition.cards.length;
    }
    if (position.bufferIds.length > 7) invariantFailure('buffer must not contain more than seven blocks');
    if (occupiedSlots > 7) invariantFailure(`stable buffer occupies ${occupiedSlots} slots, exceeding seven`);
    for (const block of position.blocks) {
        if (block.location === 'buffer' && !bufferedIds.has(block.definition.id)) {
            invariantFailure(`block ${block.definition.id} is in buffer but missing from bufferIds`);
        }
    }

    const meldIds = new Set<string>();
    const meldBlockIds = new Set<BlockID>();
    for (let index = 0; index < position.melds.length; index++) {
        validateMeld(position.melds[index], index, blockById, meldIds, meldBlockIds);
    }
    for (const block of position.blocks) {
        if (block.location === 'meld' && !meldBlockIds.has(block.definition.id)) {
            invariantFailure(`block ${block.definition.id} is located in meld but not referenced by any meld`);
        }
    }

    const pairBlocks: RuleBlock[] = [];
    for (const block of position.blocks) {
        if (block.location === 'pair') pairBlocks.push(block);
    }
    if (pairBlocks.length !== 0 && pairBlocks.length !== 1 && pairBlocks.length !== 2) {
        invariantFailure('pair location must contain zero, one, or two blocks');
    }
    if (pairBlocks.length === 1) {
        const only = pairBlocks[0];
        if (only.definition.kind !== 'identicalPair' || only.definition.cards.length !== 2) {
            invariantFailure('single-block pair must be an identicalPair with two cards');
        }
        if (!cardsEqual(only.definition.cards[0], only.definition.cards[1])) {
            invariantFailure('single-block pair must contain two identical cards');
        }
    }
    if (pairBlocks.length === 2) {
        const first = pairBlocks[0];
        const second = pairBlocks[1];
        if (first.definition.kind !== 'single' || second.definition.kind !== 'single') {
            invariantFailure('two-block pair must both be single blocks');
        }
        if (!cardsEqual(first.definition.cards[0], second.definition.cards[0])) {
            invariantFailure('two-block pair must have the same card face');
        }
    }
    if ((position.phase === 'Collecting' || position.phase === 'Lost') && pairBlocks.length !== 0) {
        invariantFailure(`phase ${position.phase} must not contain pair blocks`);
    }
    if (pairBlocks.length !== 0 && position.melds.length !== 4) {
        invariantFailure('pair blocks require exactly four melds');
    }

    const lockIds = new Set<BlockID>();
    for (const blockId of position.logicalLocks) {
        if (lockIds.has(blockId)) invariantFailure(`logicalLocks duplicates ${blockId}`);
        lockIds.add(blockId);
        if (!blockById.has(blockId)) invariantFailure(`logicalLocks references missing block ${blockId}`);
    }
    if ((position.phase === 'Won' || position.phase === 'Lost') && position.logicalLocks.length !== 0) {
        invariantFailure(`terminal phase ${position.phase} must not keep logical locks`);
    }

    if (position.phase === 'Collecting' && position.melds.length >= 4) {
        invariantFailure('Collecting phase must have fewer than four melds');
    }
    if (position.phase === 'Tenpai' && position.melds.length !== 4) {
        invariantFailure('Tenpai phase must have exactly four melds');
    }

    // 用非终局 phase 复算候选与终局，避免 Lost/Won 自我确认，并拒绝未稳定扫描的中间态。
    const probe: RulesPosition = {
        phase: position.melds.length === 4 ? 'Tenpai' : 'Collecting',
        blocks: position.blocks,
        groups: position.groups,
        bufferIds: position.bufferIds,
        melds: position.melds,
        logicalLocks: position.logicalLocks,
    };
    if (enumerateCandidates(probe).length !== 0) {
        invariantFailure('stable position still contains an unresolved combination');
    }
    const terminal = evaluateTerminal(probe).terminal;
    if (position.phase === 'Won' && terminal?.outcome !== 'Won') {
        invariantFailure('Won phase does not satisfy the board-and-buffer-cleared terminal condition');
    }
    if (position.phase === 'Lost' && terminal?.outcome !== 'Lost') {
        invariantFailure('Lost phase does not satisfy the full-buffer-stable terminal condition');
    }
    if ((position.phase === 'Collecting' || position.phase === 'Tenpai') && terminal !== null) {
        invariantFailure(`terminal outcome ${terminal.outcome} is reached while phase is ${position.phase}`);
    }
}
