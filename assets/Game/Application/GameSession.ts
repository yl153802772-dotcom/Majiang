/**
 * 唯一局状态写入者。一次命令一次同步事务；提交前失败不改变状态和 revision。
 * 仅依赖 Domain，不依赖 cc、Framework、Presentation、随机、网络或存储。
 */

import { cardsEqual } from '../Domain/CardTypes';
import type { Card } from '../Domain/CardTypes';
import type { BlockDefinition, BlockID } from '../Domain/BlockTypes';
import type { LevelDefinition, Placement } from '../Domain/LevelDefinition';
import { assertPositionInvariants, deriveGroupState } from '../Domain/GameState';
import type {
    GamePhase,
    MatchCandidate,
    MeldRecord,
    PairCleanupRecord,
    RulesPosition,
    TerminalState,
    UltimateSnapshot,
    UltimateTarget,
    WinningHand,
} from '../Domain/GameState';
import { chooseCandidate } from '../Domain/CombinationResolver';
import { applyCombination, selectPairCleanupTargets } from '../Domain/HandResolver';
import { canSelect } from '../Domain/BoardRules';
import { canVirtualInsert, evaluateTerminal } from '../Domain/TerminalRules';
import { calculateFan, selectUltimateTargets } from '../Domain/UltimateResolver';
import { validateLevel } from '../Domain/LevelValidator';
import type { GameCommand, RejectReason } from './GameCommand';
import type { GameEvent } from './GameEvent';
import type {
    BoardBlockSnapshot,
    BufferBlockSnapshot,
    GameSnapshot,
    GroupSnapshot,
} from './GameSnapshot';

export interface SessionOptions {
    readonly level: LevelDefinition;
    readonly nextSessionId: () => string;
    readonly onSubscriberError?: (error: unknown) => void;
}

export interface AcceptedCommand {
    readonly accepted: true;
    readonly snapshot: GameSnapshot;
    readonly events: readonly GameEvent[];
}

export interface RejectedCommand {
    readonly accepted: false;
    readonly reason: RejectReason;
    readonly sessionId: string;
    readonly revision: number;
}

export type CommandResult = AcceptedCommand | RejectedCommand;

type PayloadOf<K extends GameEvent['kind']> = Extract<GameEvent, { readonly kind: K }>['payload'];

const BUFFER_CAPACITY = 7;

function deepFreeze<T>(value: T): T {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.freeze(value);
        for (const child of Object.values(value)) deepFreeze(child);
    }
    return value;
}

function copyCard(card: Card): Card {
    return { suit: card.suit, rank: card.rank };
}

function copyDefinition(definition: BlockDefinition): BlockDefinition {
    if (definition.kind === 'single') {
        return {
            id: definition.id,
            groupId: definition.groupId,
            kind: 'single',
            cards: [copyCard(definition.cards[0])],
        };
    }
    return {
        id: definition.id,
        groupId: definition.groupId,
        kind: definition.kind,
        cards: [copyCard(definition.cards[0]), copyCard(definition.cards[1])],
    };
}

function copyPlacement(placement: Placement): Placement {
    return {
        blockId: placement.blockId,
        x: placement.x,
        y: placement.y,
        layer: placement.layer,
        blockedBy: Array.from(placement.blockedBy),
    };
}

function copyMeld(meld: MeldRecord): MeldRecord {
    return {
        meldId: meld.meldId,
        kind: meld.kind,
        blockIds: [meld.blockIds[0], meld.blockIds[1]],
        cards: Array.from(meld.cards, copyCard),
    };
}

function copyHand(hand: WinningHand): WinningHand {
    const melds = hand.melds.map(copyMeld);
    return {
        melds: [melds[0], melds[1], melds[2], melds[3]],
        pair: hand.pair.pairKind === 'doubleBlock'
            ? {
                pairKind: 'doubleBlock',
                blockIds: [hand.pair.blockIds[0]],
                cards: [copyCard(hand.pair.cards[0]), copyCard(hand.pair.cards[1])],
            }
            : {
                pairKind: 'twoSingles',
                blockIds: [hand.pair.blockIds[0], hand.pair.blockIds[1]],
                cards: [copyCard(hand.pair.cards[0]), copyCard(hand.pair.cards[1])],
            },
    };
}

function copyTarget(target: UltimateTarget): UltimateTarget {
    return {
        groupId: target.groupId,
        layer: target.layer,
        blocks: [
            { definition: copyDefinition(target.blocks[0].definition), placement: copyPlacement(target.blocks[0].placement) },
            { definition: copyDefinition(target.blocks[1].definition), placement: copyPlacement(target.blocks[1].placement) },
        ],
    };
}

