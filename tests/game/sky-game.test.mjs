import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { loadTypeScript } from '../../tools/typescript.mjs';
import { LifecycleScope } from '../../assets/Framework/Kernel/LifecycleScope.ts';
import { PauseController } from '../../assets/Framework/Kernel/PauseController.ts';
import { TableProjector } from '../../assets/Game/Presentation/TableProjector.ts';
import { LEVEL_888 } from '../../assets/Game/Config/Level888.ts';
import { GameSession } from '../../assets/Game/Application/GameSession.ts';

// 中文注释：运行真实Presenter，只有引擎绘制/资源/模态API使用替身；不是实际GPU验证。
function fixture() {
    class Node {
        constructor(name) { this.name=name;this.children=[];this.components=[];this.active=true;this.handlers=new Map();this.position={x:0,y:0}; }
        addChild(n){this.children.push(n);n.parent=this;}
        getChildByName(n){return this.children.find(c=>c.name===n);}
        getComponent(T){return this.components.find(c=>c instanceof T)??null;}
        addComponent(T){const c=new T();c.node=this;this.components.push(c);return c;}
        setPosition(x,y){this.position={x,y};}
        destroy(){this.destroyed=true;this.active=false;for(const c of this.children)c.destroy();}
        on(k,f){this.handlers.set(k,f);} off(k){this.handlers.delete(k);}
    }
    class Label {} class Graphics {} class UITransform {setContentSize(w,h){this.width=w;this.height=h;}}
    class Sprite {static SizeMode={CUSTOM:0};static Type={SIMPLE:0,SLICED:1};}
    class Button {static EventType={CLICK:'click'};} class SpriteFrame {}
    class SkyWhiteFooterBindings {} class SkyWhiteMeldSlotBindings {}
    const createUiNode=(p,n,w,h)=>{const node=new Node(n);p.addChild(node);node.addComponent(UITransform).setContentSize(w,h);return node;};
    const createLabelNode=(p,n,s)=>{const l=createUiNode(p,n,70,30).addComponent(Label);l.string=s;return l;};
    const parent=new Node('parent'),hud=new Node('GameHUD'),top=new Node('TopHud');hud.addChild(top);
    for(const name of ['Remaining_Value','Level_Text','Clock_Value','Star_Value'])createLabelNode(top,name,'sample');
    for(const name of ['PauseHit','HelpHit'])createUiNode(top,name,60,80).addComponent(Button);
    const rail=new Node('ToolRail');hud.addChild(rail);for(const name of ['magnet','remove','shuffle','flip'])createUiNode(rail,name,70,96).addComponent(Button);
    for(const name of ['FooterExactReference','MeldStrip','BufferStrip'])hud.addChild(new Node(name));
    const footer=hud.getChildByName('FooterExactReference'),mapping=new Node('OriginalImageMapping'),native=new Node('FooterExactNative');
    footer.addChild(mapping);mapping.addChild(native);const binding=native.addComponent(SkyWhiteFooterBindings);
    binding.meldCount=createLabelNode(native,'MeldCount','0/4');binding.bufferCount=createLabelNode(native,'BufferCount','0/7');
    binding.meldSlots=[];binding.bufferBlocks=[];binding.firstCards=[];binding.secondCards=[];
    for(let i=0;i<4;i++){const panel=createUiNode(native,'MeldSlot'+i,167,110),slot=panel.addComponent(SkyWhiteMeldSlotBindings);slot.index=createLabelNode(panel,'EmptyIndex',String(i+1));slot.cards=[0,1,2,3].map(n=>createLabelNode(panel,'MeldCard'+n,''));binding.meldSlots.push(panel);}
    for(let i=0;i<7;i++){const node=createUiNode(native,'BufferBlock'+i,96,110);node.active=false;binding.bufferBlocks.push(node);binding.firstCards.push(createLabelNode(node,'Card0',''));binding.secondCards.push(createLabelNode(node,'Card1',''));}
    const state={owners:0,closed:0,opens:0,fail:false};
    const manager={register(){},destroyUI(){state.closed++;},async openUI(){state.opens++;if(state.fail)throw Error('load failed');}};
    const source=fs.readFileSync('assets/Game/Presentation/UI/SkyWhiteGameView.ts','utf8');
    const module={exports:{}};const deps={cc:{Button,Graphics,Label,Node,Sprite,SpriteFrame,UITransform},
        '../../../Framework/Kernel/LifecycleScope':{LifecycleScope},'../../../Framework/Core/ResManager':{ResManager:{Instance:{async acquire(_p,_t,{scope}){state.owners++;let released=false;const release=()=>{if(!released){released=true;state.owners--;}};scope.add(release);return{value:{},release};}}}},
        '../../../Framework/Core/UIManager':{UIManager:{Instance:manager},UILayer:{Popup:1}},
        './HudView':{createUiNode,createLabelNode,hexColor:x=>x,cardColor:x=>x.suit,cardText:c=>c.rank+c.suit,drawPanel(){},placeAtDesign(p,n,x,y){n.setPosition(x,y);}},'./SkyWhiteModal':{},
        './SkyWhiteFooterBindings':{SkyWhiteFooterBindings},'./SkyWhiteMeldSlotBindings':{SkyWhiteMeldSlotBindings}};
    const {ts}=loadTypeScript();const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText;
    vm.runInNewContext(compiled,{module,exports:module.exports,require:n=>{assert.ok(n in deps,n);return deps[n];},console:{error(){}},setTimeout,clearTimeout});
    const pauses=new PauseController(),view=new module.exports.SkyWhiteGameView(parent,hud,new TableProjector(),pauses,()=>{});
    const find=(n,name)=>n.name===name?n:n.children.map(c=>find(c,name)).find(Boolean);
    return {view,state,hud,parent,pauses,find,Label,binding,mod:module.exports};
}

