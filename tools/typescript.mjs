import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
export function loadTypeScript() {
    const version = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).creator.version;
    const roots = [process.env.COCOS_TYPESCRIPT,
        '/Applications/Cocos/Creator/' + version + '/CocosCreator.app/Contents/Resources/app.asar.unpacked/node_modules/typescript/lib/typescript.js'];
    for (const candidate of roots) if (candidate && fs.existsSync(candidate)) return { ts: require(path.resolve(candidate)), path: path.resolve(candidate) };
    throw new Error('Set COCOS_TYPESCRIPT to the installed Creator typescript.js; no dependency will be downloaded.');
}
