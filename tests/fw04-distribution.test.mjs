import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { auditFramework, exportFramework, auditBuild } from '../tools/framework-release.mjs';
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'majing-fw04-'));fs.mkdirSync(path.join(root,'assets/Framework'),{recursive:true});fs.mkdirSync(path.join(root,'build'));
 fs.writeFileSync(path.join(root,'assets/Framework/A.ts'),'export const a=1;');fs.writeFileSync(path.join(root,'assets/Framework/A.ts.meta'),JSON.stringify({uuid:'unique-a'}));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
test('FW04 standalone audit detects external/game imports, missing metadata and duplicate UUIDs',t=>{
 const root=fixture(t);assert.deepEqual(auditFramework(root).issues,[]);fs.writeFileSync(path.join(root,'assets/Framework/B.ts'),'import { x } from "../Game/X";');
 const issues=auditFramework(root).issues;assert.equal(issues.length,2);fs.writeFileSync(path.join(root,'assets/Framework/B.ts.meta'),JSON.stringify({uuid:'unique-a'}));assert.ok(auditFramework(root).issues.some(x=>x.includes('duplicate')));
});
test('FW04 export is reproducible, refuses overwrite and never includes a neighboring game',t=>{
 const root=fixture(t);fs.mkdirSync(path.join(root,'assets/Game'));fs.writeFileSync(path.join(root,'assets/Game/private.ts'),'do not export');
 const a=exportFramework('build/a',{root}),b=exportFramework('build/b',{root});assert.deepEqual(a,b);assert.ok(a.files.every(f=>f.path.startsWith('assets/Framework/')));
 assert.throws(()=>exportFramework('build/a',{root}),/new directory/);assert.throws(()=>exportFramework('../escape',{root}),/new directory/);
});
test('FW04 export rejects symlinked source or output ancestors',t=>{
 const root=fixture(t);fs.symlinkSync(path.join(root,'assets/Game'),path.join(root,'assets/Framework/link'));assert.throws(()=>auditFramework(root),/Symlinks/);fs.unlinkSync(path.join(root,'assets/Framework/link'));
 fs.symlinkSync(path.join(root,'assets'),path.join(root,'build/link'));assert.throws(()=>exportFramework('build/link/out',{root}),/escapes/);
});
for(const debug of [true,false])test(`FW04 static release gate distinguishes debug=${debug} and never invents device acceptance`,t=>{
 const root=fixture(t),dir=path.join(root,'build/web');fs.mkdirSync(path.join(dir,'src'),{recursive:true});fs.writeFileSync(path.join(dir,'index.html'),'demo');fs.writeFileSync(path.join(dir,'src/settings.json'),JSON.stringify({engine:{debug,platform:'web-mobile'}}));
 const report=auditBuild('build/web',{root});assert.equal(report.staticBuildPassed,!debug);assert.equal(report.productionReady,false);assert.equal(report.deviceAcceptance,'not-verified');assert.equal(auditBuild('build/web',{root,platform:'wechat'}).staticBuildPassed,false);
});
test('FW04 optional examples cannot silently pull game code into a distribution',t=>{
 const root=fixture(t),examples=path.join(root,'assets/FrameworkExamples');fs.mkdirSync(examples);fs.writeFileSync(path.join(examples,'Demo.ts'),'import("../Game/Secret");');
 fs.writeFileSync(path.join(examples,'Demo.ts.meta'),JSON.stringify({uuid:'example-unique'}));fs.writeFileSync(path.join(root,'assets/FrameworkExamples.meta'),JSON.stringify({uuid:'example-directory'}));
 assert.throws(()=>exportFramework('build/package',{root,examples:true}),/unrelated project/);assert.equal(fs.existsSync(path.join(root,'build/package')),false);
});
test('FW04 optional build budget reports actual bytes and blocks oversized artifacts without guessing SDK limits',t=>{
 const root=fixture(t),dir=path.join(root,'build/web');fs.mkdirSync(path.join(dir,'src'),{recursive:true});fs.writeFileSync(path.join(dir,'index.html'),'demo');fs.writeFileSync(path.join(dir,'src/settings.json'),JSON.stringify({engine:{debug:false,platform:'web-mobile'}}));
 const report=auditBuild('build/web',{root,maxBytes:1});assert.equal(report.staticBuildPassed,false);assert.ok(report.totalBytes>1);assert.ok(report.issues.some(x=>x.includes('budget')));assert.throws(()=>auditBuild('build/web',{root,maxBytes:-1}));
});
test('FW04 top-level source/build symlinks are rejected before following project boundaries',t=>{
 const root=fixture(t);fs.renameSync(path.join(root,'build'),path.join(root,'real-build'));fs.symlinkSync(path.join(root,'real-build'),path.join(root,'build'));
 assert.throws(()=>exportFramework('build/out',{root}),/redirected/);
 fs.renameSync(path.join(root,'assets/Framework'),path.join(root,'assets/Original'));fs.symlinkSync(path.join(root,'assets/Original'),path.join(root,'assets/Framework'));
 assert.throws(()=>auditFramework(root),/Symlinks/);
});
