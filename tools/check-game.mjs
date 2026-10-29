/**
 * G01 Game 检查器。
 * 1. 保留原全工程 TypeScript strict 检查（不修改 tools/check-framework.mjs）。
 * 2. 检查 Game 分层导入：Domain/Config/Application 的纯 TS 边界、Application 无引擎/Framework、
 *    Framework 不依赖 Game。
 * 3. 检查规则层的 Math.random / Date.now / new Date / performance.now 等随机与墙钟依赖。
 * 4. 检查非数组 iterable 的展开风险（Map/Set/iterator 必须用 Array.from）。
 * 5. 用内存源码负例证明规则确实会拒绝违规；负例不写入 assets。
 *
 * 本工具只读项目源码并输出问题，不自动修复，不安装依赖。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTypeScript } from './typescript.mjs';

const { ts } = loadTypeScript();

export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ASSETS_ROOT = path.join(PROJECT_ROOT, 'assets');
export const GAME_ROOT = path.join(ASSETS_ROOT, 'Game');
export const FRAMEWORK_ROOT = path.join(ASSETS_ROOT, 'Framework');

const RULE_LAYERS = new Set(['Domain', 'Config', 'Application']);
const ALL_GAME_LAYERS = new Set([
    'Domain', 'Config', 'Application',
    'Presentation/UI', 'Presentation/Table3D', 'Presentation',
    'Bootstrap', 'Diagnostics',
]);

const LAYER_RULES = new Map([
    ['Domain', { layers: new Set(['Domain']), framework: false, engine: false, external: false }],
    ['Config', { layers: new Set(['Config', 'Domain']), framework: false, engine: false, external: false }],
    ['Application', { layers: new Set(['Application', 'Domain']), framework: false, engine: false, external: false }],
    ['Presentation/UI', {
        layers: new Set(['Presentation/UI', 'Presentation/Table3D', 'Presentation', 'Application', 'Config', 'Domain']),
        framework: true, engine: true, external: true,
    }],
    ['Presentation/Table3D', {
        layers: new Set(['Presentation/Table3D', 'Presentation/UI', 'Presentation', 'Application', 'Config', 'Domain']),
        framework: true, engine: true, external: true,
    }],
    ['Presentation', {
        layers: new Set(['Presentation', 'Presentation/UI', 'Presentation/Table3D', 'Application', 'Config', 'Domain']),
        framework: true, engine: true, external: true,
    }],
    ['Bootstrap', { layers: ALL_GAME_LAYERS, framework: true, engine: true, external: true }],
    ['Diagnostics', { layers: ALL_GAME_LAYERS, framework: true, engine: true, external: true }],
]);

function isInside(root, target) {
    const relative = path.relative(root, target);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/** 返回 Game 内的逻辑层；不在 Game 内或位于未定义目录时返回 null。 */
export function layerOfPath(fileName) {
    const absolute = path.resolve(fileName);
    if (!isInside(GAME_ROOT, absolute)) return null;
    const relative = path.relative(GAME_ROOT, absolute);
    if (relative === '') return null;
    const parts = relative.split(path.sep);
    const top = parts[0];
    if (top === 'Presentation') {
        if (parts[1] === 'UI') return 'Presentation/UI';
        if (parts[1] === 'Table3D') return 'Presentation/Table3D';
        return 'Presentation';
    }
    return ['Domain', 'Config', 'Application', 'Bootstrap', 'Diagnostics'].includes(top) ? top : null;
}

export function gamePath(layer, fileName) {
    return path.join(GAME_ROOT, ...layer.split('/'), fileName);
}

export function frameworkPath(relative, fileName) {
    return path.join(FRAMEWORK_ROOT, relative, fileName);
}

function isGamePath(fileName) {
    return isInside(GAME_ROOT, path.resolve(fileName));
}

function isFrameworkPath(fileName) {
    return isInside(FRAMEWORK_ROOT, path.resolve(fileName));
}

function stripModuleExtension(fileName) {
    return fileName.replace(/\.(?:ts|tsx|js|mjs|cjs)$/i, '');
}

