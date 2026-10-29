import test from 'node:test';
import assert from 'node:assert/strict';
import { ModuleHost } from '../assets/Framework/Kernel/ModuleHost.ts';
import { EventBus } from '../assets/Framework/Kernel/EventBus.ts';
import { LifecycleScope } from '../assets/Framework/Kernel/LifecycleScope.ts';
import { ResourceCache, ResourceCanceledError } from '../assets/Framework/Kernel/ResourceCache.ts';
import { StorageStore } from '../assets/Framework/Kernel/StorageStore.ts';
import { TaskScheduler } from '../assets/Framework/Kernel/TaskScheduler.ts';
import { StateStore } from '../assets/Framework/Kernel/StateStore.ts';
import { StateMachine } from '../assets/Framework/Core/FSM/StateMachine.ts';
const defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const turn=()=>new Promise(resolve=>setImmediate(resolve));

test('module initialization awaits dependencies; start coalesces; disposal reverses',async()=>{
 const host=new ModuleHost(),gate=defer(),calls=[];
 host.register('consumer',{dependencies:['base'],init(){calls.push('consumer');},dispose(){calls.push('consumer:off');}});
 host.register('base',{async init(){calls.push('base');await gate.promise;},dispose(){calls.push('base:off');}});
 const a=host.start(),b=host.start();assert.equal(a,b);await turn();assert.deepEqual(calls,['base']);
 gate.resolve();await a;assert.equal(host.state,'running');await host.dispose();
 assert.deepEqual(calls,['base','consumer','consumer:off','base:off']);assert.equal(host.state,'disposed');
});
test('invalid dependency graph fails before side effects',async()=>{
 for(const mode of ['missing','cycle']){
  const host=new ModuleHost();let initialized=0;
  host.register('a',{dependencies:[mode==='cycle'?'b':'absent'],init(){initialized++;}});
  if(mode==='cycle')host.register('b',{dependencies:['a']});
  await assert.rejects(host.init());assert.equal(initialized,0);
 }
});
test('failed module initialization includes partial module in rollback',async()=>{
 const host=new ModuleHost(),calls=[];
 host.register('a',{dispose(){calls.push('a');}}).register('b',{init(){throw Error('bad');},dispose(){calls.push('b');}});
 await assert.rejects(host.start());assert.deepEqual(calls,['b','a']);await host.dispose();assert.equal(calls.length,2);
});
test('disposal continues after cleanup exceptions and runs once',async()=>{
 const host=new ModuleHost();let count=0;
 host.register('a',{dispose(){count++;}}).register('b',{dispose(){count++;throw Error('bad cleanup');}});
 await host.start();const a=host.dispose();assert.equal(a,host.dispose());await assert.rejects(a);assert.equal(count,2);
});
test('dispose during async initialization waits and prevents future update',async()=>{
 const host=new ModuleHost(),gate=defer();let ticks=0;
 host.register('slow',{async init(){await gate.promise;},update(){ticks++;}});
 const started=host.start();await turn();const ended=host.dispose();gate.resolve();await started;await ended;host.update(.1);assert.equal(ticks,0);
});
test('module update requires running host and rejects invalid dt',async()=>{
 const host=new ModuleHost();let n=0;host.register('a',{update(){n++;}});
 host.update(1);await host.start();host.update(.1);assert.equal(n,1);
 assert.throws(()=>host.update(NaN));assert.throws(()=>host.register('late',{}));await host.dispose();
});
test('once listener is removed before recursive emit',()=>{
 const bus=new EventBus();let n=0;bus.once('event',()=>{n++;bus.emit('event');});bus.emit('event');assert.equal(n,1);
});
test('unsubscribe during dispatch, addition and clear have deterministic behavior',()=>{
 const bus=new EventBus(),calls=[];let cancel=()=>{};
 bus.on('x',()=>{calls.push(1);cancel();bus.on('x',()=>calls.push(3));});cancel=bus.on('x',()=>calls.push(2));
 bus.emit('x');assert.deepEqual(calls,[1]);bus.emit('x');assert.deepEqual(calls,[1,1,3]);
 bus.clear();assert.equal(bus.count(),0);
});
test('listener errors do not skip later listeners; error remains visible',()=>{
 const bus=new EventBus();let reached=false;bus.on('x',()=>{throw Error('bad');});bus.on('x',()=>{reached=true;});
 assert.throws(()=>bus.emit('x'));assert.equal(reached,true);
});
test('scope reverse cleanup, child detachment, late registration and repeated disposal',()=>{
 const scope=new LifecycleScope(),calls=[];
 scope.add(()=>calls.push(1));scope.add(()=>calls.push(2));
 const child=scope.child();child.add(()=>calls.push(3));child.dispose();assert.equal(scope.size,2);
 scope.dispose();scope.dispose();scope.add(()=>calls.push(4));assert.deepEqual(calls,[3,2,1,4]);
});
test('scope continues cleanup after error',()=>{
 const scope=new LifecycleScope();let n=0;scope.add(()=>n++);scope.add(()=>{throw Error('bad');});
 assert.throws(()=>scope.dispose());assert.equal(n,1);assert.equal(scope.isActive,false);
});
test('scope construction rollback preserves original failure and reverses acquired owners',()=>{
 const scope=new LifecycleScope(),calls=[],original=Error('construct');
 scope.add(()=>calls.push('first'));scope.add(()=>calls.push('last'));
 assert.throws(()=>scope.rollback(original),error=>error===original);
 assert.deepEqual(calls,['last','first']);assert.equal(scope.isActive,false);scope.dispose();
});
test('scope rollback retains cleanup failure without skipping remaining owners',()=>{
 const scope=new LifecycleScope(),original=Error('construct'),cleanup=Error('cleanup');let released=0;
 scope.add(()=>released++);scope.add(()=>{throw cleanup;});
 assert.throws(()=>scope.rollback(original),error=>{
  assert.equal(error.causes[0],original);assert.equal(error.causes[1].causes[0],cleanup);return true;
 });
 assert.equal(released,1);scope.dispose();assert.equal(released,1);
});
test('timer cancellation/addition during callback is safe',()=>{
 const clock=new TaskScheduler(),calls=[];let later;
 clock.add(0,()=>{calls.push('first');clock.remove(later);clock.add(0,()=>calls.push('new'));});
 later=clock.add(0,()=>calls.push('canceled'));clock.tick(.1);assert.deepEqual(calls,['first']);clock.tick(.1);assert.deepEqual(calls,['first','new']);assert.equal(clock.size,0);
});
test('UI clock ignores gameplay scale; paused group retains timer',()=>{
 const clock=new TaskScheduler();let ui=0,game=0;
 clock.timeScale=0;clock.add(.1,()=>ui++,{group:'ui'});clock.add(.1,()=>game++);
 clock.tick(.1);assert.equal(ui,1);assert.equal(game,0);clock.timeScale=1;
 clock.setGroup('game',true);clock.tick(1);assert.equal(game,0);clock.setGroup('game',false);clock.tick(.1);assert.equal(game,1);
});
test('large frame gap has bounded catch-up and invalid input is rejected',()=>{
 const clock=new TaskScheduler();let n=0;clock.add(.001,()=>n++,{repeat:0});clock.tick(100);assert.equal(n,4);
 assert.throws(()=>clock.add(-1,()=>{}));assert.throws(()=>clock.tick(Infinity));clock.clear();assert.equal(clock.size,0);
});
test('throwing timer removed and unrelated timer still runs',()=>{
 const clock=new TaskScheduler();let ran=false;clock.add(0,()=>{throw Error('bad');});clock.add(0,()=>{ran=true;});
 assert.throws(()=>clock.tick(.1));assert.equal(ran,true);assert.equal(clock.size,0);
});
function cacheFixture(maxIdle=0,concurrency=2){
 let loads=0,refs=0;const gates=new Map();
 const driver={async load(key){loads++;if(gates.has(key))await gates.get(key).promise;return{key};},retain(){refs++;},release(){refs--;}};
 return{cache:new ResourceCache(driver,concurrency,maxIdle),gates,get loads(){return loads;},get refs(){return refs;}};
}
test('same asset deduplicates physical loading and holds until every owner releases',async()=>{
 const f=cacheFixture();const [a,b]=await Promise.all([f.cache.acquire('a'),f.cache.acquire('a')]);
 assert.equal(f.loads,1);assert.equal(a.value,b.value);assert.equal(f.refs,1);
 a.release();a.release();assert.equal(f.refs,1);b.release();assert.equal(f.refs,0);f.cache.dispose();
});
test('resource cancellation immediately releases owner and cleans late result',async()=>{
 const f=cacheFixture(),scope=new LifecycleScope(),gate=defer();f.gates.set('a',gate);
 const request=f.cache.acquire('a',{scope});await turn();scope.dispose();
 await assert.rejects(request,ResourceCanceledError);assert.equal(f.cache.stats().owners,0);
 gate.resolve();await turn();assert.equal(f.refs,0);f.cache.dispose();
});
test('one canceled consumer does not cancel another shared consumer',async()=>{
 const f=cacheFixture(),scope=new LifecycleScope(),gate=defer();f.gates.set('a',gate);
 const a=f.cache.acquire('a',{scope}),b=f.cache.acquire('a');scope.dispose();await assert.rejects(a);
 gate.resolve();const handle=await b;assert.equal(f.refs,1);handle.release();assert.equal(f.refs,0);f.cache.dispose();
});
test('timeout does not duplicate a still-running physical request',async()=>{
 const f=cacheFixture(),gate=defer();f.gates.set('a',gate);
 await assert.rejects(f.cache.acquire('a',{timeoutMs:5}));
 const pending=f.cache.acquire('a');gate.resolve();const h=await pending;assert.equal(f.loads,1);h.release();f.cache.dispose();
});
test('load concurrency is bounded and idle cache is bounded',async()=>{
 const f=cacheFixture(1,2),gate=defer();for(const key of ['a','b','c'])f.gates.set(key,gate);
 const jobs=['a','b','c'].map(key=>f.cache.acquire(key));await turn();
 assert.equal(f.cache.stats().loading,2);assert.equal(f.cache.stats().queued,1);
 gate.resolve();const handles=await Promise.all(jobs);handles.forEach(h=>h.release());
 assert.equal(f.cache.stats().entries,1);assert.equal(f.cache.stats().peakConcurrency,2);
 f.cache.clearIdle();assert.equal(f.refs,0);f.cache.dispose();
});
test('failed resource can be retried and owned resources cannot be force-disposed',async()=>{
 let n=0;const cache=new ResourceCache({async load(){if(!n++)throw Error('fail');return{};},retain(){},release(){}},1,0);
 await assert.rejects(cache.acquire('a'));const h=await cache.acquire('a');assert.throws(()=>cache.dispose());h.release();cache.dispose();
 await assert.rejects(cache.acquire('a'));
});
test('disposing a cache with abandoned physical requests safely releases late resources',async()=>{
 const f=cacheFixture(),scope=new LifecycleScope(),gate=defer();f.gates.set('a',gate);
 const request=f.cache.acquire('a',{scope});await turn();scope.dispose();await assert.rejects(request);
 f.cache.dispose();gate.resolve();await turn();assert.equal(f.refs,0);assert.equal(f.cache.stats().entries,0);
});
test('storage failure preserves dirty revision and retry persists it',async()=>{
 let fail=true,writes=0;const store=new StorageStore({async read(){return null;},async write(){writes++;if(fail)throw Error('disk');}},'test:v1');
 await store.init();store.set('value',1);await assert.rejects(store.flush());assert.equal(store.dirty,true);
 fail=false;await store.flush();assert.equal(store.dirty,false);assert.equal(writes,2);
});
test('storage serializes concurrent flushes and saves mutations during write',async()=>{
 const gate=defer(),writes=[];const store=new StorageStore({async read(){return null;},async write(k,v){writes.push(JSON.parse(v));if(writes.length===1)await gate.promise;}},'test:v1');
 await store.init();store.set('x',1);const a=store.flush();store.set('x',2);assert.equal(a,store.flush());
 gate.resolve();await a;assert.equal(writes.length,2);assert.equal(writes[1].data.x,2);assert.equal(store.dirty,false);
});
test('storage validates schema and snapshots values against external mutation',async()=>{
 const store=new StorageStore({async read(){return null;},async write(){}},'test');
 await store.init();const value={a:1};store.set('key',value);value.a=99;
 const copy=store.get('key',null);copy.a=7;assert.equal(store.get('key',null).a,1);
 assert.throws(()=>store.set('bad',undefined));
 const corrupt=new StorageStore({async read(){return '{"version":2,"data":{}}';},async write(){}},'test');
 await assert.rejects(corrupt.init());
});
test('state store cancels watchers and reports watcher errors',()=>{
 const store=new StateStore();let n=0;const off=store.watch('x',()=>n++);store.set('x',1);store.set('x',1);off();store.set('x',2);assert.equal(n,1);
 store.watch('x',()=>{throw Error('bad');});assert.throws(()=>store.set('x',3));store.clear();assert.equal(store.get('x'),undefined);
});
test('FSM rejects reentry and leaves no active state after failed enter',()=>{
 const machine=new StateMachine({});machine.registerState('a',{onEnter(){}});machine.registerState('b',{onEnter(){machine.changeState('a');}});
 machine.changeState('a');assert.throws(()=>machine.changeState('b'));assert.equal(machine.getCurrentStateId(),null);machine.destroy();
});

