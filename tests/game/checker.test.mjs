import test from 'node:test';
import assert from 'node:assert/strict';
import {
    analyzeSources,
    classifyModuleSpecifier,
    frameworkPath,
    gamePath,
    runSelfTest,
    scanSourceForbiddenApis,
    scanSourceLayerViolations,
} from '../../tools/check-game.mjs';

const scanLayer = (layer, fileName, source) => scanSourceLayerViolations(gamePath(layer, fileName), source);
const scanApi = (layer, fileName, source) => scanSourceForbiddenApis(gamePath(layer, fileName), source);
const codesOf = issues => issues.map(issue => issue.code);

test('Game sources in undefined directories or the Game root are rejected', () => {
    for (const layer of ['Unclassified', '']) {
        const issues = scanLayer(layer, '__reject.ts', "import { Node } from 'cc'; export const value = Math.random();");
        assert.deepEqual(codesOf(issues), ['game-unknown-layer']);
    }
    // A non-Game source must not be mislabeled as an unknown Game layer.
    assert.deepEqual(scanLayer('../ReviewFixtures', '__outside.ts', 'export const value = 1;'), []);
});

test('inline import types and typeof import obey the same dependency boundaries', () => {
    const cases = [
        [gamePath('Domain', '__type_cc.ts'), "export type Hidden = import('cc').Node;", 'game-layer-violation'],
        [gamePath('Domain', '__type_config.ts'), "export type Hidden = typeof import('../Config/Level888').LEVEL_888;", 'game-layer-violation'],
        [gamePath('Domain', '__type_application.ts'), "export type Hidden = import('../Application/GameSnapshot').GameSnapshot;", 'game-layer-violation'],
        [gamePath('Application', '__type_framework.ts'), "export type Hidden = typeof import('../../Framework/Core/Logger').Logger;", 'game-layer-violation'],
        [frameworkPath('Core', '__type_game.ts'), "export type Hidden = import('../../Game/Domain/CardTypes').Card;", 'framework-imports-game'],
        [gamePath('Domain', '__dynamic_cc.ts'), 'export const hidden = import(`cc`);', 'game-layer-violation'],
    ];
    for (const [fileName, source, expected] of cases) {
        assert.ok(codesOf(scanSourceLayerViolations(fileName, source)).includes(expected), source);
    }
});

test('inline import types in allowed layers remain valid', () => {
    for (const [fileName, source] of [
        [gamePath('Domain', '__valid_type.ts'), "export type Face = import('./CardTypes').Card;"],
        [gamePath('Config', '__valid_typeof.ts'), "export type Level = typeof import('./Level888').LEVEL_888;"],
        [gamePath('Application', '__valid_type.ts'), "export type Face = import('../Domain/CardTypes').Card;"],
        [frameworkPath('Core', '__valid_type.ts'), "export type EngineNode = import('cc').Node;"],
    ]) assert.deepEqual(scanSourceLayerViolations(fileName, source), [], source);
});

test('computed property access cannot bypass random and wall-clock checks', () => {
    for (const layer of ['Domain', 'Config', 'Application']) {
        for (const [expression, expected] of [
            ["Math['random']()", 'rule-random'],
            ['Math[`random`]()', 'rule-random'],
            ["Date['now']()", 'rule-wall-clock'],
            ["performance['now']()", 'rule-wall-clock'],
            ["crypto['randomUUID']()", 'rule-random'],
            ["globalThis['crypto']['getRandomValues'](new Uint8Array(1))", 'rule-random'],
            ["globalThis['Math']['random']()", 'rule-random'],
            ["(Date)['now']()", 'rule-wall-clock'],
        ]) {
            assert.ok(codesOf(scanApi(layer, '__computed.ts', `export const value = ${expression};`)).includes(expected), `${layer}: ${expression}`);
        }
    }
});

test('deterministic computed properties and presentation clocks are not rejected', () => {
    const source = [
        "export const rounded = Math['floor'](1.5);",
        "export const fixedTime = Date['UTC'](2020, 0, 1);",
        "export const text = \"Math['random']() and Date['now']()\";",
        "// performance['now']() is a comment.",
    ].join('\n');
    assert.deepEqual(scanApi('Domain', '__valid_computed.ts', source), []);
    assert.deepEqual(scanApi('Presentation/UI', '__visual_clock.ts', "export const value = Date['now']();"), []);
});

