import { registerHooks } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadTypeScript } from '../tools/typescript.mjs';
const { ts } = loadTypeScript();
registerHooks({
    resolve(specifier, context, next) {
        if (specifier === 'cc') return { url: new URL('./support/cc-mock.mjs', import.meta.url).href, shortCircuit: true };
        if (specifier === 'cc/env') return { url: new URL('./support/cc-env.mjs', import.meta.url).href, shortCircuit: true };
        if (specifier.startsWith('.') && context.parentURL) {
            const url = new URL(specifier, context.parentURL);
            if (!/\.[a-z]+$/i.test(url.pathname) && existsSync(fileURLToPath(url) + '.ts'))
                return { url: url.href + '.ts', shortCircuit: true };
        }
        return next(specifier, context);
    },
    load(url, context, next) {
        if (url.endsWith('.ts')) return { format: 'module', shortCircuit: true,
            source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), { compilerOptions: {
                target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext, experimentalDecorators: true
            } }).outputText };
        return next(url, context);
    }
});