test('SkyWhite presenter binds real data to saved Main UI without rebuilding layout',async()=>{
    const f=fixture();await f.view.loadArt();const session=new GameSession({level:LEVEL_888,nextSessionId:()=> 'sky'});
    const snap=session.getSnapshot();f.view.render(snap,null);
    assert.equal(f.find(f.hud,'Remaining_Value').getComponent(f.Label).string,'48');
    assert.equal(f.find(f.hud,'Level_Text').getComponent(f.Label).string,'第888关');
    assert.equal(f.find(f.hud,'FooterExactReference').active,true);
    assert.equal(f.parent.children.length,1); // only the transient message layer
    assert.equal(f.find(f.hud,'Clock_Value').getComponent(f.Label).string,'00:00');
    const result=session.dispatch({kind:'select',sessionId:snap.sessionId,blockId:'B02'});
    assert.equal(result.accepted,true);f.view.render(result.snapshot,null);f.view.renderBuffer(result.snapshot);
    assert.equal(f.find(f.hud,'Remaining_Value').getComponent(f.Label).string,'46');
    const block=f.find(f.hud,'BufferBlock0');assert.equal(block.active,true);
    assert.equal(f.find(block,'Card0').active,true);assert.equal(f.find(block,'Card1').active,true);
    assert.equal(f.find(f.hud,'BufferBlock7'),undefined);
    f.view.dispose();f.view.dispose();assert.equal(f.state.owners,0);session.dispose();
});

test('SkyWhite meld adapter preserves all four kan cards and restores empty slot on restart',()=>{
    const f=fixture();const snapshot={melds:[{kind:'gang',cards:[1,2,3,4].map(rank=>({rank,suit:'tong'}))}]};
    f.view.renderMeld(snapshot);const panels=f.binding.meldSlots;
    assert.equal(panels.length,4);assert.equal(panels[0].children.filter(c=>c.name.startsWith('MeldCard')&&c.active).length,4);
    f.view.renderMeld({melds:[]});assert.equal(panels[0].children.filter(c=>c.name.startsWith('MeldCard')&&c.active).length,0);
    assert.equal(f.find(panels[0],'EmptyIndex').active,true);f.view.dispose();
});

test('SkyWhite failed modal load releases only loading lease and preserves background pause',async()=>{
    const f=fixture();f.state.fail=true;f.pauses.set('background',true);
    f.find(f.hud,'PauseHit').handlers.get('click')();
    assert.ok(f.pauses.snapshot.reasons.includes('modal-loading'));
    await new Promise(r=>setImmediate(r));
    assert.deepEqual(f.pauses.snapshot.reasons,['background']);assert.equal(f.state.opens,1);
    f.view.dispose();assert.equal(f.find(f.hud,'PauseHit').handlers.size,0);
});