function classifyAbsolute(fileName) {
    const absolute = path.resolve(fileName);
    if (isGamePath(absolute)) {
        const layer = layerOfPath(absolute);
        return layer === null ? { kind: 'unknown-game', label: 'Game（未定义层）' } : { kind: 'game', layer, label: layer };
    }
    if (isFrameworkPath(absolute)) return { kind: 'framework', label: 'Framework' };
    return { kind: 'external', label: '项目外相对路径' };
}

/** 把 import 说明符分类为 Game 层 / Framework / 引擎 / 外部。 */
export function classifyModuleSpecifier(specifier, fromFile) {
    if (specifier === 'cc' || specifier.startsWith('cc/') ||
        specifier === 'wx' || specifier.startsWith('wx/')) {
        return { kind: 'engine', label: specifier };
    }
    if (specifier.startsWith('db://assets/')) {
        return classifyAbsolute(path.join(ASSETS_ROOT, stripModuleExtension(specifier.slice('db://assets/'.length))));
    }
    if (specifier.startsWith('db://')) return { kind: 'external', label: specifier };
    if (specifier.startsWith('.')) {
        return classifyAbsolute(stripModuleExtension(path.resolve(path.dirname(fromFile), specifier)));
    }
    return { kind: 'external', label: specifier };
}

function lineOf(sourceFile, position) {
    return sourceFile.getLineAndCharacterOfPosition(position).line + 1;
}

function parseSource(fileName, source) {
    return ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

/** 收集静态导入/导出、import 类型（含 typeof import）和字面量动态导入。 */
export function collectModuleSpecifiers(sourceFile) {
    const found = [];
    for (const statement of sourceFile.statements) {
        if ((ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) &&
            statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
            found.push({ specifier: statement.moduleSpecifier.text, position: statement.moduleSpecifier.getStart(sourceFile) });
        }
    }
    const walk = node => {
        if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword &&
            node.arguments.length >= 1 && ts.isStringLiteralLike(node.arguments[0])) {
            found.push({ specifier: node.arguments[0].text, position: node.arguments[0].getStart(sourceFile) });
        }
        if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) &&
            ts.isStringLiteralLike(node.argument.literal)) {
            const literal = node.argument.literal;
            found.push({ specifier: literal.text, position: literal.getStart(sourceFile) });
        }
        ts.forEachChild(node, walk);
    };
    walk(sourceFile);
    return found;
}

/** 检查单个源码的分层导入规则；返回问题数组，不写文件。 */
export function scanSourceLayerViolations(fileName, source) {
    const issues = [];
    const absolute = path.resolve(fileName);
    const gameLayer = layerOfPath(absolute);
    const frameworkFile = isFrameworkPath(absolute);
    if (!isGamePath(absolute) && !frameworkFile) return issues;

    if (frameworkFile) {
        // Framework：只要求不依赖 Game。
        const sourceFile = parseSource(absolute, source);
        for (const { specifier, position } of collectModuleSpecifiers(sourceFile)) {
            const target = classifyModuleSpecifier(specifier, absolute);
            if (target.kind === 'game' || target.kind === 'unknown-game') {
                issues.push({
                    code: 'framework-imports-game',
                    fileName: absolute,
                    line: lineOf(sourceFile, position),
                    message: `Framework 不得依赖 Game，发现 import '${specifier}'。`,
                });
            }
        }
        return issues;
    }

    const rule = LAYER_RULES.get(gameLayer);
    if (!rule) {
        issues.push({
            code: 'game-unknown-layer',
            fileName: absolute,
            line: 1,
            message: `Game 源码位于未定义层：${path.relative(GAME_ROOT, absolute)}。`,
        });
        return issues;
    }

    const sourceFile = parseSource(absolute, source);
    for (const { specifier, position } of collectModuleSpecifiers(sourceFile)) {
        const target = classifyModuleSpecifier(specifier, absolute);
        let allowed = true;
        if (target.kind === 'game') allowed = rule.layers.has(target.layer);
        else if (target.kind === 'unknown-game') allowed = false;
        else if (target.kind === 'framework') allowed = rule.framework;
        else if (target.kind === 'engine') allowed = rule.engine;
        else allowed = rule.external;
        if (!allowed) {
            issues.push({
                code: 'game-layer-violation',
                fileName: absolute,
                line: lineOf(sourceFile, position),
                message: `${gameLayer} 不能依赖 ${target.label}，发现 import '${specifier}'。`,
            });
        }
    }
    return issues;
}