test('Domain rejects Application, Config, Presentation, engine and Framework imports', () => {
    const cases = [
        ["import type { GameSnapshot } from '../Application/GameSnapshot';", 'game-layer-violation'],
        ["import { LEVEL_888 } from '../Config/Level888';", 'game-layer-violation'],
        ["import { GameRoot } from '../Presentation/GameRoot';", 'game-layer-violation'],
        ["import { Node } from 'cc';", 'game-layer-violation'],
        ["import { Logger } from '../../Framework/Core/Logger';", 'game-layer-violation'],
    ];
    for (const [source, expected] of cases) {
        const codes = codesOf(scanLayer('Domain', '__reject.ts', source));
        assert.ok(codes.includes(expected), `${source} -> ${codes.join(',')}`);
    }
});

test('Application rejects engine and Framework imports and outer Game layers', () => {
    const cases = [
        ["import { sys } from 'cc';", 'game-layer-violation'],
        ["import { Node } from 'cc/env';", 'game-layer-violation'],
        ["import { Logger } from '../../Framework/Core/Logger';", 'game-layer-violation'],
        ["import { GameRoot } from '../Presentation/GameRoot';", 'game-layer-violation'],
        ["import { LEVEL_888 } from '../Config/Level888';", 'game-layer-violation'],
    ];
    for (const [source, expected] of cases) {
        const codes = codesOf(scanLayer('Application', '__reject.ts', source));
        assert.ok(codes.includes(expected), `${source} -> ${codes.join(',')}`);
    }
});

test('Config rejects engine and gameplay layers', () => {
    for (const source of ["import { Node } from 'cc';", "import { GameSession } from '../Application/GameSession';"]) {
        assert.ok(codesOf(scanLayer('Config', '__reject.ts', source)).includes('game-layer-violation'), source);
    }
});

test('Framework rejects imports that resolve into Game', () => {
    const issues = scanSourceLayerViolations(
        frameworkPath('Core', '__reject.ts'),
        "import type { BlockID } from '../../Game/Domain/BlockTypes';\nexport type Bad = BlockID;\n",
    );
    assert.deepEqual(codesOf(issues), ['framework-imports-game']);
});

test('accepted pure TypeScript imports pass the layer scan', () => {
    const valid = [
        ['Domain', "import type { Card } from './CardTypes';\nexport type Alias = Card;\n"],
        ['Config', "import type { LevelDefinition } from '../Domain/LevelDefinition';\nexport type Alias = LevelDefinition;\n"],
        ['Application', "import type { Card } from '../Domain/CardTypes';\nimport type { Snapshot } from './GameSnapshot';\nexport type Alias = [Card, Snapshot];\n"],
        ['Presentation/UI', [
            "import { Node } from 'cc';",
            "import { UIBase } from '../../../Framework/Components/UIBase';",
            "import type { GameSnapshot } from '../../Application/GameSnapshot';",
            "import { LEVEL_888 } from '../../Config/Level888';",
            "import type { Card } from '../../Domain/CardTypes';",
            'export type Alias = [typeof Node, typeof UIBase, GameSnapshot, typeof LEVEL_888, Card];',
            '',
        ].join('\n')],
        ['Bootstrap', [
            "import { Node } from 'cc';",
            "import { GameSession } from '../Application/GameSession';",
            "import { LEVEL_888 } from '../Config/Level888';",
            "import { GameRoot } from '../Presentation/GameRoot';",
            'export type Alias = [typeof Node, typeof GameSession, typeof LEVEL_888, typeof GameRoot];',
            '',
        ].join('\n')],
    ];
    for (const [layer, source] of valid) {
        assert.deepEqual(scanLayer(layer, '__accept.ts', source), [], `${layer} should accept pure source`);
    }
    assert.deepEqual(
        scanSourceLayerViolations(frameworkPath('Core', '__accept.ts'), "import { Node } from 'cc';\nexport type Alias = typeof Node;\n"),
        [],
    );
});

test('module specifier classification resolves Game, Framework and engine', () => {
    const fromDomain = gamePath('Domain', 'Probe.ts');
    assert.deepEqual(classifyModuleSpecifier('./CardTypes', fromDomain), { kind: 'game', layer: 'Domain', label: 'Domain' });
    assert.deepEqual(classifyModuleSpecifier('../Application/GameSession', fromDomain), { kind: 'game', layer: 'Application', label: 'Application' });
    assert.equal(classifyModuleSpecifier('../../Framework/Core/Logger', fromDomain).kind, 'framework');
    assert.equal(classifyModuleSpecifier('cc', fromDomain).kind, 'engine');
    assert.equal(classifyModuleSpecifier('cc/env', fromDomain).kind, 'engine');
    assert.equal(classifyModuleSpecifier('db://assets/Game/Config/Level888', fromDomain).kind, 'game');
});