test('SkyWhite board projection stays outside toolbar/footer without changing level placements',()=>{
    const original=JSON.stringify(LEVEL_888);const p=new TableProjector();p.setArtBoard({x:16,y:156,width:612,height:824});
    for(const placement of LEVEL_888.placements){const a=p.logicalToArt(placement.x,placement.y),b=p.artToLogical(a.x,a.y);
        assert.ok(Math.abs(b.x-placement.x)<1e-8);assert.ok(Math.abs(b.y-placement.y)<1e-8);
        assert.ok(a.x<628&&a.y<980);}
    assert.equal(JSON.stringify(LEVEL_888),original);
});

test('Main keeps its UUID and accepted camera/mount structure, with one game owner',()=>{
    const scene=JSON.parse(fs.readFileSync('assets/scenes/Main.scene'));const meta=JSON.parse(fs.readFileSync('assets/scenes/Main.scene.meta'));
    assert.equal(meta.uuid,'6f81ed5b-0a4a-4ffc-b7d0-fabc1906c359');
    const boot=scene.filter(x=>x.__type__==='565e0hRJFNH2YhH/DpdqxNa');assert.equal(boot.length,1);
    assert.equal(scene.some(x=>x.__type__==='2eb65ukx/BDG723rIdBVOmO'),false);
    for(const [field,name] of [['sceneContentRoot','SafeContentRoot'],['sceneHud','GameHUD'],['sceneBoardRoot','Board3DRoot']])assert.equal(scene[boot[0][field].__id__]._name,name);
    // 中文注释：本轮正式依据是图一；Main保存本地UI，不以旧预览/共享HUD替代编辑。
    for(const name of ['GameHUD','TopHud','ToolRail','FooterExactNative','SkyBackground']){
        const n=scene.find(x=>x.__type__==='cc.Node'&&x._name===name);
        assert.ok(n,name);assert.equal(n._prefab,null,name+' must remain editable in Main');
        assert.ok(n._children.length>0,name+' has saved children');
    }
    assert.equal(scene.some(x=>x.__type__==='cc.PrefabInstance'),false);
    assert.equal(scene.filter(x=>x.__type__==='cc.Camera').length,3);
    assert.equal(boot[0].layoutOnly,false,'deliverable must run real MVP');
    for(const field of ['sceneBackgroundCamera','sceneBoardCamera','sceneOverlayCamera'])assert.equal(scene[boot[0][field].__id__].__type__,'cc.Camera');
});

test('Footer prefab is editable UI: no camera/canvas/RT/composite and every slot is a real nested prefab',()=>{
    const base='assets/UIRuntime/SkyWhiteV2/Prefabs/';
    const names=['FooterExactNative','FooterExactReference','MeldSlot','BufferSlot'];
    for(const name of names){const a=JSON.parse(fs.readFileSync(base+name+'.prefab'));
        assert.equal(a.some(x=>['cc.Camera','cc.Canvas','cc.RenderTexture'].includes(x.__type__)),false,name);
        assert.equal(a.some(x=>['FooterComposite','FooterNativeCamera','FooterExactRoot'].includes(x._name)),false,name);
        assert.equal(JSON.stringify(a).includes('67840+qXotEeI5mI0mDFR81'),false,name);
    }
    const a=JSON.parse(fs.readFileSync(base+'FooterExactNative.prefab'));
    const id=n=>JSON.parse(fs.readFileSync(base+n+'.prefab.meta')).uuid;
    assert.equal(a.filter(x=>x.__type__==='cc.PrefabInfo'&&x.asset?.__uuid__===id('MeldSlot')).length,4);
    assert.equal(a.filter(x=>x.__type__==='cc.PrefabInfo'&&x.asset?.__uuid__===id('BufferSlot')).length,7);
    assert.equal(a.filter(x=>x.__type__==='cc.Button').length,1);
    assert.equal(a.filter(x=>x.__type__==='cc.Label'&&x._string==='0/4').length,1);
    assert.equal(a.filter(x=>x.__type__==='cc.Label'&&x._string==='0/7').length,1);
    const source='assets/UIRuntime/SkyWhiteV2/L1_UI/bottom_exact';
    const baked=new Set(fs.readdirSync(source,{recursive:true}).filter(f=>f.endsWith('.png.meta')).flatMap(f=>Object.values(JSON.parse(fs.readFileSync(source+'/'+f)).subMetas).filter(x=>x.importer==='sprite-frame').map(x=>x.uuid)));
    for(const o of a.filter(x=>x.__type__==='cc.Sprite'))assert.equal(baked.has(o._spriteFrame?.__uuid__),false);
});

