# 通用 Cocos 框架 V1

目标：Cocos Creator 3.8.x，当前实际工程版本 3.8.8，支持 2D/3D 项目的通用基础设施。
当前版本是工程基线，微信真机通过前不能标记为生产验收完成。
旧游戏 API 不再兼容；原脚本的 .meta UUID 保留。

## 从哪里开始

1. 阅读[通用架构](../../需求设计/02_架构与接口/FRAMEWORK_V1_ARCHITECTURE.md)的模块边界、所有权和接入约束。
2. [初版验证](../../需求设计/05_历史归档/通用框架早期记录/FRAMEWORK_V1_VALIDATION.md)、[R03游戏接入加固](../../docs/reports/R03-HARDENING.md)与[FW-01通用可靠性加固](../../docs/reports/FW-01.md)分开保存；当前阶段见[项目进度](../../需求设计/项目进度.md)。
3. 本项目Main.scene当前使用唯一GameBootstrap，通过App装配resources、timers、config、presentation与game；FrameworkBootstrap是通用接入入口，不同时运行两套驱动。
4. resources/framework-smoke/config.json与早期自检记录保留，不能当作当前游戏场景或微信/真机验收。
5. UI/音频需要在启动前绑定 uiRoot/audioRoot；仅在传入根节点时启用，空 3D 场景不会隐式创建 Canvas。
6. 游戏代码已在Framework外实现。当前依据[游戏架构V2](../../需求设计/02_架构与接口/MVP_GAME_ARCHITECTURE_V2.md)，V1历史架构不再作为开工依据。

## 验证命令

- npm run check：真实引擎声明下的严格类型检查、业务残留及 Creator 转译风险检查。
- npm test：纯内核及引擎适配契约测试。cc 使用测试替身，不能代替真实 Cocos/微信运行。
- npm run benchmark：桌面 Node 微基准，不代表手机帧率或 GPU 内存。
- npm run preview:framework：在 127.0.0.1:8877 预览 build/framework-web-v1-release。
- 无需 npm install。检查工具使用已安装 Creator 内的 TypeScript；非默认安装位置设置 COCOS_TYPESCRIPT 指向 typescript.js。

## 最小用法

~~~ts
import { EventBus, LifecycleScope } from './Kernel';
import { ResManager } from './Core/ResManager';
import { Prefab } from 'cc';

type ProjectEvents = { selected: { id: string } };
const events = new EventBus<ProjectEvents>();
const scope = new LifecycleScope();
scope.add(events.on('selected', value => console.log(value.id)));
const prefab = await ResManager.Instance.acquire('prefabs/Dialog', Prefab, {
    bundle: 'ui', scope, timeoutMs: 15000
});
// prefab.value 可用于实例化；节点停用/销毁后再结束其资源作用域。
scope.dispose(); // 注销监听并释放句柄；重复释放安全。
~~~

## 重要约定

- 一个活动App只保留一个帧驱动：通用入口可用FrameworkBootstrap，本项目由GameBootstrap驱动，不并行启用；常驻策略由项目场景方案决定。
- 不要同时在组件和其他调度器中重复调用 App.update/TimerManager.update。
- 在注册完成后再 init/start；依赖以模块名显式声明。
- 使用 Array.from(map/set/iterator) 创建快照，避免当前 Creator 构建的宽松展开转译差异。
- 资源必须使用 acquire 返回的句柄或作用域管理；路径式 load/release、伪显存 LRU 和 ResType 已移除。
- Scope 是一次性的；每次界面显示或对象复用创建新的 Scope。
- 存档必须显式配置命名空间并 await flush；本地数据不提供防作弊或密码学安全保证。
- 分享 requested 仅表示已请求分享，不能用于发奖；广告仅明确 isEnded=true 才返回 completed。
- 启动不自动请求广告、分享、网络或存储。

## FW-01 可靠性接入约定（2026-10-27）

