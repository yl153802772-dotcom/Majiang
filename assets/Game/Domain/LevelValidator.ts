/**
 * 固定关静态校验。
 * 只读取配置并返回全部问题，不修改配置、不抛业务异常、不依赖引擎。
 * 空数组是唯一有效结果；发现多个问题时逐条列出。
 */

import { cardsEqual, isCard, isRank, isSuit } from './CardTypes';
import type { Card } from './CardTypes';
import { isBlockId, isGroupId } from './BlockTypes';
import type { BlockDefinition, BlockID, GroupID } from './BlockTypes';
import type { LevelDefinition, LevelIssue } from './LevelDefinition';

/** MVP_FINAL §7.2 的设计画布与显示框尺寸，仅用于越界检查。 */
const DESIGN_WIDTH = 720;
const DESIGN_HEIGHT = 1280;
const SINGLE_WIDTH = 64;
const DOUBLE_WIDTH = 132;
const BLOCK_HEIGHT = 88;

const EXPECTED_BLOCK_IDS: readonly BlockID[] = Array.from(
    { length: 32 },
    (_, index) => 'B' + String(index + 1).padStart(2, '0'),
);
const EXPECTED_GROUP_IDS: readonly GroupID[] = Array.from(
    { length: 16 },
    (_, index) => 'G' + String(index + 1).padStart(2, '0'),
);
const EXPECTED_INITIAL_SELECTABLE: readonly BlockID[] = EXPECTED_BLOCK_IDS.slice(0, 10);

/** 组内容类别；仅由真实牌面推导，不是配置里强制锁定的组合类型。 */
type GroupCategory = 'chi' | 'peng' | 'kong' | 'pair';

function readCards(value: unknown): readonly Card[] | null {
    if (!Array.isArray(value)) return null;
    const cards: Card[] = [];
    for (const card of value) {
        if (!isCard(card)) return null;
        cards.push(card);
    }
    return cards;
}

function classifySingleWithPair(single: Card, first: Card, second: Card): GroupCategory | null {
    if (single.suit !== first.suit || first.suit !== second.suit) return null;
    if (!cardsEqual(first, second)) {
        const ranks = [single.rank, first.rank, second.rank].sort((a, b) => a - b);
        return ranks[0] + 1 === ranks[1] && ranks[1] + 1 === ranks[2] ? 'chi' : null;
    }
    return cardsEqual(single, first) ? 'peng' : null;
}

/** 由两块真实牌面推导组类别；无法构成合法组时返回 null。 */
function classifyGroup(first: BlockDefinition, second: BlockDefinition): GroupCategory | null {
    const a = readCards(first.cards);
    const b = readCards(second.cards);
    if (a === null || b === null) return null;
    if (a.length === 1 && b.length === 2) return classifySingleWithPair(a[0], b[0], b[1]);
    if (a.length === 2 && b.length === 1) return classifySingleWithPair(b[0], a[0], a[1]);
    if (a.length === 2 && b.length === 2) {
        if (!cardsEqual(a[0], a[1]) || !cardsEqual(b[0], b[1])) return null;
        return cardsEqual(a[0], b[0]) ? 'kong' : null;
    }
    if (a.length === 1 && b.length === 1) {
        return cardsEqual(a[0], b[0]) ? 'pair' : null;
    }
    return null;
}

/** 返回 blocking 图中检测到的环（按块 ID 序列），用于诊断。 */
function findBlockingCycles(adjacency: ReadonlyMap<string, readonly string[]>): readonly (readonly string[])[] {
    const state = new Map<string, 0 | 1 | 2>();
    const stack: string[] = [];
    const found: string[][] = [];
    const seen = new Set<string>();

    const visit = (id: string): void => {
        const current = state.get(id) ?? 0;
        if (current === 1) {
            const start = stack.indexOf(id);
            const cycle = stack.slice(start);
            const key = Array.from(new Set(cycle)).sort().join(',');
            if (!seen.has(key)) {
                seen.add(key);
                found.push(cycle);
            }
            return;
        }
        if (current === 2) return;
        state.set(id, 1);
        stack.push(id);
        for (const next of adjacency.get(id) ?? []) visit(next);
        stack.pop();
        state.set(id, 2);
    };

    for (const id of Array.from(adjacency.keys()).sort()) {
        if ((state.get(id) ?? 0) === 0) visit(id);
    }
    return found;
}

