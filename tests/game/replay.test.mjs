import test from 'node:test';
import assert from 'node:assert/strict';
import { LEVEL_888 } from '../../assets/Game/Config/Level888.ts';
import { RECOMMENDED_SOLUTION_888 } from '../../assets/Game/Config/RecommendedSolution888.ts';
import { replay } from '../../assets/Game/Application/GameReplay.ts';

const input = commands => ({ levelId: '888', contentVersion: '888-v3', commands });

function fullRouteCommands() {
    return RECOMMENDED_SOLUTION_888.map(blockId => ({
        kind: 'select',
        sessionId: 'replay-1',
        blockId,
    }));
}

test('replay of the recommended route is deterministic and ends Won with complete audit', () => {
    const commands = fullRouteCommands();
    const first = replay(LEVEL_888, input(commands));
    const second = replay(LEVEL_888, input(commands));
    assert.deepEqual(first, second);
    assert.equal(first.steps.length, 22);
    assert.equal(first.steps.every(step => step.accepted), true);
    assert.equal(first.steps[0].snapshot.sessionId, 'replay-1');
    assert.equal(first.steps[0].snapshot.revision, 1);
    assert.equal(first.steps[21].snapshot.revision, 22);

    const ultimateStep = first.steps.find(step => step.ultimate !== null);
    assert.ok(ultimateStep);
    assert.equal(ultimateStep.index, 9);
    assert.deepEqual(ultimateStep.ultimate, {
        fan: 'qingyise',
        power: 5,
        targetGroupIds: ['G06', 'G07', 'G08', 'G09', 'G10'],
        pairKind: 'twoSingles',
        pairBlockIds: ['B09', 'B10'],
        handBlockIds: ['B01', 'B02', 'B03', 'B04', 'B05', 'B06', 'B07', 'B08', 'B09', 'B10'],
        pairCleanupBlockIds: [],
        pairCleanupTileCount: 0,
    });
    assert.equal(first.steps[9].snapshot.phase, 'Collecting');
    assert.deepEqual(
        first.steps[9].snapshot.boardBlockIds,
        ['B21', 'B22', 'B23', 'B24', 'B25', 'B26', 'B27', 'B28', 'B29', 'B30', 'B31', 'B32'],
    );

    assert.equal(first.final.phase, 'Won');
    assert.equal(first.final.terminal, 'Won');
    assert.equal(first.final.boardBlockIds.length, 0);
    assert.equal(first.final.buffer.length, 0);
    assert.equal(first.final.melds.length, 0);
    assert.equal(first.final.totalTileCount, 48);
    assert.equal(first.final.groups.length, 16);
    assert.equal(first.final.groups.every(group => group.integrity === 'removed'), true);
});

test('replay records blocked, stale, accepted and restart steps with normalized snapshots', () => {
    const commands = [
        { kind: 'select', sessionId: 'replay-1', blockId: 'B11' },
        { kind: 'select', sessionId: 'stale', blockId: 'B01' },
        { kind: 'select', sessionId: 'replay-1', blockId: 'B01' },
        { kind: 'restart', sessionId: 'replay-1' },
        { kind: 'select', sessionId: 'replay-1', blockId: 'B01' },
        { kind: 'select', sessionId: 'replay-2', blockId: 'B01' },
    ];
    const result = replay(LEVEL_888, input(commands));
    assert.equal(result.steps.length, 6);
    assert.deepEqual(result.steps.map(step => step.accepted), [false, false, true, true, false, true]);
    assert.deepEqual(result.steps.map(step => step.reason), ['blocked', 'stale-session', null, null, 'stale-session', null]);
    assert.equal(result.steps[2].snapshot.revision, 1);
    assert.equal(result.steps[3].snapshot.sessionId, 'replay-2');
    assert.equal(result.steps[3].snapshot.revision, 0);
    assert.equal(result.steps[3].snapshot.phase, 'Collecting');
    assert.equal(result.steps[4].snapshot.sessionId, 'replay-2');
    assert.equal(result.steps[4].snapshot.revision, 0);
    assert.equal(result.steps[5].snapshot.revision, 1);
    assert.equal(result.final.sessionId, 'replay-2');
    assert.equal(result.final.revision, 1);
    assert.deepEqual(result.steps[3].eventKinds, ['session-restarted']);
    assert.equal(result.steps[0].snapshot.boardBlockIds.length, 32);
    assert.equal(result.steps[0].snapshot.selectableBlockIds.length, 10);
});