function copyPairCleanup(entry: PairCleanupRecord): PairCleanupRecord {
    return {
        sourceGroupId: entry.sourceGroupId,
        blockId: entry.blockId,
        previousLocation: entry.previousLocation,
        cards: Array.from(entry.cards, copyCard),
    };
}

function copyTerminal(terminal: NonNullable<TerminalState>): NonNullable<TerminalState> {
    return { ...terminal };
}

function cloneLevel(level: LevelDefinition): LevelDefinition {
    return {
        id: level.id,
        contentVersion: level.contentVersion,
        blocks: level.blocks.map(copyDefinition),
        groups: level.groups.map(group => ({
            id: group.id,
            blockIds: [group.blockIds[0], group.blockIds[1]],
        })),
        placements: level.placements.map(copyPlacement),
    };
}

function createInitialPosition(level: LevelDefinition): RulesPosition {
    const placementByBlock = new Map<string, Placement>();
    for (const placement of level.placements) placementByBlock.set(placement.blockId, placement);
    return {
        phase: 'Collecting',
        blocks: level.blocks.map(definition => {
            const placement = placementByBlock.get(definition.id);
            if (!placement) throw new Error(`Level is missing placement for ${definition.id}`);
            return {
                definition,
                placement,
                location: 'board',
                enterOrder: null,
            };
        }),
        groups: level.groups.map(group => ({
            definition: group,
            integrity: 'intact',
            everBroken: false,
        })),
        bufferIds: [],
        melds: [],
        logicalLocks: [],
    };
}

function occupiedSlots(position: RulesPosition): number {
    const blockById = new Map(position.blocks.map(block => [block.definition.id, block]));
    let total = 0;
    for (const blockId of position.bufferIds) total += blockById.get(blockId)?.definition.cards.length ?? 0;
    return total;
}

function maxEnterOrder(position: RulesPosition): number {
    let maximum = 0;
    for (const block of position.blocks) {
        if (block.enterOrder !== null && block.enterOrder > maximum) maximum = block.enterOrder;
    }
    return maximum;
}

function recomputeGroups(position: RulesPosition): RulesPosition {
    const blockById = new Map(position.blocks.map(block => [block.definition.id, block]));
    return {
        ...position,
        groups: position.groups.map(group => deriveGroupState(group, blockById)),
    };
}

function beginSelect(position: RulesPosition, blockId: BlockID): RulesPosition {
    const enterOrder = maxEnterOrder(position) + 1;
    const blocks = position.blocks.map(block => block.definition.id === blockId
        ? { ...block, location: 'buffer' as const, enterOrder }
        : block);
    return recomputeGroups({
        ...position,
        blocks,
        bufferIds: Array.from(position.bufferIds).concat(blockId),
    });
}

function removeMeldAndPairBlocks(position: RulesPosition): RulesPosition {
    const blocks = position.blocks.map(block => (
        block.location === 'meld' || block.location === 'pair'
            ? { ...block, location: 'removed' as const }
            : block
    ));
    return recomputeGroups({ ...position, blocks, melds: [] });
}

function removeTargets(position: RulesPosition, targets: readonly UltimateTarget[]): RulesPosition {
    const targetIds = new Set<BlockID>();
    for (const target of targets) {
        targetIds.add(target.blocks[0].definition.id);
        targetIds.add(target.blocks[1].definition.id);
    }
    const blocks = position.blocks.map(block => targetIds.has(block.definition.id)
        ? { ...block, location: 'removed' as const, enterOrder: null }
        : block);
    return recomputeGroups({ ...position, blocks });
}

function removePairCleanupBlocks(
    position: RulesPosition,
    cleanup: readonly PairCleanupRecord[],
): RulesPosition {
    if (cleanup.length === 0) return position;
    const cleanupIds = new Set<BlockID>(cleanup.map(entry => entry.blockId));
    const blocks = position.blocks.map(block => cleanupIds.has(block.definition.id)
        ? { ...block, location: 'removed' as const, enterOrder: null }
        : block);
    const bufferIds = position.bufferIds.filter(blockId => !cleanupIds.has(blockId));
    return recomputeGroups({ ...position, blocks, bufferIds });
}

function isCleared(position: RulesPosition): boolean {
    return position.bufferIds.length === 0 && position.blocks.every(block => block.location !== 'board');
}