test('disposal requested during initialization suppresses start callbacks',async()=>{
 const host=new ModuleHost(),gate=defer();let started=0;
 host.register('a',{async init(){await gate.promise;},start(){started++;}});
 const start=host.start();await turn();const end=host.dispose();gate.resolve();await start;await end;assert.equal(started,0);
});
test('invalid acquisition options do not start a physical request',async()=>{
 const f=cacheFixture();await assert.rejects(f.cache.acquire('a',{timeoutMs:0}));assert.equal(f.loads,0);f.cache.dispose();
});
test('scope-bound handle releases automatically after successful acquisition',async()=>{
 const f=cacheFixture(),scope=new LifecycleScope();const handle=await f.cache.acquire('a',{scope});
 assert.equal(f.refs,1);scope.dispose();assert.equal(handle.released,true);assert.equal(f.refs,0);f.cache.dispose();
});
test('queued loads cancel when cache shuts down without leaking driver references',async()=>{
 const f=cacheFixture(0,1),gate=defer(),scope=new LifecycleScope();f.gates.set('a',gate);
 const a=f.cache.acquire('a',{scope}),b=f.cache.acquire('b',{scope});await turn();scope.dispose();
 await Promise.all([assert.rejects(a),assert.rejects(b)]);f.cache.dispose();gate.resolve();await turn();assert.equal(f.refs,0);
});
test('storage retains a prototype-like key without prototype pollution',async()=>{
 const store=new StorageStore({async read(){return null;},async write(){}},'test');
 await store.init();store.set('__proto__',{safe:true});assert.equal(store.get('__proto__',null).safe,true);assert.equal({}.safe,undefined);
});