test('rule layers reject Math.random, wall clock and crypto randomness', () => {
    const cases = [
        ['Domain', 'export const value = Math.random();', 'rule-random'],
        ['Application', 'export const value = Date.now();', 'rule-wall-clock'],
        ['Config', 'export const value = new Date();', 'rule-wall-clock'],
        ['Domain', 'export const value = performance.now();', 'rule-wall-clock'],
        ['Application', 'export const value = crypto.randomUUID();', 'rule-random'],
        ['Domain', 'export const value = globalThis.crypto.getRandomValues(new Uint8Array(1));', 'rule-random'],
    ];
    for (const [layer, source, expected] of cases) {
        assert.ok(codesOf(scanApi(layer, '__reject.ts', source)).includes(expected), `${layer}: ${source}`);
    }
});

test('rule layers accept deterministic code and ignore comments mentioning forbidden APIs', () => {
    const source = [
        '// Math.random() and Date.now() in comments are documentation, not dependencies.',
        'export function add(a: number, b: number): number { return a + b; }',
        'export const order = [1, 2, 3].map(value => value + 1);',
        '',
    ].join('\n');
    assert.deepEqual(scanApi('Domain', '__accept.ts', source), []);
    assert.deepEqual(scanApi('Application', '__accept.ts', source), []);
});

test('Presentation may use engine and framework APIs but stays outside rule scans', () => {
    const source = [
        "import { Node } from 'cc';",
        "import { UIBase } from '../../../Framework/Components/UIBase';",
        'export function attach(parent: Node): typeof UIBase { return UIBase; }',
        'export const seed = Math.random();',
        '',
    ].join('\n');
    assert.deepEqual(scanLayer('Presentation/UI', '__accept.ts', source), []);
    assert.deepEqual(scanApi('Presentation/UI', '__accept.ts', source), []);
});

test('iterable spreads reject Map/Set/iterator and accept arrays, tuples and Array.from', () => {
    const sources = [
        {
            fileName: gamePath('Domain', '__reject_set.ts'),
            source: 'const set = new Set([1, 2]);\nexport const values: number[] = [...set];\n',
            expected: 'iterable-spread-hazard',
        },
        {
            fileName: gamePath('Application', '__reject_map.ts'),
            source: 'const map = new Map<string, number>();\nexport const values: number[] = [...map.values()];\n',
            expected: 'iterable-spread-hazard',
        },
        {
            fileName: gamePath('Domain', '__accept_array.ts'),
            source: 'export function copy(cards: readonly number[]): number[] { return [...cards]; }\n',
            expected: null,
        },
        {
            fileName: gamePath('Domain', '__accept_tuple.ts'),
            source: "const pair = [1, 2] as const;\nexport const values: number[] = [...pair];\n",
            expected: null,
        },
        {
            fileName: gamePath('Domain', '__accept_array_from.ts'),
            source: 'const set = new Set([1, 2]);\nexport const values: number[] = Array.from(set);\n',
            expected: null,
        },
    ];
    const issues = analyzeSources(sources);
    for (const entry of sources) {
        const hits = issues.filter(issue => issue.fileName === entry.fileName);
        if (entry.expected === null) {
            assert.deepEqual(hits, [], `${entry.fileName} should be accepted`);
        } else {
            assert.ok(hits.some(issue => issue.code === entry.expected), `${entry.fileName} should be rejected`);
        }
    }
});

test('checker self-test rejects every in-memory violation and accepts every valid sample', () => {
    const result = runSelfTest();
    assert.equal(result.cases.length, 24);
    assert.equal(result.cases.filter(entry => entry.expected !== null).length, 18);
    assert.equal(result.cases.filter(entry => entry.expected === null).length, 6);
    assert.equal(result.ok, true);
    for (const entry of result.cases) {
        assert.equal(entry.detected, true, `${entry.id} expected ${String(entry.expected)}: ${entry.issues.map(issue => issue.code).join(', ')}`);
    }
});