function transientMeld(candidate: MatchCandidate, tag: string): MeldRecord {
    if (candidate.kind === 'pair') throw new Error('Pair is not a meld');
    return {
        meldId: tag,
        kind: candidate.kind,
        blockIds: [candidate.blockIds[0], candidate.blockIds[1]],
        cards: Array.from(candidate.cards, copyCard),
    };
}

function eventDisabledReason(position: RulesPosition, blockId: BlockID): 'blocked' | 'locked' | 'terminal' | null {
    const probe = canSelect(position, blockId);
    if (probe.legal) return null;
    if (probe.reason === 'blocked' || probe.reason === 'locked' || probe.reason === 'terminal') return probe.reason;
    return 'blocked';
}

/** 游戏会话；构造参数见 SessionOptions。 */
export class GameSession {
    private readonly level: LevelDefinition;
    private readonly nextSessionId: () => string;
    private readonly onSubscriberError?: (error: unknown) => void;
    private readonly listeners = new Set<(result: AcceptedCommand) => void>();
    private sessionId: string;
    private revision = 0;
    private position: RulesPosition;
    private snapshot: GameSnapshot;
    private busy = false;
    private disposed = false;
    private effectSequence = 0;

    constructor(options: SessionOptions) {
        if (!options || typeof options !== 'object') throw new Error('GameSession requires options');
        if (typeof options.nextSessionId !== 'function') throw new Error('GameSession requires nextSessionId');
        const issues = validateLevel(options.level);
        if (issues.length > 0) {
            throw new Error('Invalid level: ' + issues.map(issue => issue.code + '@' + issue.path).join(', '));
        }
        this.level = deepFreeze(cloneLevel(options.level));
        this.nextSessionId = options.nextSessionId;
        this.onSubscriberError = options.onSubscriberError;
        this.sessionId = this.allocateSessionId('');
        this.position = createInitialPosition(this.level);
        assertPositionInvariants(this.position);
        this.snapshot = this.buildSnapshot(this.position, this.sessionId, 0);
    }

    getSnapshot(): GameSnapshot {
        return this.snapshot;
    }

    subscribe(listener: (result: AcceptedCommand) => void): () => void {
        if (this.disposed) throw new Error('GameSession is disposed');
        if (typeof listener !== 'function') throw new Error('Subscriber must be a function');
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    }

    dispatch(command: GameCommand): CommandResult {
        if (this.disposed) throw new Error('GameSession is disposed');
        if (this.busy) return this.reject('busy');
        if (!command || typeof command !== 'object' || command.sessionId !== this.sessionId) {
            return this.reject('stale-session');
        }
        this.busy = true;
        try {
            if (command.kind === 'restart') return this.restart(command.sessionId);
            if (command.kind === 'select') return this.select(command.blockId);
            throw new Error('Unknown GameCommand kind');
        } finally {
            this.busy = false;
        }
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.listeners.clear();
    }

    private reject(reason: RejectReason): RejectedCommand {
        return {
            accepted: false,
            reason,
            sessionId: this.sessionId,
            revision: this.revision,
        };
    }

    private allocateSessionId(previous: string): string {
        const next = this.nextSessionId();
        if (typeof next !== 'string' || next.length === 0) {
            throw new Error('nextSessionId must return a non-empty string');
        }
        if (next === previous) throw new Error('nextSessionId must not reuse a session id');
        return next;
    }

    private restart(oldSessionId: string): CommandResult {
        const nextSessionId = this.allocateSessionId(oldSessionId);
        const position = createInitialPosition(this.level);
        assertPositionInvariants(position);
        const snapshot = this.buildSnapshot(position, nextSessionId, 0);
        const event = {
            sessionId: nextSessionId,
            revision: 0,
            eventId: nextSessionId + ':0:1',
            kind: 'session-restarted',
            payload: { oldSessionId, newSessionId: nextSessionId },
        } as GameEvent;
        const result = deepFreeze<AcceptedCommand>({
            accepted: true,
            snapshot,
            events: [event],
        });
        this.sessionId = nextSessionId;
        this.revision = 0;
        this.position = position;
        this.snapshot = snapshot;
        this.effectSequence = 0;
        this.notify(result);
        return result;
    }

