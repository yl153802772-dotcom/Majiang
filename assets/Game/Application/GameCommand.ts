/** 输入命令与拒绝原因。属于 Application，不依赖引擎。 */

import type { BlockID } from '../Domain/BlockTypes';
import type { SelectionRejection } from '../Domain/GameState';

export type GameCommand =
    | { readonly kind: 'select'; readonly sessionId: string; readonly blockId: BlockID }
    | { readonly kind: 'restart'; readonly sessionId: string };

export type RejectReason = SelectionRejection | 'stale-session' | 'busy';
