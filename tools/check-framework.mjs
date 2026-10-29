import fs from 'node:fs';
import path from 'node:path';
import { loadTypeScript } from './typescript.mjs';
const { ts } = loadTypeScript();
const configFile = ts.readConfigFile('tsconfig.json', ts.sys.readFile);
if (configFile.error) throw new Error(ts.flattenDiagnosticMessageText(configFile.error.messageText, '\n'));
const config = ts.parseJsonConfigFileContent(configFile.config, ts.sys, process.cwd());
const program = ts.createProgram(config.fileNames, { ...config.options, noEmit: true, incremental: false });
const diagnostics = [...config.errors, ...ts.getPreEmitDiagnostics(program)];
if (diagnostics.length) {
    console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCanonicalFileName: f => f,
        getCurrentDirectory: () => process.cwd(), getNewLine: () => '\n' }));
    process.exitCode = 1;
} else console.log('Strict typecheck passed: ' + config.fileNames.length + ' source files; TypeScript ' + ts.version);
// Creator's loose spread transform assumes arrays; Map/Set snapshots must use Array.from().
const checker = program.getTypeChecker();
for (const source of program.getSourceFiles()) if (!source.isDeclarationFile && source.fileName.includes('assets/Framework')) {
    const visit = node => {
        if (ts.isSpreadElement(node) && ts.isArrayLiteralExpression(node.parent)) {
            const type = checker.getTypeAtLocation(node.expression);
            if (!checker.isArrayType(type) && !checker.isTupleType(type)) {
                const location = source.getLineAndCharacterOfPosition(node.getStart());
                console.error('Creator iterable-spread hazard: ' + source.fileName + ':' + (location.line + 1));
                process.exitCode = 1;
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
}
const forbidden = /adunit-|GOLD_CHANGED|BAG_DATA|BATTLE_REVIVE|深空火箭|守卫文明|generateTowerSpots/;
let scanned = 0;
function scan(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) scan(file);
        else if (file.endsWith('.ts')) {
            const content = fs.readFileSync(file, 'utf8'); scanned++;
            if (forbidden.test(content)) { console.error('Business residue: ' + file); process.exitCode = 1; }
            if (file.includes('/Kernel/') && /from\s+['"](?:cc|db:|\.\.\/Core)/.test(content)) {
                console.error('Kernel dependency violation: ' + file); process.exitCode = 1;
            }
        }
    }
}
scan('assets/Framework');
console.log('Framework boundary scan: ' + scanned + ' files');
