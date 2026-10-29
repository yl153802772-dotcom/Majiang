import test from 'node:test';
import assert from 'node:assert/strict';
import { assetManager, assets, JsonAsset, sys } from 'cc';
import { LifecycleScope } from '../assets/Framework/Kernel/LifecycleScope.ts';
import { asyncOperation, OperationCanceledError, OperationTimeoutError } from '../assets/Framework/Kernel/AsyncOperation.ts';
import { PlatformManager, HttpStatusError } from '../assets/Framework/Core/Platform/PlatformManager.ts';
import { PlatformRuntime } from '../assets/Framework/Core/Platform/PlatformRuntime.ts';
import { SubpackageLoader } from '../assets/Framework/Core/Platform/SubpackageLoader.ts';
import { BundleManager } from '../assets/Framework/Core/BundleManager.ts';
import { ResManager } from '../assets/Framework/Core/ResManager.ts';
import { HttpManager } from '../assets/Framework/Core/Net/HttpManager.ts';
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function wechat(t,wx){const old=sys.platform,oldWx=globalThis.wx;sys.platform=sys.Platform.WECHAT_GAME;globalThis.wx=wx;t.after(()=>{sys.platform=old;globalThis.wx=oldWx;});return new PlatformManager().adapter;}
test('FW03 invalid timeout/closed scope starts no native operation',async()=>{let starts=0;const scope=new LifecycleScope();scope.dispose();
 await assert.rejects(asyncOperation(()=>{starts++;},{scope}),OperationCanceledError);await assert.rejects(asyncOperation(()=>{starts++;},{timeoutMs:0}));assert.equal(starts,0);
});
test('FW03 native cancellation settles immediately, aborts once and ignores late success',async()=>{
 const scope=new LifecycleScope();let resolve,aborts=0;const promise=asyncOperation(done=>{resolve=done;return()=>aborts++;},{scope});const canceled=assert.rejects(promise,OperationCanceledError);
 scope.dispose();await canceled;resolve('late');scope.dispose();assert.equal(aborts,1);
});
test('FW03 timeout rejects even if a native task never calls back',async()=>{let aborts=0;await assert.rejects(asyncOperation(()=>()=>aborts++,{timeoutMs:3}),OperationTimeoutError);assert.equal(aborts,1);});
test('FW03 synchronous native completion and cancellation before task return are safe',async()=>{
 assert.equal(await asyncOperation(resolve=>resolve(7)),7);const scope=new LifecycleScope();let aborts=0;
 await assert.rejects(asyncOperation(()=>{scope.dispose();return()=>aborts++;},{scope}),OperationCanceledError);assert.equal(aborts,1);
});
test('FW03 wx HTTP timeout aborts a RequestTask and a late callback cannot revive it',async t=>{
 let options,aborts=0;const adapter=wechat(t,{request(value){options=value;return{abort(){aborts++;}};}});
 await assert.rejects(adapter.request({url:'https://example.invalid/read',method:'GET',timeoutMs:3}),OperationTimeoutError);
 options.success({statusCode:200,data:'late'});assert.equal(aborts,1);
});
test('FW03 wx scope cancellation does not leak its owner and HTTP errors preserve status',async t=>{
 let options,aborts=0;const adapter=wechat(t,{request(value){options=value;return{abort(){aborts++;}};}}),scope=new LifecycleScope();
 const request=adapter.request({url:'https://example.invalid/read',method:'GET',scope}),rejected=assert.rejects(request,OperationCanceledError);scope.dispose();await rejected;assert.equal(aborts,1);
 const second=adapter.request({url:'https://example.invalid/read',method:'GET'});options.success({statusCode:503,data:null});await assert.rejects(second,e=>e instanceof HttpStatusError&&e.status===503);
});
test('FW03 Web cancellation aborts fetch without waiting for a noncooperative transport',async t=>{
 const old=globalThis.fetch,platform=sys.platform;sys.platform='web';let signal;globalThis.fetch=(_url,o)=>{signal=o.signal;return new Promise(()=>{});};t.after(()=>{globalThis.fetch=old;sys.platform=platform;});
 const scope=new LifecycleScope(),request=new PlatformManager().adapter.request({url:'https://example.invalid',method:'GET',scope}),canceled=assert.rejects(request,OperationCanceledError);scope.dispose();await canceled;assert.equal(signal.aborted,true);
});
for(const status of [400,503])test(`FW03 explicit GET retry policy respects status ${status}`,async t=>{
 const platform=PlatformManager.Instance,old=platform.adapter;let calls=0;platform.setAdapter({...old,request:async()=>{if(++calls===1)throw new HttpStatusError(status);return'ok';}});t.after(()=>platform.setAdapter(old));
 const manager=new HttpManager();manager.init('https://example.invalid');const request=manager.request('/read',{method:'GET',retries:2,retryDelayMs:0});
 if(status===400){await assert.rejects(request);assert.equal(calls,1);}else{assert.equal(await request,'ok');assert.equal(calls,2);}
 await assert.rejects(manager.request('/write',{method:'POST',retries:1}),/Only GET/);assert.equal(calls,status===400?1:2);manager.dispose();
});
test('FW03 cancellation during retry backoff prevents the next request',async t=>{
 const platform=PlatformManager.Instance,old=platform.adapter;let calls=0;platform.setAdapter({...old,request:async()=>{calls++;throw Error('offline');}});t.after(()=>platform.setAdapter(old));
 const manager=new HttpManager(),scope=new LifecycleScope();manager.init('https://example.invalid');const request=manager.request('/read',{method:'GET',retries:2,retryDelayMs:100,scope}),canceled=assert.rejects(request,OperationCanceledError);
 await turn();scope.dispose();await canceled;assert.equal(calls,1);
});
test('FW03 low-memory hooks evict only idle assets, detach on exit and ignore late events',async()=>{
 const res=ResManager.Instance;res.dispose();res.init({maxIdle:2});const a=new JsonAsset(),b=new JsonAsset();assets.set('fw03-idle',a);assets.set('fw03-owner',b);
 let memory,network,offMemory=0,offNetwork=0,diskCalls=0;const oldCache=assetManager.cacheManager;assetManager.cacheManager={clearLRU(){diskCalls++;}};
 const runtime=new PlatformRuntime({onMemoryWarning(cb){memory=cb;},offMemoryWarning(){offMemory++;},onNetworkStatusChange(cb){network=cb;},offNetworkStatusChange(){offNetwork++;}});
 try{const idle=await res.acquire('fw03-idle',JsonAsset),owner=await res.acquire('fw03-owner',JsonAsset);idle.release();runtime.init();memory({level:10});
  assert.equal(a.refCount,0);assert.equal(b.refCount,1);assert.equal(diskCalls,0);network({isConnected:false,networkType:'none'});assert.equal(runtime.state.network.connected,false);
  assert.equal(runtime.trimEngineDiskCache(),true);assert.equal(diskCalls,1);runtime.dispose();memory({});network({isConnected:true,networkType:'wifi'});
  assert.equal(runtime.state.memoryWarnings,1);assert.equal(runtime.state.network,undefined);assert.equal(offMemory,1);assert.equal(offNetwork,1);owner.release();
 }finally{runtime.dispose();res.dispose();assets.delete('fw03-idle');assets.delete('fw03-owner');assetManager.cacheManager=oldCache;}
});
test('FW03 partial hook registration rollback removes every installed callback',()=>{let off=0;const runtime=new PlatformRuntime({onMemoryWarning(){throw Error('SDK registration');},offMemoryWarning(){off++;}});assert.throws(()=>runtime.init());assert.equal(off,1);runtime.dispose();});
test('FW03 older SDK without off functions is not subscribed and window fallback retains only layout data',()=>{
 let registered=0;const runtime=new PlatformRuntime({onMemoryWarning(){registered++;},getSystemInfoSync(){return{windowWidth:390,windowHeight:844,pixelRatio:3,userId:'never-copy'};},getMenuButtonBoundingClientRect(){return{left:310,top:24,width:70,height:30};}});
 runtime.init();assert.equal(registered,0);assert.equal(runtime.capabilities.memory,false);const metrics=runtime.readWindow();assert.deepEqual(metrics,{width:390,height:844,pixelRatio:3,safeArea:undefined,menu:{left:310,top:24,width:70,height:30}});runtime.dispose();
});
test('FW03 unsupported native capabilities explicitly fail rather than simulate success',async()=>{
 const runtime=new PlatformRuntime({});assert.equal(runtime.readWindow(),undefined);await assert.rejects(runtime.getNetwork(),/unsupported/);await assert.rejects(new SubpackageLoader(runtime).load('code'),/unsupported/);
});
test('FW03 subpackage consumers share physical load, isolate cancellation and own progress callbacks',async()=>{
 let calls=0,options,progress,detached=0;const runtime=new PlatformRuntime({loadSubpackage(value){calls++;options=value;return{onProgressUpdate(cb){progress=cb;},offProgressUpdate(){detached++;}};}}),loader=new SubpackageLoader(runtime),scope=new LifecycleScope();
 const a=loader.load('code',{scope}),canceled=assert.rejects(a),seen=[],b=loader.load('code',{onProgress:p=>seen.push(p.progress)});scope.dispose();await canceled;progress({progress:150,totalBytesWritten:4,totalBytesExpectedToWrite:4});options.success();await b;
 assert.equal(calls,1);assert.deepEqual(seen,[100]);assert.equal(detached,1);await loader.load('code');assert.equal(calls,1);loader.dispose();
});
test('FW03 throwing subpackage progress observer rejects only that consumer',async()=>{
 let options,progress;const runtime=new PlatformRuntime({loadSubpackage(value){options=value;return{onProgressUpdate(cb){progress=cb;}};}}),loader=new SubpackageLoader(runtime);
 const a=loader.load('code',{onProgress(){throw Error('UI progress');}}),failed=assert.rejects(a,/UI progress/),b=loader.load('code');progress({progress:10,totalBytesWritten:1,totalBytesExpectedToWrite:10});await failed;options.success();await b;loader.dispose();
});
test('FW03 timed-out subpackage has no duplicate physical download and disposed callers settle immediately',async()=>{
 let calls=0,options;const runtime=new PlatformRuntime({loadSubpackage(value){calls++;options=value;return{};}}),loader=new SubpackageLoader(runtime);
 await assert.rejects(loader.load('code',{timeoutMs:3}),OperationTimeoutError);const next=loader.load('code'),canceled=assert.rejects(next,OperationCanceledError);assert.equal(calls,1);loader.dispose();await canceled;options.success();await turn();assert.equal(loader.getDebugInfo().loaded,0);loader.dispose();
});
test('FW03 failed native subpackage can retry; invalid requests cause no SDK call',async()=>{
 let calls=0;const loader=new SubpackageLoader(new PlatformRuntime({loadSubpackage(o){calls++;queueMicrotask(()=>calls===1?o.fail(Error('offline')):o.success());return{};}}));
 await assert.rejects(loader.load('../bad'));await assert.rejects(loader.load('code',{timeoutMs:-1}));assert.equal(calls,0);
 await assert.rejects(loader.load('code'));await loader.load('code');assert.equal(calls,2);loader.dispose();
});
test('FW03 registered bundle forwards immutable version and bounded downloader options once',async t=>{
 const original=assetManager.loadBundle;let calls=0,options,done;const bundle={name:'fw03remote'};
 assetManager.loadBundle=(source,value,callback)=>{calls++;assert.equal(source,'https://example.invalid/remote/fw03remote');options=value;done=callback;};t.after(()=>{assetManager.loadBundle=original;BundleManager.releaseBundle('fw03remote');BundleManager.unregister('fw03remote');});
 BundleManager.register('fw03remote',{source:'https://example.invalid/remote/fw03remote',version:'abc123',timeoutMs:5000,retries:1});
 const scope=new LifecycleScope(),a=BundleManager.waitForBundle('fw03remote',{scope}),canceled=assert.rejects(a,OperationCanceledError),b=BundleManager.loadBundle('fw03remote');scope.dispose();await canceled;
 assert.equal(calls,1);assert.deepEqual(options,{version:'abc123',xhrTimeout:5000,maxRetryCount:1});assert.throws(()=>BundleManager.unregister('fw03remote'));done(null,bundle);assert.equal(await b,bundle);
});
test('FW03 bundle registry rejects unsafe sources and cross-alias ownership ambiguity',()=>{
 assert.throws(()=>BundleManager.register('resources',{source:'local'}));assert.throws(()=>BundleManager.register('bad',{source:'http://invalid'}));
 BundleManager.register('fw03a',{source:'https://example.invalid/unique'});assert.throws(()=>BundleManager.register('fw03b',{source:'https://example.invalid/unique'}));BundleManager.unregister('fw03a');
});
test('FW03 releasing one engine bundle alias cannot unload another alias',async t=>{
 const load=assetManager.loadBundle,get=assetManager.getBundle,remove=assetManager.removeBundle,bundle={name:'fw03shared'};let removals=0;
 let alive=true;assetManager.loadBundle=(_url,_options,done)=>done(null,bundle);assetManager.getBundle=name=>name==='fw03shared'&&alive?bundle:get(name);assetManager.removeBundle=()=>{removals++;alive=false;};
 t.after(()=>{assetManager.loadBundle=load;assetManager.getBundle=get;assetManager.removeBundle=remove;});
 BundleManager.register('fw03alias',{source:'https://example.invalid/fw03alias'});await BundleManager.loadBundle('fw03alias');await BundleManager.loadBundle('fw03shared');
 BundleManager.releaseBundle('fw03alias');assert.equal(removals,0);assert.throws(()=>BundleManager.unregister('fw03alias'),/another alias/);BundleManager.releaseBundle('fw03shared');assert.equal(removals,1);BundleManager.unregister('fw03alias');
});
test('FW03 native failure without an error payload is never interpreted as successful download',async()=>{
 const loader=new SubpackageLoader(new PlatformRuntime({loadSubpackage(o){queueMicrotask(()=>o.fail());return{};}}));await assert.rejects(loader.load('code'));assert.equal(loader.getDebugInfo().loaded,0);loader.dispose();
});
