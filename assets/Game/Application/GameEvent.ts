/**
 * 已提交事实事件。事件只描述规则事务结果，不含 Node、Vec3 或回调。
 * 与 MVP_V2_CONTRACTS.md §4.1 对齐。
 */

import type { BlockID } from '../Domain/BlockTypes';
import type { Placement } from '../Domain/LevelDefinition';
import type {
    GamePhase,
    MeldRecord,
    TerminalState,
    UltimateSnapshot,
} from '../Domain/GameState';

export interface GameEventPayloads {
    readonly 'block-selected': {
        readonly blockId: BlockID;
        readonly from: Placement;
        readonly finalRegion: 'buffer' | 'meld' | 'removed';
        readonly virtualInsert: boolean;
    };
    readonly 'combination-resolved': {
        readonly meld: MeldRecord;
        readonly counted: boolean;
    };
    readonly 'phase-changed': {
        readonly from: GamePhase;
        readonly to: GamePhase;
    };
    readonly 'ultimate-resolved': UltimateSnapshot;
    readonly 'board-unlocked': {
        readonly newlySelectable: readonly BlockID[];
    };
    readonly 'session-ended': NonNullable<TerminalState>;
    readonly 'session-restarted': {
        readonly oldSessionId: string;
        readonly newSessionId: string;
    };
}

export type GameEvent = {
    [K in keyof GameEventPayloads]: {
        readonly sessionId: string;
        readonly revision: number;
        readonly eventId: string;
        readonly kind: K;
        readonly payload: GameEventPayloads[K];
    };
}[keyof GameEventPayloads];
