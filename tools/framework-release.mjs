import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function walk(root){
 if(fs.lstatSync(root).isSymbolicLink())throw Error('Symlinks are not allowed in framework distribution');
 const result=[];
 for(const entry of fs.readdirSync(root,{withFileTypes:true})){
  const file=path.join(root,entry.name);if(entry.isSymbolicLink())throw Error('Symlinks are not allowed in framework distribution');
  if(entry.isDirectory())result.push(...walk(file));else if(entry.isFile())result.push(file);
 }
 return result.sort();
}
/** 中文注释：只审核框架与可选独立示例，禁止把Game、UI素材或项目设置混入复用包。 */
export function auditFramework(root=project){
 const base=path.join(root,'assets/Framework'),files=walk(base),uuids=new Set(),issues=[];
 for(const file of files){
  const relative=path.relative(root,file),text=fs.readFileSync(file,'utf8');
  if(file.endsWith('.meta')){const meta=JSON.parse(text);if(!meta.uuid||uuids.has(meta.uuid))issues.push(relative+': invalid/duplicate UUID');uuids.add(meta.uuid);}
  if(!file.endsWith('.ts'))continue;
  if(!fs.existsSync(file+'.meta'))issues.push(relative+': missing meta');
  for(const match of text.matchAll(/(?:from\s+|import\s*(?:\(\s*)?)['"]([^'"]+)['"]/g)){
   const target=match[1];if(target==='cc'||target==='cc/env')continue;
   if(!target.startsWith('.')){issues.push(relative+': external dependency '+target);continue;}
   const absolute=path.resolve(path.dirname(file),target);if(absolute!==base&&!absolute.startsWith(base+path.sep))issues.push(relative+': dependency outside framework '+target);
  }
 }
 return{files:files.map(file=>({path:path.relative(root,file).split(path.sep).join('/'),sha256:sha(fs.readFileSync(file))})),sourceFiles:files.filter(f=>f.endsWith('.ts')).length,issues};
}
export function exportFramework(output,{root=project,examples=false}={}){
 const audit=auditFramework(root);if(audit.issues.length)throw Error(audit.issues.join('\n'));
 const build=path.resolve(root,'build'),target=path.resolve(root,output);
 if(!target.startsWith(build+path.sep)||fs.existsSync(target))throw Error('Export target must be a new directory inside this project/build');
 // Resolve the existing ancestor so a symlink cannot redirect output into another project.
 let ancestor=path.dirname(target);while(!fs.existsSync(ancestor))ancestor=path.dirname(ancestor);
 const realBuild=fs.realpathSync(build),realAncestor=fs.realpathSync(ancestor);
 if(realBuild!==path.join(fs.realpathSync(root),'build'))throw Error('Build root must not be redirected');
 if(realAncestor!==realBuild&&!realAncestor.startsWith(realBuild+path.sep))throw Error('Export ancestor escapes build');
 const files=audit.files.map(file=>file.path);
 if(fs.existsSync(path.join(root,'assets/Framework.meta')))files.push('assets/Framework.meta');
 if(examples){
  const exampleRoot=path.join(root,'assets/FrameworkExamples'),frameworkRoot=path.join(root,'assets/Framework');
  const examples=walk(exampleRoot),uuids=new Set(audit.files.filter(f=>f.path.endsWith('.meta')).map(f=>JSON.parse(fs.readFileSync(path.join(root,f.path),'utf8')).uuid));
  for(const file of examples){
   const text=fs.readFileSync(file,'utf8');
   if(file.endsWith('.meta')){const uuid=JSON.parse(text).uuid;if(!uuid||uuids.has(uuid))throw Error('Example metadata collision');uuids.add(uuid);}
   if(!file.endsWith('.ts'))continue;
   if(!fs.existsSync(file+'.meta'))throw Error('Example script is missing metadata');
   for(const match of text.matchAll(/(?:from\s+|import\s*(?:\(\s*)?)['"]([^'"]+)['"]/g)){
    const name=match[1];if(name==='cc'||name==='cc/env')continue;const target=path.resolve(path.dirname(file),name);
    if(!name.startsWith('.')||(!target.startsWith(exampleRoot+path.sep)&&!target.startsWith(frameworkRoot+path.sep)))throw Error('Example depends on unrelated project code');
   }
  }
  files.push(...examples.map(file=>path.relative(root,file)));files.push('assets/FrameworkExamples.meta');
 }
 // Read and validate the complete package before creating the output directory.
 const contents=files.map(file=>{const absolute=path.join(root,file);if(fs.lstatSync(absolute).isSymbolicLink())throw Error('Symlinks are not allowed in framework distribution');return{file,bytes:fs.readFileSync(absolute)};});
 fs.mkdirSync(target,{recursive:true});
 for(const {file,bytes} of contents){const dest=path.join(target,file);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,bytes);
  const original=path.join(root,file.slice(0,-5));if(file.endsWith('.meta')&&fs.existsSync(original)&&fs.statSync(original).isDirectory())fs.mkdirSync(dest.slice(0,-5),{recursive:true});
 }
 fs.writeFileSync(path.join(target,'README.md'),[
  '# Cocos通用框架导出包','',
  '目标Creator 3.8.8；无第三方依赖。将assets/Framework及其meta复制到已创建的Cocos工程，保留UUID。',
  '可选示例：assets/FrameworkExamples/FrameworkDemo.scene（含独立framework-demo资源Bundle），不需要Game或原项目UI。',
  '来源仓库内README的需求/进度链接仅在来源工程有效；本包的接入边界以下述约定为准。','',
  '- 每个活动App只允许一个帧驱动；通用FrameworkBootstrap与项目/示例驱动不能同时启动。',
  '- App.init/start/dispose均await；UI/音频显式传入根节点，模块用dependencies声明资源依赖。',
  '- RuntimeLifecycle为可选模块，传入统一PauseController组合后台、菜单、广告等暂停。保存须显式注入flush，不默认写盘。',
  '- ViewportService按物理像素统一相机映射；只修改调用方传入的节点/相机，不改项目设计分辨率。',
  '- ResourceHandle/Scope管理资源；节点先停用/销毁，再释放资产；不得直接强制卸载共享资源。',
  '- PlatformRuntime按能力检测；低内存只清闲置内存资源，磁盘LRU需显式调用。Bundle版本由项目注册。',
  '- 本包没有登录/云存档/支付/广告奖励策略，也没有通过复制获得微信真机或发布验收。','',
  'framework-manifest.json记录复制时的实际文件哈希；它不是权限机制，也不替代运行测试。',''
 ].join('\n'));
 const manifest={schemaVersion:1,creator:'3.8.8',examples,files:contents.map(({file,bytes})=>({path:file.split(path.sep).join('/'),sha256:sha(bytes)}))};
 fs.writeFileSync(path.join(target,'framework-manifest.json'),JSON.stringify(manifest,null,2)+'\n');return manifest;
}
export function auditBuild(build,{root=project,platform='web',maxBytes}={}){
 if(!['web','wechat'].includes(platform))throw Error('Unknown build platform');
 const directory=path.resolve(root,build),allowed=path.resolve(root,'build');
 if(!directory.startsWith(allowed+path.sep)||!fs.existsSync(directory))throw Error('Build must exist inside project/build');
 const real=fs.realpathSync(directory),realAllowed=fs.realpathSync(allowed);if(realAllowed!==path.join(fs.realpathSync(root),'build')||!real.startsWith(realAllowed+path.sep))throw Error('Build path escapes project');
 const settingsPath=path.join(directory,'src/settings.json');
 const settings=fs.existsSync(settingsPath)?JSON.parse(fs.readFileSync(settingsPath,'utf8')):undefined;
 const entry=path.join(directory,platform==='web'?'index.html':'game.js'),issues=[];
 const files=walk(directory),totalBytes=files.reduce((sum,file)=>sum+fs.statSync(file).size,0);
 if(maxBytes!==undefined&&(!Number.isSafeInteger(maxBytes)||maxBytes<=0))throw Error('Invalid build byte budget');
 if(maxBytes!==undefined&&totalBytes>maxBytes)issues.push('Build exceeds configured byte budget');
 if(!fs.existsSync(entry))issues.push('Missing platform entry');
 if(!settings)issues.push('Missing Cocos settings');else if(settings.engine?.debug!==false)issues.push('Debug build is not release');
 if(settings&&((platform==='web'&&!String(settings.engine?.platform).startsWith('web-'))||(platform==='wechat'&&settings.engine?.platform!=='wechatgame')))issues.push('Platform mismatch');
 return{platform,entryHash:fs.existsSync(entry)?sha(fs.readFileSync(entry)):null,fileCount:files.length,totalBytes,maxBytes:maxBytes??null,staticBuildPassed:issues.length===0,issues,
  deviceAcceptance:'not-verified',productionReady:false,note:'Static audit does not certify runtime, WeChat DevTools, real devices, ads or publication.'};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const args=process.argv.slice(2),command=args[0]??'audit';let result;
  if(command==='audit')result=auditFramework();
  else if(command==='export')result=exportFramework(args[1]??'',{examples:args.includes('--examples')});
  else if(command==='build'){const budget=args.find(arg=>arg.startsWith('--max-bytes='));result=auditBuild(args[1]??'',{platform:args.includes('--wechat')?'wechat':'web',maxBytes:budget?Number(budget.slice(12)):undefined});}
  else throw Error('Use audit | export build/<new-directory> [--examples] | build build/<directory> [--wechat]');
  console.log(JSON.stringify(result,null,2));if(result.issues?.length)process.exitCode=1;
 }catch(error){console.error(error.message);process.exitCode=1;}
}
