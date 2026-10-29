import test from 'node:test';
import assert from 'node:assert/strict';
import { Node, Component, UITransform, Prefab, JsonAsset, AudioClip, AudioSource, assets, setLoadOverride, physicalLoads } from 'cc';
import { ResManager } from '../assets/Framework/Core/ResManager.ts';
import { LifecycleScope } from '../assets/Framework/Kernel/LifecycleScope.ts';
import { UIManager } from '../assets/Framework/Core/UIManager.ts';
import { UIBase } from '../assets/Framework/Components/UIBase.ts';
import { GameObjectPool } from '../assets/Framework/Core/Pool/GameObjectPool.ts';
import { ConfigManager } from '../assets/Framework/Core/ConfigManager.ts';
import { AudioSystem } from '../assets/Framework/Core/AudioSystem.ts';
import { SequenceManager } from '../assets/Framework/Core/VisualSequence/SequenceManager.ts';
import { Vec3 } from 'cc';
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function clean(){setLoadOverride(null);assets.clear();ResManager.Instance.dispose();}
function prefab(){const p=new Prefab();p.factory=()=>{const node=new Node('View');node.addComponent(UIBase);return node;};return p;}
test('engine-adapter contract shares one mock Asset instance and balances addRef/decRef',async()=>{
 clean();const asset=new JsonAsset();assets.set('shared',asset);
 ResManager.Instance.init({maxIdle:0});const before=physicalLoads;
 const [a,b]=await Promise.all([ResManager.Instance.acquire('shared',JsonAsset),ResManager.Instance.acquire('shared',JsonAsset)]);
 assert.equal(physicalLoads-before,1);assert.equal(asset.refCount,1);a.release();assert.equal(asset.refCount,1);b.release();assert.equal(asset.refCount,0);clean();
});
test('UI load error remains observable and next view can open',async()=>{
 clean();ResManager.Instance.init({maxIdle:0});const root=new Node();root.addComponent(UITransform);UIManager.Instance.init(root);
 await assert.rejects(UIManager.Instance.openUI('missing','missing'));
 assets.set('view',prefab());await UIManager.Instance.openUI('ok','view');assert.deepEqual(UIManager.Instance.opened,['ok']);
 UIManager.Instance.dispose();assert.equal(ResManager.Instance.getDebugInfo().owners,0);clean();
});
test('cached UI holds prefab until destroy and repeats show/hide cleanup',async()=>{
 clean();ResManager.Instance.init({maxIdle:0});const p=prefab();assets.set('view',p);
 const root=new Node();root.addComponent(UITransform);UIManager.Instance.init(root);UIManager.Instance.register('view',{path:'view',cache:'keep',modal:true});
 const ui=await UIManager.Instance.openUI('view');UIManager.Instance.closeUI('view');assert.equal(p.refCount,1);
 assert.equal(await UIManager.Instance.openUI('view'),ui);UIManager.Instance.destroyUI('view');assert.equal(p.refCount,0);
 UIManager.Instance.dispose();clean();
});
test('closing a loading UI discards late prefab without mounting it',async()=>{
 clean();ResManager.Instance.init({maxIdle:0});const root=new Node();root.addComponent(UITransform);UIManager.Instance.init(root);
 let finish;setLoadOverride((path,type,cb)=>{finish=cb;});
 const request=UIManager.Instance.openUI('late','late');await turn();UIManager.Instance.closeUI('late');await assert.rejects(request);
 const p=prefab();finish(null,p);await turn();assert.equal(p.refCount,0);assert.equal(UIManager.Instance.opened.length,0);
 UIManager.Instance.dispose();clean();
});
test('missing UIBase cleans instantiated node and resource',async()=>{
 clean();ResManager.Instance.init({maxIdle:0});const root=new Node();root.addComponent(UITransform);UIManager.Instance.init(root);
 const p=new Prefab();assets.set('bad',p);await assert.rejects(UIManager.Instance.openUI('bad','bad'));
 assert.equal(p.refCount,0);UIManager.Instance.dispose();clean();
});
test('object pool invokes Component hooks and rejects duplicate return',()=>{
 const pool=new GameObjectPool(),p=new Prefab();let spawns=0,recycles=0;
 class Member extends Component{onSpawn(){spawns++;}onRecycle(){recycles++;}}
 p.factory=()=>{const n=new Node();n.addComponent(Member);return n;};pool.registerPrefab('p',p,{capacity:1});
 const a=pool.spawn('p');pool.recycle(a);assert.throws(()=>pool.recycle(a));assert.equal(pool.spawn('p'),a);pool.recycle(a);
 assert.equal(spawns,2);assert.equal(recycles,2);pool.clearAll();assert.equal(p.refCount,0);
});
test('config tables distinguish identical paths in different bundles',async()=>{
 clean();ResManager.Instance.init({maxIdle:0});const asset=new JsonAsset();asset.json=[{id:1,value:'a'}];assets.set('table',asset);
 await ConfigManager.Instance.loadTable('table','a');await ConfigManager.Instance.loadTable('table','b');
 assert.equal(ConfigManager.Instance.query('table',1,'a').value,'a');
 ConfigManager.Instance.unloadTable('table','a');assert.equal(ConfigManager.Instance.query('table',1,'a'),undefined);
 assert.equal(ConfigManager.Instance.query('table',1,'b').value,'a');ConfigManager.Instance.dispose();assert.equal(asset.refCount,0);clean();
});
test('audio voice cap and ENDED cleanup do not depend on gameplay timers',async()=>{
 clean();ResManager.Instance.init({maxIdle:0});const clip=new AudioClip();assets.set('sound',clip);const root=new Node();
 AudioSystem.Instance.init(root,1);assert.equal(await AudioSystem.Instance.playSound('sound'),true);
 assert.equal(await AudioSystem.Instance.playSound('sound'),false);root.children[0].emit(AudioSource.EventType.ENDED);
 assert.equal(clip.refCount,0);AudioSystem.Instance.dispose();clean();
});
test('effect context cancel removes tasks and only recycles dummies once',()=>{
 const pool=GameObjectPool.Instance,p=new Prefab();pool.registerPrefab('dummy',p);
 const dummy=pool.spawn('dummy');let completed=0,canceled=0;
 const effect={playPhase1(){},playPhase2(){},cancel(){canceled++;}};
 const ctx=SequenceManager.play(effect,[dummy],new Vec3(),()=>completed++);ctx.cancel();ctx.cancel();SequenceManager.cancelAll();
 assert.equal(completed,0);assert.equal(canceled,1);assert.equal(pool.getDebugInfo().idle,1);pool.clearAll();
});