/** 校验固定关；返回全部静态问题，不自动修复。 */
export function validateLevel(level: LevelDefinition): readonly LevelIssue[] {
    const issues: LevelIssue[] = [];
    const add = (code: string, path: string, message: string): void => {
        issues.push({ code, path, message });
    };

    if (level.id !== '888') {
        add('level-id', 'id', '固定关 ID 必须为 888。');
    }
    if (typeof level.contentVersion !== 'string' || level.contentVersion.length === 0) {
        add('level-content-version', 'contentVersion', 'contentVersion 必须是非空字符串。');
    } else if (level.id === '888' && !/^888-v\d+$/.test(level.contentVersion)) {
        add('level-content-version', 'contentVersion', '888 关 contentVersion 必须形如 888-v<正整数>。');
    }

    const blocks = Array.isArray(level.blocks) ? level.blocks : [];
    const groups = Array.isArray(level.groups) ? level.groups : [];
    const placements = Array.isArray(level.placements) ? level.placements : [];
    if (!Array.isArray(level.blocks)) add('level-blocks', 'blocks', 'blocks 必须是数组。');
    if (!Array.isArray(level.groups)) add('level-groups', 'groups', 'groups 必须是数组。');
    if (!Array.isArray(level.placements)) add('level-placements', 'placements', 'placements 必须是数组。');

    const blockById = new Map<BlockID, BlockDefinition>();
    const groupById = new Map<GroupID, { readonly id: GroupID; readonly blockIds: readonly BlockID[] }>();
    const cardCounts = new Map<string, number>();
    let totalTileCount = 0;

    for (let index = 0; index < blocks.length; index++) {
        const block = blocks[index];
        const blockPath = `blocks[${index}]`;
        if (!isBlockId(block.id)) {
            add('block-id-format', `${blockPath}.id`, 'BlockID 必须匹配 /^B\\d{2}$/。');
        }
        if (blockById.has(block.id)) {
            add('block-id-duplicate', `${blockPath}.id`, `BlockID ${block.id} 重复。`);
        } else {
            blockById.set(block.id, block);
        }

        if (!isGroupId(block.groupId)) {
            add('block-group-format', `${blockPath}.groupId`, 'GroupID 必须匹配 /^G\\d{2}$/。');
        }

        const cards: readonly unknown[] = Array.isArray(block.cards) ? block.cards : [];
        if (!Array.isArray(block.cards)) {
            add('block-cards', `${blockPath}.cards`, 'cards 必须是数组。');
        }
        totalTileCount += cards.length;
        for (let cardIndex = 0; cardIndex < cards.length; cardIndex++) {
            const card = cards[cardIndex];
            const cardPath = `${blockPath}.cards[${cardIndex}]`;
            if (typeof card !== 'object' || card === null) {
                add('card-shape', cardPath, '牌面必须是对象。');
                continue;
            }
            const candidate = card as { readonly suit?: unknown; readonly rank?: unknown };
            if (!isSuit(candidate.suit)) {
                add('card-suit', `${cardPath}.suit`, '花色必须是 wan/tong/tiao。');
            }
            if (!isRank(candidate.rank)) {
                add('card-rank', `${cardPath}.rank`, '点数必须是 1～9 的整数。');
            }
            if (isCard(card)) {
                const key = card.suit + ':' + card.rank;
                cardCounts.set(key, (cardCounts.get(key) ?? 0) + 1);
            }
        }

        const kind = block.kind;
        if (kind !== 'single' && kind !== 'identicalPair' && kind !== 'sequencePair') {
            add('block-kind', `${blockPath}.kind`, '未知 Block 类型。');
            continue;
        }
        const expectedCount = kind === 'single' ? 1 : 2;
        if (cards.length !== expectedCount) {
            add('block-card-count', `${blockPath}.cards`, `${kind} 必须恰好有 ${expectedCount} 张牌，实际 ${cards.length} 张。`);
        }
        const valid = readCards(block.cards);
        if (kind === 'identicalPair' && valid !== null && valid.length === 2 && !cardsEqual(valid[0], valid[1])) {
            add('block-pair-not-identical', `${blockPath}.cards`, '同牌双块的两张牌必须完全相同。');
        }
        if (kind === 'sequencePair' && valid !== null && valid.length === 2) {
            if (valid[0].suit !== valid[1].suit) {
                add('block-sequence-suit', `${blockPath}.cards`, '顺子双块的两张牌必须同花色。');
            } else if (valid[0].rank + 1 !== valid[1].rank) {
                add('block-sequence-order', `${blockPath}.cards`, '顺子双块必须是 1-2 至 8-9 的升序连续牌。');
            }
        }
    }

    for (let index = 0; index < groups.length; index++) {
        const group = groups[index];
        const groupPath = `groups[${index}]`;
        if (!isGroupId(group.id)) {
            add('group-id-format', `${groupPath}.id`, 'GroupID 必须匹配 /^G\\d{2}$/。');
        }
        if (groupById.has(group.id)) {
            add('group-id-duplicate', `${groupPath}.id`, `GroupID ${group.id} 重复。`);
        } else {
            const blockIds = Array.isArray(group.blockIds) ? group.blockIds : [];
            groupById.set(group.id, { id: group.id, blockIds });
        }

        const blockIds: readonly BlockID[] = Array.isArray(group.blockIds) ? group.blockIds : [];
        if (blockIds.length !== 2) {
            add('group-block-count', `${groupPath}.blockIds`, `每组必须恰有两个 Block，实际 ${blockIds.length} 个。`);
        }
        if (blockIds.length === 2 && blockIds[0] === blockIds[1]) {
            add('group-block-duplicate', `${groupPath}.blockIds`, '同一组不能重复引用同一个 Block。');
        }
        for (let memberIndex = 0; memberIndex < blockIds.length; memberIndex++) {
            const blockId = blockIds[memberIndex];
            const block = blockById.get(blockId);
            if (!block) {
                add('group-block-reference', `${groupPath}.blockIds[${memberIndex}]`, `组引用了不存在的 Block ${String(blockId)}。`);
                continue;
            }
            if (block.groupId !== group.id) {
                add('group-block-owner', `${groupPath}.blockIds[${memberIndex}]`, `Block ${blockId} 的 groupId 是 ${block.groupId}，与组 ${group.id} 不一致。`);
            }
        }
        if (blockIds.length === 2) {
            const first = blockById.get(blockIds[0]);
            const second = blockById.get(blockIds[1]);
            if (first && second && first.id !== second.id) {
                if (classifyGroup(first, second) === null) {
                    add('group-composition', `${groupPath}.blockIds`, '两块牌面不能组成合法的吃/碰/杠/将。');
                }
            }
        }
    }

    for (let index = 0; index < blocks.length; index++) {
        const block = blocks[index];
        if (isGroupId(block.groupId) && !groupById.has(block.groupId)) {
            add('block-group-reference', `blocks[${index}].groupId`, `Block ${block.id} 引用了不存在的组 ${block.groupId}。`);
        }
    }

    const placementByBlock = new Map<BlockID, {
        readonly blockId: BlockID;
        readonly x: number;
        readonly y: number;
        readonly layer: number;
        readonly blockedBy: readonly unknown[];
    }>();

    for (let index = 0; index < placements.length; index++) {
        const placement = placements[index];
        const placementPath = `placements[${index}]`;
        const block = blockById.get(placement.blockId);
        if (!block) {
            add('placement-block-reference', `${placementPath}.blockId`, `摆放引用了不存在的 Block ${String(placement.blockId)}。`);
        }
        if (placementByBlock.has(placement.blockId)) {
            add('placement-duplicate', `${placementPath}.blockId`, `Block ${placement.blockId} 存在重复摆放。`);
        } else {
            placementByBlock.set(placement.blockId, placement);
        }
        if (placement.layer !== 1 && placement.layer !== 2 && placement.layer !== 3) {
            add('placement-layer', `${placementPath}.layer`, 'layer 必须是 1、2 或 3。');
        }
        if (typeof placement.x !== 'number' || !Number.isFinite(placement.x) ||
            typeof placement.y !== 'number' || !Number.isFinite(placement.y)) {
            add('placement-coordinate', `${placementPath}`, '坐标必须是有限数值。');
        } else {
            const cardCount = block && Array.isArray(block.cards) ? block.cards.length : 1;
            const halfWidth = (cardCount === 2 ? DOUBLE_WIDTH : SINGLE_WIDTH) / 2;
            const halfHeight = BLOCK_HEIGHT / 2;
            if (placement.x - halfWidth < 0 || placement.x + halfWidth > DESIGN_WIDTH ||
                placement.y - halfHeight < 0 || placement.y + halfHeight > DESIGN_HEIGHT) {
                add('placement-out-of-bounds', `${placementPath}`, `显示框越出 ${DESIGN_WIDTH}×${DESIGN_HEIGHT} 设计画布。`);
            }
        }

        const blockedBy: readonly unknown[] = Array.isArray(placement.blockedBy) ? placement.blockedBy : [];
        if (!Array.isArray(placement.blockedBy)) {
            add('blocking-shape', `${placementPath}.blockedBy`, 'blockedBy 必须是数组。');
        }
        const seenBlockers = new Set<string>();
        for (let blockerIndex = 0; blockerIndex < blockedBy.length; blockerIndex++) {
            const groupId = blockedBy[blockerIndex];
            const blockerPath = `${placementPath}.blockedBy[${blockerIndex}]`;
            if (!isGroupId(groupId)) {
                add('blocking-format', blockerPath, 'blockedBy 中的 GroupID 必须匹配 /^G\\d{2}$/。');
                continue;
            }
            if (seenBlockers.has(groupId)) {
                add('blocking-duplicate', blockerPath, `blockedBy 重复引用 ${groupId}。`);
            }
            seenBlockers.add(groupId);
            if (!groupById.has(groupId)) {
                add('blocking-reference', blockerPath, `blockedBy 引用了不存在的组 ${groupId}。`);
            }
            if (block && block.groupId === groupId) {
                add('blocking-self', blockerPath, `Block ${block.id} 不能依赖自己所在的组 ${groupId}。`);
            }
        }
    }

    for (let index = 0; index < blocks.length; index++) {
        if (!placementByBlock.has(blocks[index].id)) {
            add('placement-missing', `placements`, `Block ${blocks[index].id} 缺少摆放。`);
        }
    }

    for (let index = 0; index < groups.length; index++) {
        const group = groups[index];
        const blockIds: readonly BlockID[] = Array.isArray(group.blockIds) ? group.blockIds : [];
        if (blockIds.length !== 2) continue;
        const first = placementByBlock.get(blockIds[0]);
        const second = placementByBlock.get(blockIds[1]);
        if (first && second && first.layer !== second.layer) {
            add('group-layer-mismatch', `groups[${index}].blockIds`,
                `同组 Block ${blockIds[0]} 与 ${blockIds[1]} 必须同层，实际 ${first.layer}/${second.layer}。`);
        }
    }

    const adjacency = new Map<string, readonly string[]>();
    for (const [blockId, placement] of placementByBlock) {
        const next: string[] = [];
        const blockedBy: readonly unknown[] = Array.isArray(placement.blockedBy) ? placement.blockedBy : [];
        for (const groupId of blockedBy) {
            if (!isGroupId(groupId)) continue;
            const group = groupById.get(groupId);
            if (!group) continue;
            for (const memberId of group.blockIds) {
                if (typeof memberId === 'string') next.push(memberId);
            }
        }
        adjacency.set(blockId, next);
    }
    for (const cycle of findBlockingCycles(adjacency)) {
        add('blocking-cycle', 'placements', `遮挡图存在环：${cycle.join(' -> ')} -> ${cycle[0]}。`);
    }

    for (const key of Array.from(cardCounts.keys()).sort()) {
        const count = cardCounts.get(key) ?? 0;
        if (count > 4) {
            add('card-count-exceeded', 'blocks', `牌面 ${key} 出现 ${count} 张，超过 4 张上限。`);
        }
    }

    if (level.id === '888') {
        if (blocks.length !== 32) add('level-block-count', 'blocks', `固定关必须有 32 个 Block，实际 ${blocks.length} 个。`);
        if (groups.length !== 16) add('level-group-count', 'groups', `固定关必须有 16 个组，实际 ${groups.length} 个。`);
        if (totalTileCount !== 48) add('level-tile-count', 'blocks', `固定关必须有 48 张牌，实际 ${totalTileCount} 张。`);

        for (const expected of EXPECTED_BLOCK_IDS) {
            if (!blockById.has(expected)) add('block-id-missing', 'blocks', `缺少固定 BlockID ${expected}。`);
        }
        for (const actual of blockById.keys()) {
            if (!EXPECTED_BLOCK_IDS.includes(actual)) add('block-id-unexpected', 'blocks', `出现固定关之外的 BlockID ${actual}。`);
        }
        for (const expected of EXPECTED_GROUP_IDS) {
            if (!groupById.has(expected)) add('group-id-missing', 'groups', `缺少固定 GroupID ${expected}。`);
        }
        for (const actual of groupById.keys()) {
            if (!EXPECTED_GROUP_IDS.includes(actual)) add('group-id-unexpected', 'groups', `出现固定关之外的 GroupID ${actual}。`);
        }

        let meldGroups = 0;
        let kongGroups = 0;
        let pairGroups = 0;
        for (const group of groupById.values()) {
            if (group.blockIds.length !== 2) continue;
            const first = blockById.get(group.blockIds[0]);
            const second = blockById.get(group.blockIds[1]);
            if (!first || !second || first.id === second.id) continue;
            const category = classifyGroup(first, second);
            if (category === 'chi' || category === 'peng') meldGroups++;
            else if (category === 'kong') kongGroups++;
            else if (category === 'pair') pairGroups++;
        }
        if (meldGroups !== 14 || kongGroups !== 1 || pairGroups !== 1) {
            add('group-category-count', 'groups',
                `固定关应为 14 个三张副牌组、1 个杠组、1 个将牌组，实际 ${meldGroups}/${kongGroups}/${pairGroups}。`);
        }

        const selectable = Array.from(new Set(
            Array.from(placementByBlock.values())
                .filter(placement => Array.isArray(placement.blockedBy) && placement.blockedBy.length === 0)
                .map(placement => placement.blockId),
        )).sort();
        if (selectable.join(',') !== EXPECTED_INITIAL_SELECTABLE.join(',')) {
            add('initial-selectable-mismatch', 'placements',
                `初始可点击集合必须是 ${EXPECTED_INITIAL_SELECTABLE.join(',')}，实际 ${selectable.join(',')}。`);
        }
    }

    return issues;
}