    private select(blockId: BlockID): CommandResult {
        const probe = canVirtualInsert(this.position, blockId);
        if (!probe.legal) return this.reject(probe.reason);

        const selected = this.position.blocks.find(block => block.definition.id === blockId);
        if (!selected) throw new Error('Selected block is missing from position');
        const nextRevision = this.revision + 1;
        const virtualInsert = occupiedSlots(this.position) + selected.definition.cards.length > BUFFER_CAPACITY;
        const from = copyPlacement(selected.placement);
        const beforeSelectable = this.selectableBoardIds(this.position);
        const events: GameEvent[] = [];
        let eventSequence = 1;
        const pushEvent = <K extends GameEvent['kind']>(kind: K, payload: PayloadOf<K>): void => {
            eventSequence++;
            events.push({
                sessionId: this.sessionId,
                revision: nextRevision,
                eventId: this.sessionId + ':' + nextRevision + ':' + eventSequence,
                kind,
                payload,
            } as GameEvent);
        };

        let currentPhase: GamePhase = this.position.phase;
        const notePhase = (next: GamePhase): void => {
            if (next === currentPhase) return;
            const previous = currentPhase;
            currentPhase = next;
            pushEvent('phase-changed', { from: previous, to: next });
        };

        let working = beginSelect(this.position, blockId);
        let pendingNewBlock: BlockID | null = blockId;
        let effectSequence = this.effectSequence;

        while (working.phase !== 'Won' && working.phase !== 'Lost') {
            const candidate = chooseCandidate(working, pendingNewBlock);
            pendingNewBlock = null;
            if (!candidate) break;
            const step = applyCombination(working, candidate);
            if (candidate.kind !== 'pair') {
                const meld = step.counted
                    ? step.next.melds[step.next.melds.length - 1]
                    : transientMeld(candidate, 'TX-' + nextRevision + '-' + events.length);
                pushEvent('combination-resolved', { meld: copyMeld(meld), counted: step.counted });
            }
            working = step.next;
            notePhase(working.phase);

            if (step.winningHand) {
                const fan = calculateFan(step.winningHand);
                const targets = selectUltimateTargets(working, fan.power);
                const pairCleanup = selectPairCleanupTargets(working, step.winningHand.pair);
                effectSequence++;
                const effectId = 'fx-' + this.sessionId + '-' + effectSequence;
                const ultimate = this.makeUltimateSnapshot(
                    fan.fan,
                    fan.power,
                    effectId,
                    step.winningHand,
                    targets,
                    pairCleanup,
                    nextRevision,
                );
                working = removeTargets(working, targets);
                working = removeMeldAndPairBlocks(working);
                working = removePairCleanupBlocks(working, pairCleanup);
                const nextPhase: GamePhase = isCleared(working) ? 'Won' : 'Collecting';
                working = { ...working, phase: nextPhase, logicalLocks: [] };
                notePhase(nextPhase);
                pushEvent('ultimate-resolved', ultimate);
            }
        }

        const evaluation = evaluateTerminal(working);
        if (evaluation.terminal?.outcome === 'Won') {
            working = removeMeldAndPairBlocks(working);
            working = { ...working, phase: 'Won', logicalLocks: [] };
            notePhase('Won');
        } else if (evaluation.terminal?.outcome === 'Lost') {
            working = { ...working, phase: 'Lost' };
            notePhase('Lost');
        }

        const afterSelectable = this.selectableBoardIds(working);
        const newlySelectable = Array.from(afterSelectable)
            .filter(id => !beforeSelectable.has(id))
            .sort();
        if (newlySelectable.length > 0) {
            pushEvent('board-unlocked', { newlySelectable });
        }
        const terminal = evaluateTerminal(working).terminal;
        if (terminal) pushEvent('session-ended', copyTerminal(terminal));

        const finalLocation = working.blocks.find(block => block.definition.id === blockId)?.location;
        const finalRegion = finalLocation === 'buffer' ? 'buffer' : finalLocation === 'meld' ? 'meld' : 'removed';
        events.unshift({
            sessionId: this.sessionId,
            revision: nextRevision,
            eventId: this.sessionId + ':' + nextRevision + ':1',
            kind: 'block-selected',
            payload: { blockId, from, finalRegion, virtualInsert },
        } as GameEvent);

        assertPositionInvariants(working);
        const snapshot = this.buildSnapshot(working, this.sessionId, nextRevision);
        const result = deepFreeze<AcceptedCommand>({
            accepted: true,
            snapshot,
            events,
        });

        this.position = working;
        this.revision = nextRevision;
        this.snapshot = snapshot;
        this.effectSequence = effectSequence;
        this.notify(result);
        return result;
    }

    private selectableBoardIds(position: RulesPosition): Set<BlockID> {
        const ids = new Set<BlockID>();
        for (const block of position.blocks) {
            if (block.location === 'board' && canSelect(position, block.definition.id).legal) {
                ids.add(block.definition.id);
            }
        }
        return ids;
    }