test('pool clear recycles active nodes and releases prefab exactly once',()=>{
 const pool=new GameObjectPool(),p=new Prefab();pool.registerPrefab('active',p);
 const node=pool.spawn('active');pool.clearAll();assert.equal(node.isValid,false);assert.equal(p.refCount,0);pool.clearAll();assert.equal(p.refCount,0);
});
test('UI can reopen immediately after canceling an earlier load',async()=>{
 clean();ResManager.Instance.init({maxIdle:0});const root=new Node();root.addComponent(UITransform);UIManager.Instance.init(root);
 let finish;setLoadOverride((path,type,cb)=>{finish=cb;});
 const first=UIManager.Instance.openUI('v','v');await turn();UIManager.Instance.closeUI('v');
 const second=UIManager.Instance.openUI('v','v');await assert.rejects(first);const p=prefab();finish(null,p);
 await second;assert.equal(UIManager.Instance.opened.length,1);UIManager.Instance.dispose();assert.equal(p.refCount,0);clean();
});
test('config unload during chunked indexing rejects stale result',async()=>{
 clean();ResManager.Instance.init({maxIdle:0});const a=new JsonAsset();a.json=Array.from({length:5000},(_,id)=>({id}));assets.set('large',a);
 const pending=ConfigManager.Instance.loadTable('large');
 for(let i=0;i<20;i++)await Promise.resolve();
 ConfigManager.Instance.unloadTable('large');await assert.rejects(pending);
 assert.equal(ConfigManager.Instance.query('large',1),undefined);assert.equal(a.refCount,0);ConfigManager.Instance.dispose();clean();
});
test('asset load cancellation is isolated from a separately owned view',async()=>{
 clean();ResManager.Instance.init({maxIdle:0});const scope=new LifecycleScope(),a=new JsonAsset();assets.set('a',a);
 const [owned,scoped]=await Promise.all([ResManager.Instance.acquire('a',JsonAsset),ResManager.Instance.acquire('a',JsonAsset,{scope})]);
 scope.dispose();assert.equal(scoped.released,true);assert.equal(a.refCount,1);owned.release();assert.equal(a.refCount,0);clean();
});
test('synchronous effect completion tolerates duplicate strategy callbacks',()=>{
 const p=new Prefab(),pool=GameObjectPool.Instance;pool.registerPrefab('sync',p);const node=pool.spawn('sync');let n=0;
 SequenceManager.play({playPhase1(nodes,ctx,done){done();done();},playPhase2(ctx,done){done();done();}},[node],new Vec3(),()=>n++);
 assert.equal(n,1);assert.equal(pool.getDebugInfo().idle,1);SequenceManager.cancelAll();pool.clearAll();
});

test('audio caps pending loads as well as playing voices',async()=>{
 clean();ResManager.Instance.init({maxIdle:0});let finish;setLoadOverride((path,type,cb)=>{finish=cb;});
 AudioSystem.Instance.init(new Node(),1);const first=AudioSystem.Instance.playSound('slow');
 assert.equal(await AudioSystem.Instance.playSound('second'),false);await turn();
 finish(null,new AudioClip());assert.equal(await first,true);AudioSystem.Instance.dispose();clean();
});
test('disposing audio discards late sound without creating a ghost voice',async()=>{
 clean();ResManager.Instance.init({maxIdle:0});let finish;setLoadOverride((path,type,cb)=>{finish=cb;});
 const root=new Node();AudioSystem.Instance.init(root,1);const first=AudioSystem.Instance.playSound('late');await turn();
 AudioSystem.Instance.dispose();await assert.rejects(first);const clip=new AudioClip();finish(null,clip);await turn();
 assert.equal(root.children.length,0);assert.equal(clip.refCount,0);clean();
});

test('preload critical failure releases successful peers',async()=>{
 clean();ResManager.Instance.init({maxIdle:0});const {PreloadManager}=await import('../assets/Framework/Core/PreloadManager.ts');
 const a=new JsonAsset();assets.set('ok',a);const scope=new LifecycleScope();
 await assert.rejects(PreloadManager.Instance.load([{id:'ok',path:'ok',type:JsonAsset},{id:'bad',path:'bad',type:JsonAsset}],scope));
 assert.equal(a.refCount,0);scope.dispose();clean();
});
test('application starts without UI/audio and shuts down presentation before resources',async()=>{
 clean();const {App}=await import('../assets/Framework/Core/App.ts');
 await App.Instance.init({idleResources:0});await App.Instance.start();App.Instance.update(.016);
 const prefab=new Prefab();GameObjectPool.Instance.registerPrefab('app-owned',prefab);const node=GameObjectPool.Instance.spawn('app-owned');
 await App.Instance.dispose();assert.equal(prefab.refCount,0);assert.equal(node.isValid,false);
 await App.Instance.init();await App.Instance.start();await App.Instance.dispose();clean();
});