function unwrapExpression(node) {
    while (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) ||
        ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node) || ts.isSatisfiesExpression(node)) {
        node = node.expression;
    }
    return node;
}

/** 只解析静态成员名，不猜测运行时计算的属性或变量别名。 */
function staticMemberName(node) {
    node = unwrapExpression(node);
    if (ts.isIdentifier(node)) return node.text;
    if (ts.isPropertyAccessExpression(node)) return node.name.text;
    if (ts.isElementAccessExpression(node) && node.argumentExpression) {
        const key = unwrapExpression(node.argumentExpression);
        if (ts.isStringLiteralLike(key)) return key.text;
    }
    return null;
}

/** 检查规则层的随机/墙钟依赖；仅扫描 Domain/Config/Application。 */
export function scanSourceForbiddenApis(fileName, source) {
    const absolute = path.resolve(fileName);
    const layer = layerOfPath(absolute);
    if (layer === null || !RULE_LAYERS.has(layer)) return [];
    const sourceFile = parseSource(absolute, source);
    const issues = [];
    const add = (code, node, message) => {
        issues.push({ code, fileName: absolute, line: lineOf(sourceFile, node.getStart(sourceFile)), message });
    };
    const walk = node => {
        if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
            const object = staticMemberName(node.expression);
            const property = staticMemberName(node);
            if (object === 'Math' && property === 'random') {
                add('rule-random', node, `${layer} 不得使用 Math.random。`);
            } else if (object === 'Date' && property === 'now') {
                add('rule-wall-clock', node, `${layer} 不得使用 Date.now。`);
            } else if (object === 'performance' && property === 'now') {
                add('rule-wall-clock', node, `${layer} 不得使用 performance.now。`);
            } else if (object === 'crypto' && (property === 'randomUUID' || property === 'getRandomValues')) {
                add('rule-random', node, `${layer} 不得使用 crypto 随机接口。`);
            }
        }
        if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'Date') {
            add('rule-wall-clock', node, `${layer} 不得使用 new Date 读取墙钟。`);
        }
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'Date') {
            add('rule-wall-clock', node, `${layer} 不得使用 Date() 读取墙钟。`);
        }
        ts.forEachChild(node, walk);
    };
    walk(sourceFile);
    return issues;
}

function typeIsFixedArray(checker, type) {
    if (checker.isArrayType(type) || checker.isTupleType(type)) return true;
    const symbol = type.getSymbol();
    const name = symbol ? symbol.getName() : '';
    return name === 'Array' || name === 'ReadonlyArray';
}

/** 检查所有展开表达式；只允许数组/元组，Map/Set/iterator 必须 Array.from。 */
export function scanSourceIterableSpreads(sourceFile, checker) {
    const issues = [];
    const walk = node => {
        if (ts.isSpreadElement(node)) {
            const type = checker.getTypeAtLocation(node.expression);
            if (!typeIsFixedArray(checker, type)) {
                issues.push({
                    code: 'iterable-spread-hazard',
                    fileName: path.resolve(sourceFile.fileName),
                    line: lineOf(sourceFile, node.getStart(sourceFile)),
                    message: `展开目标不是数组/元组（${checker.typeToString(type)}），Map/Set/iterator 请使用 Array.from。`,
                });
            }
        }
        ts.forEachChild(node, walk);
    };
    walk(sourceFile);
    return issues;
}

/** 用内存源码建立 TypeScript program，统一执行全部源码规则；不写任何文件。 */
export function analyzeSources(sources) {
    const virtual = new Map();
    for (const source of sources) virtual.set(path.resolve(PROJECT_ROOT, source.fileName), source.source);
    const options = {
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
    };
    const host = ts.createCompilerHost(options);
    const readFile = host.readFile.bind(host);
    const fileExists = host.fileExists.bind(host);
    host.readFile = fileName => virtual.get(path.resolve(fileName)) ?? readFile(fileName);
    host.fileExists = fileName => virtual.has(path.resolve(fileName)) || fileExists(fileName);
    const program = ts.createProgram(Array.from(virtual.keys()), options, host);
    const checker = program.getTypeChecker();
    const issues = [];
    const analyzed = new Set();
    for (const sourceFile of program.getSourceFiles()) {
        const absolute = path.resolve(sourceFile.fileName);
        const source = virtual.get(absolute);
        if (source === undefined) continue;
        analyzed.add(absolute);
        issues.push(...scanSourceLayerViolations(absolute, source));
        issues.push(...scanSourceForbiddenApis(absolute, source));
        issues.push(...scanSourceIterableSpreads(sourceFile, checker));
    }
    // 极端情况下 program 未纳入虚拟文件时仍执行不依赖类型检查的规则。
    for (const [fileName, source] of virtual) {
        if (analyzed.has(fileName)) continue;
        issues.push(...scanSourceLayerViolations(fileName, source));
        issues.push(...scanSourceForbiddenApis(fileName, source));
    }
    return issues;
}