- 通用 `FrameworkBootstrap` 提供只读 `startupState`、`lastError` 和异步 `retry()`。失败完成回滚后可重试；并发重试合并。退出期间的新驱动等待旧App结束，旧启动不能复活。错误展示由项目提供；不要和GameBootstrap同时挂载。
- `runCleanups(message, actions)` 按传入顺序逐项尝试同步收尾，最后聚合抛错；`rollbackCleanups(cause, message, actions)` 保留原错误与收尾错误。二者不会等待Promise，异步模块清理由ModuleHost负责。
- 资源driver的retain须为原子操作：失败时撤回自身部分副作用。Cocos适配器对部分addRef失败执行回滚；加载/保留失败可重新获取同键资源。
- `ResourceCache.lastError` 与 `ResManager.lastError` 可检查后台/旧代次的最近加载错误，包括正常取消，不代表当前启动失败；错误不因重新初始化自动清空。driver可选onError不得抛错，观察器异常只聚合到缓存lastError。调用者仍须处理acquire/retry的Promise拒绝。
- UI创建和显示失败会撤回节点、遮罩、显示作用域与资源；onInit/onShow触发退出后不发布旧实例。keep视图在onShow中关闭自己时仍持有预制体，直到destroyUI/dispose释放。
- UI/音频/配置/动画/材质/池收尾逐项执行；某项报错仍尝试其他项，然后将错误交给调用方。音频未完成请求按初始化代次隔离，不影响新代次的并发额度。
- 广告收尾异常经CapabilityResult.error返回，不改变明确的completed/canceled/failed事实，也不阻塞Promise结算及下一次请求。框架不决定奖励策略。
- 收尾报错代表已尝试清理，不保证抛错的外部引擎/API实际释放成功；不得为了消除日志盲目重复decRef或发放奖励。

## FW-02～FW-04 能力与接入（2026-10-27）

- `PauseController`用具名开关和独立hold租约组合后台、模态、菜单等原因。`TimerManager.setGroupPaused`保留legacy原因，`holdPause`不会被另一原因的恢复撤销。
- 可选`RuntimeLifecycle`模块接受统一pauses、audio和flush；监听引擎前后台，组合GAME定时通道和音频暂停。flush必须由项目显式提供，框架不猜存档命名空间、不默认写盘；失败通过lastError/onError观察，下一次可重试。
- `ViewportLayout`提供安全区contain、设计坐标往返与正交相机参数；`ViewportService`只调整显式传入节点/相机。物理像素不重复除DPR，EXACT_FIT的非等比缩放明确拒绝；SafeAreaAdapter补齐四边，禁用恢复原Widget偏移。微信胶囊需项目传入额外顶部保留区，不能等同设备安全区。
- App默认装配`PlatformRuntime`（可用platformRuntime:false关闭）：按成对on/off能力绑定低内存和网络变化，低内存只清闲置内存资产；不自动删除磁盘缓存/存档。窗口、胶囊与网络查询按能力提供；不读取身份数据。
- `BundleManager.register`配置本地名/HTTPS来源、版本Hash、下载超时和0～2次引擎重试。卸载仍由ResManager检查owners；别名不能提前卸载共享Bundle，版本切换须先真正卸载。Cocos资产分包继续用loadBundle，原生代码分包可选SubpackageLoader；两者不要重复下载同一包。
- HTTP支持Scope取消、Web AbortController/wx RequestTask.abort和逻辑超时。HttpManager仅允许GET显式启用最多2次重试，默认0；非GET、4xx、解析错误和已取消请求不自动重试。分包同键去重，消费者独立超时/取消/进度；平台不支持中止时不伪称物理下载已取消。
- [独立示例](../FrameworkExamples/README.md)不依赖Game/UI资源；`node tools/framework-release.mjs audit`检查复用边界，`export build/<新目录> [--examples]`导出，`build build/<产物目录> [--wechat]`静态检查release包。静态工具始终保留productionReady:false，不代签真机或发布验收。

以上为通用能力，当前Game的投影/暂停/UI不会因存在新模块而自动迁移。当前实现、验证与未验证项见[FW-02～04报告](../../docs/reports/FW-02-04.md)。
