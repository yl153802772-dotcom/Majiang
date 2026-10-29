import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadTypeScript } from '../tools/typescript.mjs';

const { ts } = loadTypeScript();
const markdown = fs.readFileSync(new URL('../需求设计/02_架构与接口/MVP_V2_CONTRACTS.md', import.meta.url), 'utf8');
const contract = Array.from(markdown.matchAll(/~~~ts\n([\s\S]*?)\n~~~/g), match => match[1]).join('\n');

function diagnosticsFor(source) {
    // Virtual compiler input only. No temporary .ts/.d.ts or emitted files.
    const filename = path.resolve('需求设计/02_架构与接口/__in_memory_contract_test__.ts');
    const options = { strict: true, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ES2020 };
    const host = ts.createCompilerHost(options);
    const read = host.readFile.bind(host), exists = host.fileExists.bind(host);
    host.readFile = file => path.resolve(file) === filename ? source : read(file);
    host.fileExists = file => path.resolve(file) === filename || exists(file);
    return ts.getPreEmitDiagnostics(ts.createProgram([filename], options, host))
        .map(item => ts.flattenDiagnosticMessageText(item.messageText, '\n'));
}

test('V2.3 documented public contracts compile together in strict mode without game implementation', () => {
    assert.match(markdown, /当前契约版本 V2\.3/);
    assert.equal(Array.from(markdown.matchAll(/~~~ts/g)).length, 4);
    assert.deepEqual(diagnosticsFor(contract), []);
});

test('documented contracts reject snapshot mutation, wrong fan power and mismatched event payload', () => {
    const invalidUses = `
declare const snapshot: GameSnapshot;
// @ts-expect-error snapshot collection must remain readonly
snapshot.buffer.pop();
// @ts-expect-error nested block identity must remain readonly
snapshot.board[0].definition.id = 'B99';
// @ts-expect-error qingyise cannot silently acquire pengpenghu power
const invalidFan: FanResult = { fan: 'qingyise', power: 2 };
// @ts-expect-error kind and payload must be a discriminated union
const invalidEvent: GameEvent = { sessionId: 's', revision: 1, eventId: 'e', kind: 'board-unlocked', payload: { oldSessionId: 'old', newSessionId: 'new' } };
`;
    assert.deepEqual(diagnosticsFor(contract + invalidUses), []);
});
