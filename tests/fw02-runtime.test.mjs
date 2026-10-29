import test from 'node:test';
import assert from 'node:assert/strict';
import { PauseController } from '../assets/Framework/Kernel/PauseController.ts';
import { ViewportLayout } from '../assets/Framework/Kernel/ViewportLayout.ts';
import { ViewportService } from '../assets/Framework/Core/ViewportService.ts';
import { RuntimeLifecycle } from '../assets/Framework/Core/RuntimeLifecycle.ts';
import { TimerManager, TimerGroup } from '../assets/Framework/Core/TimerTool/TimerManager.ts';
import { AudioSystem } from '../assets/Framework/Core/AudioSystem.ts';
import { ResManager } from '../assets/Framework/Core/ResManager.ts';
import { AudioClip, AudioSource, Node, UITransform, Widget, assets, game, Game, screen, sys, view } from 'cc';
import { SafeAreaAdapter } from '../assets/Framework/Core/SafeAreaAdapter.ts';
const turn=()=>new Promise(resolve=>setImmediate(resolve));
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
test('FW02 independent leases and background flags never resume another pause owner',()=>{
 const p=new PauseController(), a=p.hold('dialog'), b=p.hold('dialog');p.set('background',true);
 assert.deepEqual(p.snapshot.reasons,['background','dialog']);a();p.set('background',false);assert.equal(p.isPaused,true);b();assert.equal(p.isPaused,false);b();
 p.dispose();assert.throws(()=>p.hold('late'));a();
});
test('FW02 immutable snapshots cannot mutate pause state and observer errors do not skip others',()=>{
 const p=new PauseController();let calls=0;p.subscribe(()=>{throw Error('observer');});p.subscribe(()=>calls++);
 assert.throws(()=>p.set('menu',true));assert.equal(calls,1);assert.equal(p.isPaused,true);assert.throws(()=>p.snapshot.reasons.push('fake'));
 assert.throws(()=>p.hold('temporary'));assert.deepEqual(p.snapshot.reasons,['menu']);p.dispose();
});
test('FW02 legacy pause and runtime leases compose; stale releases cannot touch a new timer life',()=>{
 const timers=new TimerManager();let gameTicks=0,uiTicks=0;timers.doLoop(0,0,()=>gameTicks++);timers.doLoop(0,0,()=>uiTicks++,undefined,TimerGroup.UI);
 const release=timers.holdPause('dialog');timers.setGroupPaused(TimerGroup.GAME,true);timers.setGroupPaused(TimerGroup.GAME,false);timers.update(.1);
 assert.equal(gameTicks,0);assert.equal(uiTicks,1);release();timers.update(.1);assert.equal(gameTicks,1);
 const stale=timers.holdPause('old');timers.dispose();const fresh=timers.holdPause('new');stale();assert.deepEqual(timers.getPauseReasons(),['new']);fresh();timers.dispose();
});
for(const dimensions of [[720,1280],[390,844],[720,1130],[1280,720],[2048,1536]]) for(const dpr of [1,2,3]) test(`FW02 contain/roundtrip/camera projection ${dimensions} DPR${dpr}`,()=>{
 const [w,h]=dimensions,frame={x:0,y:0,width:w*dpr,height:h*dpr},safe={x:12*dpr,y:22*dpr,width:(w-24)*dpr,height:(h-52)*dpr};
 const layout=new ViewportLayout({width:720,height:1280},frame,safe,16*dpr),camera=layout.camera();
 assert.ok(layout.content.x>=safe.x);assert.ok(layout.content.y>=safe.y);assert.ok(layout.content.x+layout.content.width<=safe.x+safe.width+1e-7);
 assert.ok(layout.content.y+layout.content.height<=safe.y+safe.height-16*dpr+1e-7);
 for(const point of [{x:0,y:0},{x:720,y:1280},{x:360,y:640},{x:58,y:1012}]){
  const screenPoint=layout.toViewport(point), back=layout.fromViewport(screenPoint), world=layout.toWorld(point);close(back.x,point.x);close(back.y,point.y);
  // Independent orthographic projection expectation, not a call back into layout mapping.
  const projected={x:frame.width/2+(world.x-camera.x)*frame.height/(2*camera.halfHeight),y:frame.height/2+(world.y-camera.y)*frame.height/(2*camera.halfHeight)};
  close(projected.x,screenPoint.x);close(projected.y,screenPoint.y);
 }
 assert.equal(layout.contains({x:-10,y:-10}),false);
});
test('FW02 asymmetric safe areas and reserved capsule strip have independent expected values',()=>{
 const layout=new ViewportLayout({width:100,height:100},{x:10,y:20,width:400,height:200},{x:30,y:30,width:350,height:170},20);
 assert.deepEqual(layout.available,{x:30,y:30,width:350,height:150});assert.deepEqual(layout.content,{x:130,y:30,width:150,height:150});
 assert.deepEqual(layout.toViewport({x:0,y:0}),{x:130,y:180});
 for(const bad of [0,-1,NaN,Infinity])assert.throws(()=>new ViewportLayout({width:bad,height:100},{x:0,y:0,width:100,height:100}));
 assert.throws(()=>new ViewportLayout({width:100,height:100},{x:0,y:0,width:100,height:100},undefined,100));
});
test('FW02 Cocos screen adapter uses physical pixels once and detaches every observer',()=>{
 const old={visible:view.visible,viewport:view.viewport,origin:view.origin,sx:view.scaleX,sy:view.scaleY,size:screen.windowSize,dpr:screen.devicePixelRatio};
 try{view.visible={width:720,height:1280};view.origin={x:0,y:0};view.viewport={x:0,y:0,width:1440,height:2560};view.scaleX=view.scaleY=2;screen.windowSize={width:1440,height:2560};screen.devicePixelRatio=2;
  const service=new ViewportService({width:720,height:1280});service.start();close(service.snapshot.pixels.camera().halfHeight,6.4);
  const node=new Node();node.addComponent(UITransform);service.applyContent(node);assert.equal(node.scale.x,1);
  const camera={node:new Node(),orthoHeight:0};service.applyCamera(camera);close(camera.orthoHeight,6.4);
  let updates=0;service.subscribe(()=>updates++);screen.emit('orientation-change');assert.equal(updates,1);service.dispose();screen.emit('window-resize');assert.equal(updates,1);
  assert.equal((screen.listeners.get('window-resize')??[]).length,0);view.scaleY=1;assert.throws(()=>service.start(),/uniform/);service.dispose();
 }finally{view.visible=old.visible;view.viewport=old.viewport;view.origin=old.origin;view.scaleX=old.sx;view.scaleY=old.sy;screen.windowSize=old.size;screen.devicePixelRatio=old.dpr;}
});
test('FW02 SafeAreaAdapter applies all four sides without accumulating or stealing authored offsets',()=>{
 const get=sys.getSafeAreaRect;sys.getSafeAreaRect=()=>({x:10,y:20,width:680,height:1230,xMin:10,yMin:20,xMax:690,yMax:1250});
 try{const node=new Node(),widget=node.addComponent(Widget);widget.left=2;widget.right=3;widget.top=4;widget.bottom=5;
  const adapter=node.addComponent(SafeAreaAdapter);adapter.onEnable();adapter.applySafeArea();assert.deepEqual([widget.left,widget.right,widget.top,widget.bottom],[12,33,34,25]);
  adapter.onDisable();assert.deepEqual([widget.left,widget.right,widget.top,widget.bottom],[2,3,4,5]);node.destroy();
 }finally{sys.getSafeAreaRect=get;}
});
test('FW02 background recovery keeps modal pause and flushes once for a pending save',async()=>{
 TimerManager.Instance.dispose();let finish,writes=0;const flushed=new Promise(resolve=>finish=resolve),errors=[];
 const runtime=new RuntimeLifecycle({flush:()=>{writes++;return flushed;},onError:e=>errors.push(e)});runtime.init();const release=runtime.pauses.hold('help');
 game.emit(Game.EVENT_HIDE);game.emit(Game.EVENT_HIDE);await turn();assert.equal(writes,1);game.emit(Game.EVENT_SHOW);assert.equal(runtime.pauses.isPaused,true);
 release();assert.deepEqual(TimerManager.Instance.getPauseReasons(),[]);finish();await runtime.dispose();await runtime.dispose();assert.deepEqual(errors,[]);
 assert.equal((game.listeners.get(Game.EVENT_HIDE)??[]).length,0);TimerManager.Instance.dispose();
});
test('FW02 flush failure is observable and a later background flush retries dirty persistence',async()=>{
 TimerManager.Instance.dispose();let writes=0;const error=Error('disk busy'),runtime=new RuntimeLifecycle({flush:async()=>{if(++writes===1)throw error;}});runtime.init();
 runtime.setBackground(true);await turn();assert.equal(runtime.lastError,error);runtime.setBackground(false);runtime.setBackground(true);await turn();assert.equal(writes,2);await runtime.dispose();TimerManager.Instance.dispose();
});
test('FW02 audio pause retains clips, defers newly requested audio and resumes without changing mute',async()=>{
 const res=ResManager.Instance;res.dispose();res.init({maxIdle:0});const audio=new AudioSystem(),root=new Node(),clip=new AudioClip();assets.set('fw02-audio',clip);
 try{audio.init(root);await audio.playSound('fw02-audio');assert.equal(root.children[0].getComponent(AudioSource).playing,true);
  audio.setSuspended(true);assert.equal(root.children[0].getComponent(AudioSource).playing,false);assert.equal(clip.refCount,1);
  await audio.playSound('fw02-audio');assert.ok(root.children.every(n=>!n.getComponent(AudioSource).playing));audio.setSuspended(false);assert.ok(root.children.every(n=>n.getComponent(AudioSource).playing));
  audio.setSound(false);audio.setSuspended(true);audio.setSuspended(false);assert.equal(await audio.playSound('fw02-audio'),false);
 }finally{audio.dispose();res.dispose();assets.delete('fw02-audio');root.destroy();}
});
test('FW02 a failing audio pause cannot skip background flush or escape native callbacks',async()=>{
 TimerManager.Instance.dispose();let writes=0;const runtime=new RuntimeLifecycle({audio:{setSuspended(paused){if(paused)throw Error('audio host failure');}},flush:async()=>{writes++;}});runtime.init();
 assert.doesNotThrow(()=>game.emit(Game.EVENT_HIDE));await turn();assert.equal(writes,1);assert.ok(runtime.lastError);assert.equal(runtime.pauses.isPaused,true);
 assert.doesNotThrow(()=>game.emit(Game.EVENT_SHOW));await runtime.dispose();TimerManager.Instance.dispose();
});
