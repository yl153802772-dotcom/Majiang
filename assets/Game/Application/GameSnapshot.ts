/**
 * 对外只读快照 DTO 类型。属于 Application，不反向暴露 Domain 内部可变状态。
 * 与 MVP_V2_CONTRACTS.md §4.1 对齐。
 */

import type { Card } from '../Domain/CardTypes';
import type { BlockDefinition, BlockID, GroupID } from '../Domain/BlockTypes';
import type { Placement } from '../Domain/LevelDefinition';
import type {
    GamePhase,
    GroupIntegrity,
    MeldRecord,
    TerminalState,
} from '../Domain/GameState';

export interface BoardBlockSnapshot {
    readonly definition: BlockDefinition;
    readonly placement: Placement;
    readonly selectable: boolean;
    readonly disabledReason: 'blocked' | 'locked' | 'terminal' | null;
    readonly highlight: 'none' | 'normal' | 'tenpai-match' | 'winning-pair';
}

export interface BufferBlockSnapshot {
    readonly blockId: BlockID;
    readonly cards: readonly Card[];
    readonly startSlot: number;
    readonly slotCount: 1 | 2;
}

export interface GroupSnapshot {
    readonly groupId: GroupID;
    readonly integrity: GroupIntegrity;
    readonly everBroken: boolean;
    readonly remainingBoardBlockIds: readonly BlockID[];
}

export interface BlockAudit {
    readonly blockId: BlockID;
    readonly location: 'board' | 'buffer' | 'meld' | 'pair' | 'removed';
    readonly enterOrder: number | null;
}

export interface GameSnapshot {
    readonly sessionId: string;
    readonly revision: number;
    readonly levelId: '888';
    readonly contentVersion: string;
    readonly phase: GamePhase;
    readonly board: readonly BoardBlockSnapshot[];
    readonly buffer: readonly BufferBlockSnapshot[];
    readonly occupiedSlots: number;
    readonly melds: readonly MeldRecord[];
    readonly groups: readonly GroupSnapshot[];
    readonly terminal: TerminalState;
    readonly stalled: boolean;
    readonly audit: {
        readonly totalTileCount: number;
        readonly blocks: readonly BlockAudit[];
    };
}
