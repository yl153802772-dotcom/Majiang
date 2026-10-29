import { performance } from 'node:perf_hooks';
import { EventBus } from '../assets/Framework/Kernel/EventBus.ts';
import { TaskScheduler } from '../assets/Framework/Kernel/TaskScheduler.ts';
import { ResourceCache } from '../assets/Framework/Kernel/ResourceCache.ts';
const percentile=(a,p)=>[...a].sort((a,b)=>a-b)[Math.ceil(a.length*p)-1]??0;
const bus=new EventBus();let events=0;for(let i=0;i<10;i++)bus.on('tick',()=>events++);
for(let i=0;i<10000;i++)bus.emit('tick');
const eventStart=performance.now();for(let i=0;i<100000;i++)bus.emit('tick');
const eventMs=performance.now()-eventStart;
const scheduler=new TaskScheduler();for(let i=0;i<1000;i++)scheduler.add(1,()=>{},{repeat:0});
const ticks=[];for(let i=0;i<600;i++){const start=performance.now();scheduler.tick(1/60);ticks.push(performance.now()-start);}
let physicalLoads=0,refs=0;
const cache=new ResourceCache({async load(k){physicalLoads++;return{k};},retain(){refs++;},release(){refs--;}},4,0);
const start=performance.now();const handles=await Promise.all(Array.from({length:1000},()=>cache.acquire('shared')));
handles.forEach(h=>h.release());const resourceMs=performance.now()-start;
if(physicalLoads!==1||refs!==0)throw Error('Resource ownership benchmark failed');
console.log(JSON.stringify({environment:'Node '+process.version+' '+process.platform+'/'+process.arch,
 event:{emits:100000,listeners:10,totalMs:eventMs},timer:{tasks:1000,ticks:600,p95Ms:percentile(ticks,.95),maxMs:Math.max(...ticks)},
 resource:{consumers:1000,physicalLoads,remainingRefs:refs,totalMs:resourceMs}},null,2));
cache.dispose();scheduler.clear();bus.clear();