test('Footer slots preserve the reference native positions and mapping scale exactly',()=>{
    const a=JSON.parse(fs.readFileSync('assets/UIRuntime/SkyWhiteV2/Prefabs/FooterExactNative.prefab'));
    const manifest=JSON.parse(fs.readFileSync('UI/_docs/bottom_exact/manifest.json'));
    for(const inst of a.filter(x=>x.__type__==='cc.PrefabInstance')){
        const overrides=inst.propertyOverrides.map(r=>a[r.__id__]);const name=overrides.find(x=>x.propertyPath[0]==='_name')?.value;
        if(!/^(MeldSlot|BufferSlot)\d$/.test(name??''))continue;
        const id=name.replace('MeldSlot','meld_slot_').replace('BufferSlot','buffer_slot_');
        const r=manifest.entries.find(e=>e.id===id).nodeInFooter,pos=overrides.find(x=>x.propertyPath[0]==='_lpos').value;
        assert.equal(pos.x,r.x);assert.equal(pos.y,r.y);
    }
    const ref=JSON.parse(fs.readFileSync('assets/UIRuntime/SkyWhiteV2/Prefabs/FooterExactReference.prefab'));
    const mapping=ref.find(x=>x._name==='OriginalImageMapping');assert.equal(mapping._lscale.x,720/941);assert.equal(mapping._lscale.y,720/941);
});

// 中文注释：直接检查Main的实际可达节点/字段和层次，防止只改旧Prefab却未改正式入口。
test('Main footer matches reference coordinates, preserves fields and paints content above skins',()=>{
    const a=JSON.parse(fs.readFileSync('assets/scenes/Main.scene'));
    const footer=a.find(x=>x.__type__==='cc.Node'&&x._name==='FooterExactNative');
    const children=footer._children.map(r=>a[r.__id__]);
    assert.equal(children.filter(x=>/^MeldSlot[1-4]$/.test(x._name)).length,4);
    assert.equal(children.filter(x=>/^BufferSlot[1-7]$/.test(x._name)).length,7);
    const binding=footer._components.map(r=>a[r.__id__]).find(x=>x.meldSlots);
    assert.equal(binding.meldSlots.length,4);assert.equal(binding.bufferBlocks.length,7);
    assert.equal(a[binding.meldCount.__id__].__type__,'cc.Label');
    assert.equal(a[binding.bufferCount.__id__].__type__,'cc.Label');
    const allIds=new Set();const visit=n=>{const i=a.indexOf(n);assert.equal(allIds.has(i),false,'no duplicate/cyclic hierarchy');allIds.add(i);for(const r of n._children??[])visit(a[r.__id__]);};visit(footer);
    assert.equal([...allIds].some(i=>a[i]._components.some(r=>['cc.Camera','cc.Canvas','cc.RenderTexture'].includes(a[r.__id__].__type__))),false);
    for(let i=0;i<4;i++){
        const slot=children.find(x=>x._name==='MeldSlot'+(i+1));assert.equal(slot._lpos.x,-236+163*i);assert.equal(slot._lpos.y,96);
        const order=slot._children.map(r=>a[r.__id__]._name);
        assert.ok(order.indexOf('Skin')<order.indexOf('IndexPaper'));assert.ok(order.indexOf('IndexPaper')<order.indexOf('Index'));assert.ok(order.indexOf('Skin')<order.indexOf('ContentsRoot'));
        const index=a[slot._children.find(r=>a[r.__id__]._name==='Index').__id__];
        assert.equal(index._components.map(r=>a[r.__id__]).find(x=>x.__type__==='cc.Label')._string,String(i+1));
    }
    for(let i=0;i<7;i++){const slot=children.find(x=>x._name==='BufferSlot'+(i+1));assert.equal(slot._lpos.x,-264.5+104*i);assert.equal(slot._lpos.y,-40);}
    const mapping=a.find(x=>x._name==='OriginalImageMapping');assert.equal(mapping._lscale.x,720/941);assert.equal(mapping._lscale.y,720/941);
    const top=a.find(x=>x._name==='TopHud'),rail=a.find(x=>x._name==='ToolRail');
    assert.deepEqual([top._lpos.x,top._lpos.y],[0,549]);assert.deepEqual([rail._lpos.x,rail._lpos.y],[319,128]);
});