    private makeUltimateSnapshot(
        fan: 'qingyise' | 'pengpenghu' | 'pinghu',
        power: 5 | 2 | 1,
        effectId: string,
        hand: WinningHand,
        targets: readonly UltimateTarget[],
        pairCleanup: readonly PairCleanupRecord[],
        revision: number,
    ): UltimateSnapshot {
        const base = {
            effectId,
            sessionId: this.sessionId,
            revision,
            hand: copyHand(hand),
            targets: targets.map(copyTarget),
            pairCleanup: pairCleanup.map(copyPairCleanup),
        };
        if (fan === 'qingyise') return { ...base, fan: 'qingyise', power: 5 };
        if (fan === 'pengpenghu') return { ...base, fan: 'pengpenghu', power: 2 };
        return { ...base, fan: 'pinghu', power: 1 };
    }

    private buildSnapshot(position: RulesPosition, sessionId: string, revision: number): GameSnapshot {
        const blockById = new Map(position.blocks.map(block => [block.definition.id, block]));
        const boardBlockIds = new Set(position.blocks.filter(block => block.location === 'board').map(block => block.definition.id));
        const bufferSingles = position.bufferIds
            .map(id => blockById.get(id))
            .filter(block => block !== undefined && block.definition.kind === 'single');

        const board: BoardBlockSnapshot[] = position.blocks
            .filter(block => block.location === 'board')
            .sort((a, b) => a.definition.id < b.definition.id ? -1 : a.definition.id > b.definition.id ? 1 : 0)
            .map(block => {
                const selectable = canSelect(position, block.definition.id).legal;
                let highlight: BoardBlockSnapshot['highlight'] = 'none';
                if (selectable) {
                    const single = block.definition.kind === 'single';
                    const tenpaiMatch = position.phase === 'Tenpai' && single && bufferSingles.some(bufferBlock =>
                        bufferBlock !== undefined && bufferBlock.definition.kind === 'single' &&
                        cardsEqual(bufferBlock.definition.cards[0], block.definition.cards[0]));
                    const winningPair = position.phase === 'Tenpai' && block.definition.kind === 'identicalPair';
                    highlight = winningPair ? 'winning-pair' : tenpaiMatch ? 'tenpai-match' : 'normal';
                }
                return {
                    definition: copyDefinition(block.definition),
                    placement: copyPlacement(block.placement),
                    selectable,
                    disabledReason: eventDisabledReason(position, block.definition.id),
                    highlight,
                };
            });

        const buffer: BufferBlockSnapshot[] = [];
        let startSlot = 0;
        for (const blockId of position.bufferIds) {
            const block = blockById.get(blockId);
            if (!block) throw new Error('Snapshot buffer references missing block ' + blockId);
            const slotCount = block.definition.cards.length === 2 ? 2 : 1;
            buffer.push({
                blockId,
                cards: Array.from(block.definition.cards, copyCard),
                startSlot,
                slotCount,
            });
            startSlot += slotCount;
        }

        const groups: GroupSnapshot[] = position.groups
            .slice()
            .sort((a, b) => a.definition.id < b.definition.id ? -1 : a.definition.id > b.definition.id ? 1 : 0)
            .map(group => ({
                groupId: group.definition.id,
                integrity: group.integrity,
                everBroken: group.everBroken,
                remainingBoardBlockIds: group.definition.blockIds
                    .filter(id => boardBlockIds.has(id))
                    .sort(),
            }));

        const evaluation = evaluateTerminal(position);
        const auditBlocks = position.blocks
            .slice()
            .sort((a, b) => a.definition.id < b.definition.id ? -1 : a.definition.id > b.definition.id ? 1 : 0)
            .map(block => ({
                blockId: block.definition.id,
                location: block.location,
                enterOrder: block.enterOrder,
            }));

        return deepFreeze<GameSnapshot>({
            sessionId,
            revision,
            levelId: this.level.id,
            contentVersion: this.level.contentVersion,
            phase: position.phase,
            board,
            buffer,
            occupiedSlots: startSlot,
            melds: position.melds.map(copyMeld),
            groups,
            terminal: evaluation.terminal === null ? null : copyTerminal(evaluation.terminal),
            stalled: evaluation.stalled,
            audit: {
                totalTileCount: position.blocks.reduce((total, block) => total + block.definition.cards.length, 0),
                blocks: auditBlocks,
            },
        });
    }

    private notify(result: AcceptedCommand): void {
        for (const listener of Array.from(this.listeners)) {
            try {
                listener(result);
            } catch (error) {
                try {
                    this.onSubscriberError?.(error);
                } catch {
                    // Diagnostics injection must not break an already committed transaction.
                }
            }
        }
    }
}