const SELF_TEST_CASES = [
    {
        id: 'undefined-game-directory',
        fileName: gamePath('Unclassified', '__self_test_unknown_directory.ts'),
        source: "import { Node } from 'cc'; export const value = Math.random();\n",
        expected: 'game-unknown-layer',
    },
    {
        id: 'undefined-game-root',
        fileName: gamePath('', '__self_test_unknown_root.ts'),
        source: 'export const value = 1;\n',
        expected: 'game-unknown-layer',
    },
    {
        id: 'domain-import-type-engine',
        fileName: gamePath('Domain', '__self_test_import_type_engine.ts'),
        source: "export type Hidden = import('cc').Node;\n",
        expected: 'game-layer-violation',
    },
    {
        id: 'domain-typeof-import-config',
        fileName: gamePath('Domain', '__self_test_typeof_import_config.ts'),
        source: "export type Hidden = typeof import('../Config/Level888').LEVEL_888;\n",
        expected: 'game-layer-violation',
    },
    {
        id: 'framework-import-type-game',
        fileName: frameworkPath('Core', '__self_test_import_type_game.ts'),
        source: "export type Hidden = import('../../Game/Domain/CardTypes').Card;\n",
        expected: 'framework-imports-game',
    },
    {
        id: 'domain-computed-random',
        fileName: gamePath('Domain', '__self_test_computed_random.ts'),
        source: "export const value = Math['random']();\n",
        expected: 'rule-random',
    },
    {
        id: 'application-computed-clock',
        fileName: gamePath('Application', '__self_test_computed_clock.ts'),
        source: "export const value = Date['now']();\n",
        expected: 'rule-wall-clock',
    },
    {
        id: 'valid-domain-import-type',
        fileName: gamePath('Domain', '__self_test_valid_import_type.ts'),
        source: "export type Face = import('./CardTypes').Card;\n",
        expected: null,
    },
    {
        id: 'valid-domain-computed-deterministic',
        fileName: gamePath('Domain', '__self_test_valid_computed.ts'),
        source: "export const value = Math['floor'](1.5); export const fixedTime = Date['UTC'](2020, 0, 1);\n",
        expected: null,
    },
    {
        id: 'domain-imports-application',
        fileName: gamePath('Domain', '__self_test_domain_to_application.ts'),
        source: "import type { GameSnapshot } from '../Application/GameSnapshot';\nexport type Bad = GameSnapshot;\n",
        expected: 'game-layer-violation',
    },
    {
        id: 'domain-imports-config',
        fileName: gamePath('Domain', '__self_test_domain_to_config.ts'),
        source: "import { LEVEL_888 } from '../Config/Level888';\nexport const bad = LEVEL_888.id;\n",
        expected: 'game-layer-violation',
    },
    {
        id: 'domain-imports-engine',
        fileName: gamePath('Domain', '__self_test_domain_to_engine.ts'),
        source: "import { Node } from 'cc';\nexport const bad: typeof Node | null = null;\n",
        expected: 'game-layer-violation',
    },
    {
        id: 'application-imports-framework',
        fileName: gamePath('Application', '__self_test_application_to_framework.ts'),
        source: "import { Logger } from '../../Framework/Core/Logger';\nexport const bad = Logger;\n",
        expected: 'game-layer-violation',
    },
    {
        id: 'application-imports-engine',
        fileName: gamePath('Application', '__self_test_application_to_engine.ts'),
        source: "import { sys } from 'cc';\nexport const bad = sys;\n",
        expected: 'game-layer-violation',
    },
    {
        id: 'framework-imports-game',
        fileName: frameworkPath('Core', '__self_test_framework_to_game.ts'),
        source: "import type { BlockID } from '../../Game/Domain/BlockTypes';\nexport type Bad = BlockID;\n",
        expected: 'framework-imports-game',
    },
    {
        id: 'domain-math-random',
        fileName: gamePath('Domain', '__self_test_math_random.ts'),
        source: 'export function roll(): number { return Math.random(); }\n',
        expected: 'rule-random',
    },
    {
        id: 'application-date-now',
        fileName: gamePath('Application', '__self_test_date_now.ts'),
        source: 'export function stamp(): number { return Date.now(); }\n',
        expected: 'rule-wall-clock',
    },
    {
        id: 'config-new-date',
        fileName: gamePath('Config', '__self_test_new_date.ts'),
        source: 'export const startedAt = new Date();\n',
        expected: 'rule-wall-clock',
    },
    {
        id: 'domain-set-spread',
        fileName: gamePath('Domain', '__self_test_set_spread.ts'),
        source: 'const set = new Set([1, 2]);\nexport const values: number[] = [...set];\n',
        expected: 'iterable-spread-hazard',
    },
    {
        id: 'application-map-spread',
        fileName: gamePath('Application', '__self_test_map_spread.ts'),
        source: 'const map = new Map<string, number>();\nexport const values: number[] = [...map.values()];\n',
        expected: 'iterable-spread-hazard',
    },
    {
        id: 'valid-domain',
        fileName: gamePath('Domain', '__self_test_valid_domain.ts'),
        source: [
            "import type { Card } from './CardTypes';",
            'export function copyFace(card: Card): Card { return { suit: card.suit, rank: card.rank }; }',
            'export function copyAll(cards: readonly Card[]): readonly Card[] {',
            '    const out = Array.from(cards);',
            '    return [...out];',
            '}',
            '',
        ].join('\n'),
        expected: null,
    },
    {
        id: 'valid-application',
        fileName: gamePath('Application', '__self_test_valid_application.ts'),
        source: [
            "import type { Card } from '../Domain/CardTypes';",
            'export interface Snapshot { readonly cards: readonly Card[]; }',
            'export function first(cards: readonly Card[]): Card | null { return cards.length > 0 ? cards[0] : null; }',
            'export function toArray(iterable: Iterable<Card>): Card[] { return Array.from(iterable); }',
            '',
        ].join('\n'),
        expected: null,
    },
    {
        id: 'valid-config',
        fileName: gamePath('Config', '__self_test_valid_config.ts'),
        source: [
            "import type { LevelDefinition } from '../Domain/LevelDefinition';",
            "export const IDENTITY: Pick<LevelDefinition, 'id' | 'contentVersion'> = { id: '888', contentVersion: '888-v1' };",
            "export const IDS = ['B01', 'B02'];",
            'export const COPY = [...IDS];',
            '',
        ].join('\n'),
        expected: null,
    },
    {
        id: 'valid-presentation',
        fileName: gamePath('Presentation/UI', '__self_test_valid_ui.ts'),
        source: [
            'import { Node } from \'cc\';',
            "import type { Card } from '../../Domain/CardTypes';",
            'export function attach(parent: Node, card: Card): Node { return parent; }',
            '',
        ].join('\n'),
        expected: null,
    },
];

