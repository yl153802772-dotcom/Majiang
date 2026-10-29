import test from 'node:test';
import assert from 'node:assert/strict';
import { sys } from 'cc';
import { PlatformManager } from '../assets/Framework/Core/Platform/PlatformManager.ts';
test('Web does not simulate share or rewarded ad success',async()=>{
 const adapter=new PlatformManager().adapter;
 assert.equal((await adapter.share({title:'test'})).status,'unsupported');
 assert.equal((await adapter.showRewardAd('test')).status,'unsupported');
});
test('Web GET query is encoded and HTTP failure is observable',async()=>{
 const old=globalThis.fetch;let url;
 globalThis.fetch=async input=>{url=input;return {ok:true,status:200,json:async()=>({ok:true})};};
 try{
  const adapter=new PlatformManager().adapter;
  await adapter.request({url:'https://example.invalid/path',method:'GET',data:{q:'a b',page:2}});
  assert.match(url,/q=a%20b/);assert.match(url,/page=2/);
  globalThis.fetch=async()=>({ok:false,status:503});await assert.rejects(adapter.request({url:'https://example.invalid',method:'GET'}),/503/);
 }finally{globalThis.fetch=old;}
});
test('WeChat share request is not a reward-success receipt',async()=>{
 const previous=sys.platform;sys.platform='wechat';let requests=0;
 globalThis.wx={shareAppMessage(){requests++;}};
 try{assert.equal((await new PlatformManager().adapter.share({title:'test'})).status,'requested');assert.equal(requests,1);}
 finally{sys.platform=previous;delete globalThis.wx;}
});
test('WeChat reward requires explicit isEnded=true and always removes callbacks',async()=>{
 const previous=sys.platform;sys.platform='wechat';
 try{
  for(const outcome of [undefined,{isEnded:false},{isEnded:true}]){
   let close,destroyed=0,removed=0;
   globalThis.wx={createRewardedVideoAd(){return{
    onClose(cb){close=cb;},offClose(){removed++;},onError(){},offError(){removed++;},
    async show(){},async load(){},destroy(){destroyed++;}
   };}};
   const job=new PlatformManager().adapter.showRewardAd('injected-id');close(outcome);
   assert.equal((await job).status,outcome?.isEnded===true?'completed':'canceled');
   assert.equal(destroyed,1);assert.equal(removed,2);
  }
 }finally{sys.platform=previous;delete globalThis.wx;}
});
test('WeChat absent storage/request capabilities reject instead of claiming success',async()=>{
 const previous=sys.platform;sys.platform='wechat';globalThis.wx={};
 try{
  const adapter=new PlatformManager().adapter;
  await assert.rejects(adapter.read('k'));await assert.rejects(adapter.write('k','v'));
  await assert.rejects(adapter.request({url:'https://example.invalid',method:'GET'}));
 }finally{sys.platform=previous;delete globalThis.wx;}
});
