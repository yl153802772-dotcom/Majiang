/** Contract-test double only. Does not simulate renderer, browser policy, JSB or wx. */
class Emitter {
    listeners = new Map();
    on(key, cb, target) { const a = this.listeners.get(key) ?? []; a.push({ cb, target }); this.listeners.set(key, a); }
    off(key, cb, target) { this.listeners.set(key, (this.listeners.get(key) ?? []).filter(x => x.cb !== cb || x.target !== target)); }
    once(key, cb, target) { const f = (...args) => { this.off(key, f, target); cb.apply(target, args); }; this.on(key, f, target); }
    emit(key, ...args) { for (const x of [...(this.listeners.get(key) ?? [])]) x.cb.apply(x.target, args); }
}
export class Asset { refCount = 0; isValid = true; addRef() { this.refCount++; return this; } decRef() { this.refCount--; if (this.refCount < 0) throw Error('Reference underflow'); return this; } destroy() { this.isValid = false; } }
export class JsonAsset extends Asset { json = null; }
export class AudioClip extends Asset {}
export class SpriteFrame extends Asset {}
export class SpriteAtlas extends Asset { frames = new Map(); getSpriteFrame(n) { return this.frames.get(n) ?? null; } }
export class Material extends Asset { copy() {} }
export class Prefab extends Asset { factory = () => new Node('Prefab'); }
export class Component {
    enabled = true; node;
    get isValid() { return this.node?.isValid ?? false; }
    get enabledInHierarchy() { return this.enabled && this.node?.activeInHierarchy; }
    getComponent(type) { return this.node.getComponent(type); }
    addComponent(type) { return this.node.addComponent(type); }
}
export class Vec3 {
    static ZERO = new Vec3(); x = 0; y = 0; z = 0;
    constructor(x = 0, y = 0, z = 0) { Object.assign(this, { x, y, z }); }
    set(v) { Object.assign(this, v); return this; }
    clone() { return new Vec3(this.x, this.y, this.z); }
    static distance(a, b) { return Math.sqrt(this.squaredDistance(a, b)); }
    static squaredDistance(a, b) { return (a.x-b.x)**2+(a.y-b.y)**2+(a.z-b.z)**2; }
    static subtract(out, a, b) { out.x=a.x-b.x;out.y=a.y-b.y;out.z=a.z-b.z;return out; }
    static dot(a, b) { return a.x*b.x+a.y*b.y+a.z*b.z; }
    static lerp(out, a, b, t) { out.x=a.x+(b.x-a.x)*t;out.y=a.y+(b.y-a.y)*t;out.z=a.z+(b.z-a.z)*t;return out; }
}
export class Vec2 { constructor(x=0,y=0) { this.x=x;this.y=y; } }
export class Node extends Emitter {
    static EventType = { SIZE_CHANGED:'size-changed' };
    children=[]; components=[]; active=true; isValid=true; layer=0; position=new Vec3(); scale=new Vec3(1,1,1); parent=null;
    constructor(name='Node') { super(); this.name=name; }
    get activeInHierarchy() { return this.active && (!this.parent || this.parent.activeInHierarchy); }
    addComponent(type) { const c=new type();c.node=this;this.components.push(c);return c; }
    getComponent(type) { return this.components.find(c => c instanceof type) ?? null; }
    getComponents(type) { return this.components.filter(c=>c instanceof type); }
    getComponentsInChildren(type) { return [...this.getComponents(type),...this.children.flatMap(c=>c.getComponentsInChildren(type))]; }
    setParent(parent) { this.removeFromParent(); this.parent=parent;parent?.children.push(this); }
    removeFromParent() { if(this.parent)this.parent.children=this.parent.children.filter(n=>n!==this);this.parent=null; }
    getSiblingIndex() { return this.parent?.children.indexOf(this)??0; }
    setSiblingIndex(i) { if(this.parent){const p=this.parent;this.removeFromParent();this.parent=p;p.children.splice(i,0,this);} }
    setPosition(x,y,z=0) { this.position=x instanceof Vec3?x.clone():new Vec3(x,y,z); }
    setScale(v,y,z) { this.scale=v instanceof Vec3?v.clone():new Vec3(v,y??v,z??v); }
    destroy() { if(!this.isValid)return;this.isValid=false;for(const c of this.components){c.onDisable?.();c.onDestroy?.();}for(const n of [...this.children])n.destroy();this.removeFromParent(); }
}
export class UITransform extends Component { width=720;height=1280;anchorX=.5;anchorY=.5; setContentSize(w,h){this.width=w;this.height=h;}setAnchorPoint(x,y){this.anchorX=x;this.anchorY=y;} }
export class Widget extends Component { top=0;bottom=0;left=0;right=0;updateAlignment(){} }
export class BlockInputEvents extends Component {}
export class UIOpacity extends Component { opacity=255; }
export class Label extends Component { string=''; }
export class Button extends Component { interactable=true; }
export class Sprite extends Component { spriteFrame=null;customMaterial=null; }
export class AudioSource extends Component {
    static EventType={ENDED:'ended'};playing=false;clip=null;volume=1;loop=false;
    play(){this.playing=true;}stop(){this.playing=false;}pause(){this.playing=false;}
}
export class Camera extends Component {}
export class SkeletalAnimation extends Component { stop(){} }
export class RigidBody extends Component {clearForces(){}setLinearVelocity(){}setAngularVelocity(){}}
export const Layers={Enum:{UI_2D:1}};
export const isValid=value=>!!value?.isValid;
export const instantiate=prefab=>prefab.factory();
const property=(...args)=>args.length>=2&&typeof args[1]==='string'?undefined:()=>{};
export const _decorator={property,ccclass:()=>target=>target,requireComponent:()=>target=>target};
export const assets=new Map();
export let physicalLoads=0;
export let loadOverride=null;
export function setLoadOverride(fn){loadOverride=fn;}
export const resources={name:'resources',load(path,type,callback){physicalLoads++;if(loadOverride)return loadOverride(path,type,callback);queueMicrotask(()=>assets.has(path)?callback(null,assets.get(path)):callback(Error('Missing fixture: '+path)));}};
const bundles=new Map([['resources',resources]]);
export const assetManager={cacheManager:null,getBundle:name=>bundles.get(name),loadBundle(name,options,done){const cb=done??options;const b={...resources,name};bundles.set(name,b);queueMicrotask(()=>cb(null,b));},removeBundle(bundle){bundles.delete(bundle.name);}};
export const sys={isNative:false,platform:'web',Platform:{WECHAT_GAME:'wechat'},localStorage:{getItem:()=>null,setItem:()=>{}}};
export const director={getScene:()=>null,addPersistRootNode(){},removePersistRootNode(){}};
export const game=new Emitter();
export const Game={EVENT_HIDE:'hide',EVENT_SHOW:'show'};
export const clamp01=n=>Math.max(0,Math.min(1,n));
// 中文注释：仅为屏幕/安全区契约提供可控数值，不能模拟真实相机投影或渲染。
export const screen=Object.assign(new Emitter(),{windowSize:{width:720,height:1280},devicePixelRatio:1});
export const view=Object.assign(new Emitter(),{visible:{width:720,height:1280},origin:{x:0,y:0},viewport:{x:0,y:0,width:720,height:1280},scaleX:1,scaleY:1,
 getVisibleSize(){return this.visible;},getVisibleOrigin(){return this.origin;},getViewportRect(){return this.viewport;},getScaleX(){return this.scaleX;},getScaleY(){return this.scaleY;}});
sys.getSafeAreaRect=()=>({x:0,y:0,width:view.visible.width,height:view.visible.height,xMin:0,yMin:0,xMax:view.visible.width,yMax:view.visible.height});