/**
 * 用内存负例自检。只有每条违规都被对应规则拒绝、且合法样本零问题时才通过。
 * 负例只存在于本文件字符串中，不会被写入 assets。
 */
export function runSelfTest() {
    const issues = analyzeSources(SELF_TEST_CASES);
    const cases = SELF_TEST_CASES.map(entry => {
        const absolute = path.resolve(entry.fileName);
        const hits = issues.filter(issue => path.resolve(issue.fileName) === absolute);
        const detected = entry.expected === null ? hits.length === 0 : hits.some(issue => issue.code === entry.expected);
        return { id: entry.id, expected: entry.expected, detected, issues: hits };
    });
    return {
        ok: cases.every(entry => entry.detected),
        cases,
    };
}

function walkTypeScriptFiles(root) {
    const files = [];
    if (!fs.existsSync(root)) return files;
    const visit = directory => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const full = path.join(directory, entry.name);
            if (entry.isDirectory()) visit(full);
            else if (entry.isFile() && full.endsWith('.ts')) files.push(full);
        }
    };
    visit(root);
    return files.sort();
}

function formatIssue(issue) {
    const relative = path.relative(PROJECT_ROOT, issue.fileName).split(path.sep).join('/');
    return `${relative}:${issue.line}: ${issue.code}: ${issue.message}`;
}

