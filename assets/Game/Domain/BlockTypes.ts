/**
 * Block（桌面牌块）类型。
 * MVP_FINAL §3.2：单块 1 张、同牌双块 2 张相同、顺子双块 2 张同花色连续牌。
 * 双块整体不可拆分，占据连续 2 格。
 */

import type { Card } from './CardTypes';

/** 牌块 ID，格式 /^B\d{2}$/；固定关校验精确 B01～B32。 */
export type BlockID = string;

/** 组 ID，格式 /^G\d{2}$/；固定关校验精确 G01～G16。 */
export type GroupID = string;

/** 单块：恰好 1 张牌。 */
export interface SingleBlockDefinition {
    readonly id: BlockID;
    readonly groupId: GroupID;
    readonly kind: 'single';
    readonly cards: readonly [Card];
}

/** 双块：同牌双块或顺子双块，恰好 2 张牌。 */
export interface PairBlockDefinition {
    readonly id: BlockID;
    readonly groupId: GroupID;
    readonly kind: 'identicalPair' | 'sequencePair';
    readonly cards: readonly [Card, Card];
}

/** 桌面牌块定义；不含坐标、层级或任何表现字段。 */
export type BlockDefinition = SingleBlockDefinition | PairBlockDefinition;

/** 牌块种类。 */
export type BlockKind = BlockDefinition['kind'];

/** 双块占 2 格，单块占 1 格。 */
export function getBlockCardCount(block: BlockDefinition): 1 | 2 {
    return block.kind === 'single' ? 1 : 2;
}

/** 运行时判定 BlockID 格式。 */
export function isBlockId(value: unknown): value is BlockID {
    return typeof value === 'string' && /^B\d{2}$/.test(value);
}

/** 运行时判定 GroupID 格式。 */
export function isGroupId(value: unknown): value is GroupID {
    return typeof value === 'string' && /^G\d{2}$/.test(value);
}
