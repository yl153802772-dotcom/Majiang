/**
 * 桌面可选性规则。
 * 输入遮挡只以显式 blockedBy 图判定，不使用坐标重叠、视觉或物理结果。
 */

import type { BlockID, GroupID } from './BlockTypes';
import type { RuleBlock, RulesPosition, SelectionProbe } from './GameState';

function blockMapOf(position: RulesPosition): ReadonlyMap<BlockID, RuleBlock> {
    const blockById = new Map<BlockID, RuleBlock>();
    for (const block of position.blocks) blockById.set(block.definition.id, block);
    return blockById;
}

/** 阻挡组的两块都离开桌面才算移除；缺组/缺块按未满足处理。 */
function isGroupRemoved(
    position: RulesPosition,
    groupId: GroupID,
    blockById: ReadonlyMap<BlockID, RuleBlock>,
): boolean {
    const group = position.groups.find(entry => entry.definition.id === groupId);
    if (!group) return false;
    for (const blockId of group.definition.blockIds) {
        const block = blockById.get(blockId);
        if (!block || block.location === 'board') return false;
    }
    return true;
}

/** 终局/未知块/不在桌面/被遮挡/逻辑锁定均拒绝；不提交任何状态。 */
export function canSelect(position: RulesPosition, blockId: BlockID): SelectionProbe {
    if (position.phase === 'Won' || position.phase === 'Lost') {
        return { legal: false, reason: 'terminal' };
    }
    const blockById = blockMapOf(position);
    const block = blockById.get(blockId);
    if (!block) return { legal: false, reason: 'unknown-block' };
    if (block.location !== 'board') return { legal: false, reason: 'not-on-board' };
    for (const groupId of block.placement.blockedBy) {
        if (!isGroupRemoved(position, groupId, blockById)) {
            return { legal: false, reason: 'blocked' };
        }
    }
    if (position.logicalLocks.includes(blockId)) return { legal: false, reason: 'locked' };
    return { legal: true };
}
