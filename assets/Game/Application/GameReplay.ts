/**
 * 内存回放：固定局号分配器、逐命令结果与规范化摘要。
 * 不写磁盘、不依赖引擎；任何物理/动画轨迹都不会进入摘要。
 */

import type { GameCommand, RejectReason } from './GameCommand';
import type { GameEvent } from './GameEvent';
import type { GameSnapshot } from './GameSnapshot';
import { GameSession } from './GameSession';
import type { LevelDefinition } from '../Domain/LevelDefinition';
import type { Fan } from '../Domain/GameState';

export interface ReplayInput {
    readonly levelId: string;
    readonly contentVersion: string;
    readonly commands: readonly GameCommand[];
}

export interface ReplayBufferEntry {
    readonly blockId: string;
    readonly startSlot: number;
    readonly slotCount: number;
    readonly cards: readonly string[];
}

export interface ReplayMeldEntry {
    readonly meldId: string;
    readonly kind: string;
    readonly blockIds: readonly string[];
    readonly cards: readonly string[];
}

export interface ReplayGroupEntry {
    readonly groupId: string;
    readonly integrity: string;
    readonly everBroken: boolean;
    readonly remainingBoardBlockIds: readonly string[];
}

export interface ReplaySummary {
    readonly sessionId: string;
    readonly revision: number;
    readonly phase: string;
    readonly boardBlockIds: readonly string[];
    readonly selectableBlockIds: readonly string[];
    readonly buffer: readonly ReplayBufferEntry[];
    readonly occupiedSlots: number;
    readonly melds: readonly ReplayMeldEntry[];
    readonly groups: readonly ReplayGroupEntry[];
    readonly terminal: string | null;
    readonly stalled: boolean;
    readonly totalTileCount: number;
}

export interface ReplayTargetSummary {
    readonly fan: Fan;
    readonly power: number;
    readonly targetGroupIds: readonly string[];
    readonly pairKind: 'twoSingles' | 'doubleBlock';
    readonly pairBlockIds: readonly string[];
    readonly handBlockIds: readonly string[];
    readonly pairCleanupBlockIds: readonly string[];
    readonly pairCleanupTileCount: number;
}

export interface ReplayStep {
    readonly index: number;
    readonly command: GameCommand;
    readonly accepted: boolean;
    readonly reason: RejectReason | null;
    readonly snapshot: ReplaySummary;
    readonly ultimate: ReplayTargetSummary | null;
    readonly eventKinds: readonly GameEvent['kind'][];
}

export interface ReplayResult {
    readonly levelId: string;
    readonly contentVersion: string;
    readonly steps: readonly ReplayStep[];
    readonly final: ReplaySummary;
}

function cardText(card: { readonly suit: string; readonly rank: number }): string {
    return card.suit + ':' + card.rank;
}

function summarize(snapshot: GameSnapshot): ReplaySummary {
    return {
        sessionId: snapshot.sessionId,
        revision: snapshot.revision,
        phase: snapshot.phase,
        boardBlockIds: snapshot.board.map(block => block.definition.id).sort(),
        selectableBlockIds: snapshot.board.filter(block => block.selectable).map(block => block.definition.id).sort(),
        buffer: snapshot.buffer.map(block => ({
            blockId: block.blockId,
            startSlot: block.startSlot,
            slotCount: block.slotCount,
            cards: block.cards.map(cardText),
        })),
        occupiedSlots: snapshot.occupiedSlots,
        melds: snapshot.melds.map(meld => ({
            meldId: meld.meldId,
            kind: meld.kind,
            blockIds: [meld.blockIds[0], meld.blockIds[1]],
            cards: meld.cards.map(cardText),
        })),
        groups: snapshot.groups.map(group => ({
            groupId: group.groupId,
            integrity: group.integrity,
            everBroken: group.everBroken,
            remainingBoardBlockIds: Array.from(group.remainingBoardBlockIds),
        })),
        terminal: snapshot.terminal?.outcome ?? null,
        stalled: snapshot.stalled,
        totalTileCount: snapshot.audit.totalTileCount,
    };
}

function ultimateSummary(events: readonly GameEvent[]): ReplayTargetSummary | null {
    for (const event of events) {
        if (event.kind !== 'ultimate-resolved') continue;
        const pair = event.payload.hand.pair;
        const pairBlockIds = Array.from(pair.blockIds);
        const handBlockIds = event.payload.hand.melds
            .flatMap(meld => Array.from(meld.blockIds))
            .concat(pairBlockIds);
        const pairCleanupBlockIds = event.payload.pairCleanup.map(entry => entry.blockId);
        const pairCleanupTileCount = event.payload.pairCleanup
            .reduce((total, entry) => total + entry.cards.length, 0);
        return {
            fan: event.payload.fan,
            power: event.payload.power,
            targetGroupIds: event.payload.targets.map(target => target.groupId),
            pairKind: pair.pairKind,
            pairBlockIds,
            handBlockIds,
            pairCleanupBlockIds,
            pairCleanupTileCount,
        };
    }
    return null;
}

/** 使用固定 `replay-1`、`replay-2`… 局号执行命令并返回可序列化摘要。 */
export function replay(level: LevelDefinition, input: ReplayInput): ReplayResult {
    if (level.id !== input.levelId) {
        throw new Error('Replay levelId does not match level: ' + input.levelId + '/' + level.id);
    }
    if (level.contentVersion !== input.contentVersion) {
        throw new Error('Replay contentVersion does not match level: ' + input.contentVersion + '/' + level.contentVersion);
    }
    let sequence = 0;
    const session = new GameSession({
        level,
        nextSessionId: () => 'replay-' + (++sequence),
    });
    try {
        const steps: ReplayStep[] = [];
        for (let index = 0; index < input.commands.length; index++) {
            const command = input.commands[index];
            const result = session.dispatch(command);
            const snapshot = result.accepted ? result.snapshot : session.getSnapshot();
            steps.push({
                index,
                command,
                accepted: result.accepted,
                reason: result.accepted ? null : result.reason,
                snapshot: summarize(snapshot),
                ultimate: result.accepted ? ultimateSummary(result.events) : null,
                eventKinds: result.accepted ? result.events.map(event => event.kind) : [],
            });
        }
        return {
            levelId: level.id,
            contentVersion: level.contentVersion,
            steps,
            final: summarize(session.getSnapshot()),
        };
    } finally {
        session.dispose();
    }
}