function main() {
    const configPath = path.join(PROJECT_ROOT, 'tsconfig.json');
    const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
    if (configFile.error) {
        console.error(ts.flattenDiagnosticMessageText(configFile.error.messageText, '\n'));
        process.exitCode = 1;
        return;
    }
    const config = ts.parseJsonConfigFileContent(configFile.config, ts.sys, PROJECT_ROOT);
    const program = ts.createProgram(config.fileNames, { ...config.options, noEmit: true, incremental: false });
    const diagnostics = [...config.errors, ...ts.getPreEmitDiagnostics(program)];
    if (diagnostics.length > 0) {
        console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
            getCanonicalFileName: fileName => fileName,
            getCurrentDirectory: () => PROJECT_ROOT,
            getNewLine: () => '\n',
        }));
        process.exitCode = 1;
    } else {
        console.log(`Strict typecheck passed: ${config.fileNames.length} source files; TypeScript ${ts.version}`);
    }

    const issues = [];
    if (config.options.strict !== true) {
        issues.push({
            code: 'strict-disabled',
            fileName: configPath,
            line: 1,
            message: 'tsconfig 必须保持 strict: true，不能用关闭严格模式通过检查。',
        });
    }
    const checker = program.getTypeChecker();
    const gameFiles = walkTypeScriptFiles(GAME_ROOT);
    if (gameFiles.length === 0) {
        issues.push({ code: 'no-game-sources', fileName: GAME_ROOT, line: 1, message: 'assets/Game 下没有 TypeScript 源码。' });
    }
    for (const fileName of gameFiles) {
        const sourceFile = program.getSourceFile(fileName);
        if (!sourceFile) {
            issues.push({ code: 'game-source-not-in-program', fileName, line: 1, message: 'Game 源码未被 tsconfig 纳入类型检查。' });
            continue;
        }
        const source = fs.readFileSync(fileName, 'utf8');
        issues.push(...scanSourceLayerViolations(fileName, source));
        issues.push(...scanSourceForbiddenApis(fileName, source));
        issues.push(...scanSourceIterableSpreads(sourceFile, checker));
    }
    const frameworkFiles = walkTypeScriptFiles(FRAMEWORK_ROOT);
    for (const fileName of frameworkFiles) {
        issues.push(...scanSourceLayerViolations(fileName, fs.readFileSync(fileName, 'utf8')));
    }

    const selfTest = runSelfTest();
    if (!selfTest.ok) {
        for (const entry of selfTest.cases) {
            if (entry.detected) continue;
            issues.push({
                code: 'self-test-failed',
                fileName: path.join(PROJECT_ROOT, 'tools/check-game.mjs'),
                line: 1,
                message: entry.expected === null
                    ? `合法样本 ${entry.id} 被误报：${entry.issues.map(issue => issue.code).join(', ')}`
                    : `负例 ${entry.id} 未被 ${entry.expected} 拒绝。`,
            });
        }
    }

    if (issues.length > 0) {
        for (const issue of issues) console.error(formatIssue(issue));
        console.error(`Game checks failed: ${issues.length} issue(s); game sources ${gameFiles.length}, framework sources ${frameworkFiles.length}.`);
        process.exitCode = 1;
    } else {
        const rejected = selfTest.cases.filter(entry => entry.expected !== null).length;
        const accepted = selfTest.cases.filter(entry => entry.expected === null).length;
        console.log(`Game boundary scan passed: ${gameFiles.length} game files, ${frameworkFiles.length} framework files.`);
        console.log(`Game iterable-spread/random/wall-clock scan passed.`);
        console.log(`Game self-test passed: ${rejected} in-memory violations rejected, ${accepted} valid samples accepted.`);
    }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
    try {
        main();
    } catch (error) {
        console.error('check:game failed unexpectedly:', error);
        process.exitCode = 1;
    }
}