test('replay summary is independent of event ordering details but preserves ultimate targets', () => {
    const result = replay(LEVEL_888, input(fullRouteCommands()));
    const ultimateSteps = result.steps.filter(step => step.ultimate !== null);
    assert.equal(ultimateSteps.length, 1);
    assert.deepEqual(ultimateSteps[0].ultimate.targetGroupIds, ['G06', 'G07', 'G08', 'G09', 'G10']);
    assert.deepEqual(result.steps[0].snapshot.groups.map(group => group.groupId), [
        'G01', 'G02', 'G03', 'G04', 'G05', 'G06', 'G07', 'G08',
        'G09', 'G10', 'G11', 'G12', 'G13', 'G14', 'G15', 'G16',
    ]);
    assert.deepEqual(result.steps[0].snapshot.groups[0].remainingBoardBlockIds, ['B02']);
});

test('replay rejects mismatched level identity and version', () => {
    assert.throws(
        () => replay(LEVEL_888, { levelId: '999', contentVersion: '888-v3', commands: [] }),
        /levelId/,
    );
    assert.throws(
        () => replay(LEVEL_888, { levelId: '888', contentVersion: '888-v1', commands: [] }),
        /contentVersion/,
    );
});

test('replay with no commands returns the initial normalized summary', () => {
    const result = replay(LEVEL_888, input([]));
    assert.equal(result.steps.length, 0);
    assert.equal(result.final.sessionId, 'replay-1');
    assert.equal(result.final.revision, 0);
    assert.equal(result.final.phase, 'Collecting');
    assert.equal(result.final.boardBlockIds.length, 32);
    assert.equal(result.final.selectableBlockIds.length, 10);
    assert.equal(result.final.totalTileCount, 48);
});

test('R01-01: replay records a single-double-block pair as a 9-block hand', () => {
    const order = [
        'B01', 'B02', 'B03', 'B04', 'B05', 'B06', 'B07', 'B08', 'B09', 'B10',
        'B21', 'B22', 'B23', 'B24', 'B27', 'B28', 'B29', 'B30', 'B26',
    ];
    const commands = order.map(blockId => ({ kind: 'select', sessionId: 'replay-1', blockId }));
    const result = replay(LEVEL_888, input(commands));
    assert.equal(result.steps.every(step => step.accepted), true);
    const ultimateStep = result.steps.find(step => step.ultimate?.pairKind === 'doubleBlock');
    assert.ok(ultimateStep);
    assert.equal(ultimateStep.ultimate.fan, 'pinghu');
    assert.equal(ultimateStep.ultimate.power, 1);
    assert.equal(ultimateStep.ultimate.pairKind, 'doubleBlock');
    assert.deepEqual(ultimateStep.ultimate.pairBlockIds, ['B26']);
    assert.equal(ultimateStep.ultimate.handBlockIds.length, 9);
    assert.equal(new Set(ultimateStep.ultimate.handBlockIds).size, 9);
    assert.deepEqual(ultimateStep.ultimate.pairCleanupBlockIds, ['B25']);
    assert.equal(ultimateStep.ultimate.pairCleanupTileCount, 1);
    assert.deepEqual(ultimateStep.ultimate.handBlockIds, [
        'B21', 'B22', 'B23', 'B24', 'B27', 'B28', 'B29', 'B30', 'B26',
    ]);
    assert.equal(result.final.phase, 'Won');
    assert.deepEqual(result.final.boardBlockIds, []);
    assert.equal(result.final.terminal, 'Won');
});
