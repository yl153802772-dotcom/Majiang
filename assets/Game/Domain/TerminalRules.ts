/**
 * 七槽容量、虚拟入槽与严格终局。
 * 救槽判断复用 canSelect 与同一配方枚举器，不另写近似算法。
 */

import { canSelect } from './BoardRules';
import { enumerateCandidates } from './CombinationResolver';
import type { BlockID } from './BlockTypes';
import type { RuleBlock, RulesPosition, SelectionProbe, TerminalState } from './GameState';

const BUFFER_CAPACITY = 7;

function blockMapOf(position: RulesPosition): ReadonlyMap<BlockID, RuleBlock> {
    const blockById = new Map<BlockID, RuleBlock>();
    for (const block of position.blocks) blockById.set(block.definition.id, block);
    return blockById;
}

function occupiedSlots(position: RulesPosition, blockById: ReadonlyMap<BlockID, RuleBlock>): number {
    let total = 0;
    for (const blockId of position.bufferIds) {
        const block = blockById.get(blockId);
        if (block) total += block.definition.cards.length;
    }
    return total;
}

function maxEnterOrder(position: RulesPosition): number {
    let maximum = 0;
    for (const block of position.blocks) {
        if (block.enterOrder !== null && block.enterOrder > maximum) maximum = block.enterOrder;
    }
    return maximum;
}

/**
 * 真实/虚拟入槽共用的合法性探针：先通过 canSelect；超过七格时，
 * 只有本次新块自身直接参与合法配方或将牌才获准，旧块之间的组合不能兜底。
 */
export function canVirtualInsert(position: RulesPosition, blockId: BlockID): SelectionProbe {
    const selection = canSelect(position, blockId);
    if (!selection.legal) return selection;

    const blockById = blockMapOf(position);
    const block = blockById.get(blockId);
    if (!block) return { legal: false, reason: 'unknown-block' };
    const occupied = occupiedSlots(position, blockById);
    const addedSlots = block.definition.cards.length;
    if (occupied + addedSlots <= BUFFER_CAPACITY) return { legal: true };

    const simulatedBlock: RuleBlock = {
        definition: block.definition,
        placement: block.placement,
        location: 'buffer',
        enterOrder: maxEnterOrder(position) + 1,
    };
    const simulated: RulesPosition = {
        phase: position.phase,
        blocks: position.blocks.map(entry => entry.definition.id === blockId ? simulatedBlock : entry),
        groups: position.groups,
        bufferIds: Array.from(position.bufferIds).concat(blockId),
        melds: position.melds,
        logicalLocks: position.logicalLocks,
    };
    const participates = enumerateCandidates(simulated)
        .some(candidate => candidate.blockIds[0] === blockId || candidate.blockIds[1] === blockId);
    return participates ? { legal: true } : { legal: false, reason: 'insufficient-space' };
}

/** 纯终局推导：不清理 UI、不等待动画、不修改输入。 */
export function evaluateTerminal(position: RulesPosition): {
    readonly terminal: TerminalState;
    readonly stalled: boolean;
} {
    const blockById = blockMapOf(position);
    const occupied = occupiedSlots(position, blockById);
    const boardBlocks = position.blocks.filter(block => block.location === 'board');

    if (boardBlocks.length === 0 && position.bufferIds.length === 0) {
        return {
            terminal: { outcome: 'Won', reason: 'board-and-buffer-cleared' },
            stalled: false,
        };
    }

    const candidates = enumerateCandidates(position);
    const hasRescue = (): boolean => {
        for (const block of boardBlocks) {
            if (canVirtualInsert(position, block.definition.id).legal) return true;
        }
        return false;
    };

    if (occupied === BUFFER_CAPACITY && candidates.length === 0) {
        // R0.1：稳定满七即失败，不再以桌面仍有可救牌为理由维持非终局。
        return {
            terminal: { outcome: 'Lost', reason: 'full-buffer-stable' },
            stalled: false,
        };
    }

    const stalled = occupied < BUFFER_CAPACITY && candidates.length === 0 && !hasRescue();
    return { terminal: null, stalled };
}
