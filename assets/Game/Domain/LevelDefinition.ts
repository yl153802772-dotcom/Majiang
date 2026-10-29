/**
 * 固定关静态数据结构。
 * 坐标单位：设计像素；原点为 720×1280 画布左上角，X 向右、Y 向下；
 * 坐标表示 Block 显示框中心。输入遮挡以 blockedBy 图为唯一准则。
 */

import type { BlockDefinition, BlockID, GroupID } from './BlockTypes';

/** 逻辑层级：1 为最深层，3 为最上层。 */
export type BlockLayer = 1 | 2 | 3;

/** 单个 Block 的静态摆放与输入遮挡关系。 */
export interface Placement {
    readonly blockId: BlockID;
    readonly x: number;
    readonly y: number;
    readonly layer: BlockLayer;
    readonly blockedBy: readonly GroupID[];
}

/** 固定组：恰有两个 Block，同层。 */
export interface GroupDefinition {
    readonly id: GroupID;
    readonly blockIds: readonly [BlockID, BlockID];
}

/** 唯一固定关数据。 */
export interface LevelDefinition {
    readonly id: '888';
    readonly contentVersion: string;
    readonly blocks: readonly BlockDefinition[];
    readonly groups: readonly GroupDefinition[];
    readonly placements: readonly Placement[];
}

/** 静态校验问题；空数组才表示配置有效。 */
export interface LevelIssue {
    readonly code: string;
    readonly path: string;
    readonly message: string;
}
