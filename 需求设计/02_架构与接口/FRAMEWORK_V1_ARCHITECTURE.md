# 通用 Cocos 框架 V1：架构与接入规范

日期：2026-10-25。代码基线：本工程 Cocos Creator 3.8.8、TypeScript strict。
状态：首版重构实现；实际验证记录单独维护，不能将设计目标当作已通过结果。
文档整理更新（2026-10-26）：当前基线与阶段边界统一见[项目进度](../项目进度.md)；本文件仍为通用框架设计，不将G06或微信/真机待验项写成完成。
2026-10-25 异常路径加固：资源描述按初始化代次隔离；对象池逐节点/逐池收尾并聚合错误；UI 显示清理失败仍完成实例清理。具体结果见 需求设计/05_历史归档/通用框架早期记录/FRAMEWORK_V1_HARDENING.md。
2026-10-26 构造事务与接入加固：LifecycleScope.rollback、场景子树/共享白膜资源的部分构造回滚、启动代次与重试恢复。具体结果见 docs/reports/R03-HARDENING.md；不将其他平台或全部异常路径视为已验证。
2026-10-27 FW-01：通用入口失败重试、同步收尾聚合、资源retain失败与后台诊断、序列取消、广告结算及UI/音频/配置等异常路径加固；见[本批报告](../../docs/reports/FW-01.md)。本批不扩展FW-02～FW-04的平台或业务能力。
2026-10-27 后续授权FW-02～FW-04：暂停原因与统一视口、微信运行时/加载策略、独立示例与导出/静态release校验已实现；见[升级报告](../../docs/reports/FW-02-04.md)和[接入验收规范](../03_开发规范与验收/通用框架_接入与验收.md)。已有Game未自动迁移，不将微信构建当作工具/真机验收。

## 1. 范围与质量定义

面向 3.8.x 的 2D/3D 游戏复用，首轮目标为 Web 和微信小游戏；原生平台仅留扩展位置。
其他 3.8.x 补丁版本、Android/iOS 原生尚未验证。
“大厂 80%”没有统一可核验标准，本项目将其转为以下工程门槛，不作百分比认证：

- 严格类型检查通过，不依赖关闭 strict 或排除活动源码消除报错。
- 框架不含具体游戏的数据、广告位、资源路径、奖励规则或产品文案。
- 明确启动依赖、异步等待、失败回滚、反向释放及唯一帧驱动。
- 共享加载去重、加载并发限制、资源持有和释放可追踪；取消与迟到回调隔离。
- UI、对象池、音频、配置具有完整关闭和销毁契约。
- 错误必须可观察；不把失败转换为虚假的成功。
- 关键竞争、故障和重复释放有自动化验证。
- Cocos 实际构建与运行、微信构建分开验证；真机验收保留为发布门槛。
- 具备可复现命令、迁移清单、性能采样与未验证项记录。

## 2. 实际代码分层

现有脚本路径尽量保留，以保留 .meta UUID；逻辑分层不等同于全部重排目录。

| 层 | 实际位置 | 边界 |
|---|---|---|
| 引擎无关内核 | assets/Framework/Kernel | ModuleHost、EventBus、LifecycleScope、TaskScheduler、ResourceCache、StateStore、StorageStore |
| 引擎接入 | Core/App、FrameworkBootstrap、SceneManager、ResManager、BundleManager | Cocos 生命周期、资源 API 和场景 API |
| 可选服务 | Core/UIManager、AudioSystem、SaveManager、ConfigManager、Net、Pool 等 | 按项目配置接入 |
| 平台实现 | Core/Platform/PlatformManager | Web/微信能力检测与调用 |
| 通用组件和工具 | Components、Utils、Core/lang | 组件适配、虚拟列表、动画、路径、多语言显示等 |
| 项目验证 | tests、tools、resources/framework-smoke | 契约测试、类型检查、微基准、真实引擎资源自检 |

Kernel 不导入 cc、wx、游戏层或引擎服务。
游戏事件用 EventBus<GameEvents>，游戏状态用 StateStore<GameSchema> 或游戏自己的状态容器。
Data/EventCenter 只承载框架通知；不再要求游戏修改框架内 GameConst。

默认服务提供 Instance 便捷入口，同时多数服务可独立构造。
这是单个活动 Cocos 应用的组合入口，并非多租户容器；不同时启动多个 App 实例。
项目模块由 AppOptions.modules 注入，项目可直接持有自己的模块实例，无需在全局对象上挂游戏状态。

## 3. 启动、帧驱动与退出

FrameworkBootstrap.onLoad -> App.init -> ModuleHost.init -> App.start -> update。
默认注册 resources、timers、config、presentation；UI/音频有显式根节点才启用。
广告、分享、HTTP、存档、引导、诊断面板不自动启动。

模块注册不产生初始化副作用。初始化前检查重复名、缺失依赖、循环依赖。
依赖优先于 priority，priority 只作为独立模块的稳定排序依据。
init/start 的 Promise 必须等待；并发调用共用执行。
失败时清理包括部分初始化的失败模块，并保留原始错误与清理错误。
销毁按进入顺序逆序执行；单模块清理失败不会跳过其余模块。
已请求销毁时停止后续 start；销毁等待进行中的生命周期操作完成，不对任意用户 Promise 作强制中断。

注册在初始化后关闭。需要动态下载模块的项目另行设计，不隐式支持热插拔。
update 仅在 running 时推进；框架错误向调用方传播，不吞掉状态异常。
Bootstrap 对长帧 dt 限制在 0.25 秒，避免回前台时无限补帧；不适合用来累计离线收益。
后台只暂停 game 定时通道，ui 通道和平台 IO 各自独立。
背景暂停不等同于游戏内暂停；当前可用PauseController/RuntimeLifecycle统一组合原因，项目接入后再替代其旧的布尔暂停，不能只改一处resume。

Bootstrap 为常驻根节点。若绑定 UI/音频根节点，根节点也应放入同一持久化子树。
SceneManager 为可选、串行场景转换器；场景局部资源注册到每场景 Scope。
场景已成功替换后的 configure 异常不会自动恢复旧场景，调用方需要展示错误/重试界面。

presentation 清理模块回收动画、Tween、特效、节点池与动态材质，再由资源模块结束持有。
项目模块依赖资源时声明 dependencies: ['resources']，确保其 dispose 先于资源层。

### 3.1 FW-01 通用入口恢复

FrameworkBootstrap保留Inspector属性和类名，增加可观察的startupState（idle/starting/running/failed/destroyed）、lastError及retry()。
onLoad启动失败在组件内记录并报告，不产生未处理的拒绝；项目可等待retry()并展示自己的错误界面。并发retry共用Promise，运行态retry不重复初始化，销毁态retry明确拒绝。
宿主在注册监听/常驻节点之前登记逆操作。失败与退出都逐项移除监听、解除常驻并释放App；Scope或单项清理失败不能跳过App.dispose。
启动代次在每个异步边界检查，退出后不能再start或置为running。替换驱动先等待旧驱动清理屏障，避免旧App退出时新App初始化；若用户模块的init/start永不结算，屏障同样不会强制越过。
runSelfCheck的两个共享资源消费者均绑定宿主Scope；任何一项失败会释放整批。长帧和后台策略仍沿用原契约，没有引入新的暂停或屏幕适配服务。

## 4. 作用域与事件

Scope 分应用寿命、场景寿命、界面显示寿命、界面实例寿命、池对象每次复用寿命。
Scope 只结束一次；结束后新增清理动作立即执行。已完成任务用 track 返回的 detach 移除登记。
一个清理动作报错时仍执行其余清理，再聚合报告。
构造函数每取得一个资源或节点所有权，就立即向 Scope 登记；创建可能抛错的子 View 前先拥有其节点子树。
部分构造失败时 `scope.rollback(originalError)` 逆序执行全部清理，再抛原始错误；若清理也失败，FrameworkError.causes 同时保留两者。该方法只处理同步回滚，不会等待 Promise，异步模块仍由 ModuleHost 处理。
正常退出 dispose，构造失败 rollback，两条路径复用同一所有权清单；不得用“对象未构造完成、调用不到 dispose”作为残留资源的理由。Cocos destroy/帧末释放只代表已请求释放，不等于 GPU 显存即时归零。

Kernel.Contracts提供runCleanups与rollbackCleanups，适用于没有独立Scope的同步多项收尾。前者按给定顺序逐项执行并聚合错误，后者同时保留原始失败；传入方负责生命周期顺序，不能把返回Promise的异步操作当作已等待完成。
SequenceContext先冻结取消状态并清空监听集合，再尝试所有取消监听。SequenceTask即使某监听或效果cancel失败，也继续回收替身并通知结算；重复取消不重复清理。

EventBus 同步、按注册顺序广播；一次广播使用监听器快照。
广播中新加监听器从下次开始；已取消监听器不会再调用。
once 在调用之前注销，递归触发同一事件不会再次调用该 once。
监听异常在其余监听执行完后报告；可注入统一错误处理器。
事件用于通知；重要状态转换先原子提交，再通知，不能依赖监听器链完成事务。
不强制 MVC/MVVM/ECS，Cocos 组件负责展示和输入，项目自行选择上层组织方式。

## 5. 资源与 Bundle

ResManager.acquire(path, AssetType, { bundle, scope, timeoutMs }) 返回 ResourceHandle。
Handle.value 是 Asset，release 幂等；绑定 scope 后随其结束自动释放。
资源标识包括 bundle、path、Asset 构造类型，避免跨 Bundle/类型串用。
同键物理加载共用，默认最大物理并发为 4，可配置。
每个缓存项持有一次引擎 addRef；多个逻辑消费者计数独立。最后一个消费者退出后才进入闲置缓存。
默认最多保留 16 个闲置条目，可通过 AppOptions.idleResources 配置为 0；这不是字节/显存预算。
重要项目需结合实际贴图、纹理压缩、内存压力与设备分档设置资源策略。

资源退出通过 decRef 交给引擎引用检查，不对共享资源直接调用 releaseAsset。
当前消费者取消/超时会立即拒绝并释放其逻辑持有，不影响其他消费者。
Cocos 底层物理请求可能无法中止：迟到成功结果会按缓存生命周期处理。
逻辑超时不会新开同键物理加载，也不会假称网络下载已取消。
若底层永不回调，该物理槽位仍占用；默认依赖 Cocos 下载器的超时机制。远程 Bundle 长期弱网仍需实测。
缓存 dispose 不允许仍有活动消费者；应先关闭场景/界面/音频/项目 Scope。
Bundle 移除先清理闲置资源，再检查活动资源和加载；resources 内置包不卸载。

预加载使用调用方 Scope 持有。关键资源失败整批回收，非关键失败记录在 PreloadReport。
仅在完成批次后提交可用状态。进度回调异常也要清理批次。
单个失败/取消不得留下无主引用。统计提供 entries、owners、loading、queued、peakConcurrency。
不再报告伪造的“真实显存用量”，也不承诺零 GC。

FW-01补充：retain失败、retain后回滚失败和闲置释放失败均不会留下永久拒绝的同键缓存项；单项释放失败不跳过其他可释放项或关闭时的排队请求。ResourceDriver.retain须原子化，Cocos适配器按refCount撤回部分addRef副作用，资源所有权只释放一次。
ResourceCache.lastError保留最近后台ready失败，driver可选onError用于桥接诊断；观察器抛错会聚合到缓存lastError而不另建未处理拒绝。ResManager.lastError保留包括旧缓存代次迟到的错误，重新init不会清空；正常取消也可能记录，不能据此推断当前App失败。同步release/dispose错误仍由调用方接收。
资源仍有owner时dispose拒绝且不破坏活动缓存；无owner时退出即使某decRef报错也解除已退出缓存，使后续init可用。外部引擎release抛错后是否真正释放无法由框架证明，不自动重复decRef掩盖错误。

## 6. UI、池、动画与音频

UIManager.init(root) 显式注入具有 UITransform 的根节点；不搜索固定 Canvas 名。
register 提供预制体路径、Bundle、层级、缓存策略和模态属性。
同一界面加载合并；关闭加载中的界面取消对应 Scope，迟到预制体不挂载。
预制体缺少 UIBase 时明确失败并释放。打开失败不锁死后续 UI。
缓存界面隐藏时结束 showScope，实例资源仍持有；destroyUI 结束 lifetime 后释放预制体。
默认不缓存；keep 由项目显式配置。UI 缓存拥有独立模态遮罩，尺寸由 Widget 对齐。
UIBase 派生类如覆写 onDestroy/onDestroyUI，必须调用父类清理。
页面导航等待新页打开成功后再更新栈，保留返回参数。
多实例窗口、弹窗业务优先级队列、窗口热更新不在 V1 接口内。

GameObjectPool 为每个池持有预制体引用，维护闲置/借出状态，重复归还报错。
组件实现 onSpawn/onRecycle，通过实际 Component 实例调用，不能以接口名 getComponent。
可注入 2D/3D 重置适配器；默认不清空项目原本的材质和颜色。
自定义动态材质使用 SpriteMaterialHelper 的显式绑定/释放。
清池包含活动节点清理；回收回调异常仍完成节点和引用收尾。
UIPool 是可选低层节点缓存，UIManager 不使用它，不能用它替代资源所有权管理。
池/界面隐藏之前先结束输入与动画作用域；不假定隐藏节点就会自动清理任意全局任务。

音频不依赖存档、战斗暂停或固定资源路径。
最大音效数包括正在加载的请求；满载时返回 false。
使用 AudioSource.ENDED 回收，不使用受游戏倍速影响的估算时长计时器。
BGM 请求用 token 隔离，dispose 拒绝迟到结果；音量不默认写盘。
移动浏览器/微信的音频授权、后台恢复、静音切换仍需真实设备验证。

FW-01补充：UI层节点、实例初始化、遮罩及显示失败都执行部分构造回滚，原错误和回滚错误保留；onInit/onShow若退出并重建服务，旧任务不能发布到新代次。已实例化的keep视图在onShow内关闭自身不会误取消预制体owner。
UI关闭报错仍结算dialog并尝试销毁，实例停用/销毁先于父资源Scope结束。音频部分节点/AudioSource/播放失败会回滚，stop失败仍清理其余声音与句柄；旧请求finally只减少旧代次的pending额度。
配置表、低层UI池、动画集合和材质集合均逐项收尾，登记先于可能失败的播放或配置；失败后可重新初始化，不能将异常当成实际引擎释放已成功的证明。

Tween 有真实实现和取消句柄；无效/隐藏目标终止，不保留空方法假装完成。
序列帧禁用时停止；特效分阶段回调防重复，取消时一次性归还替身。
虚拟列表仅创建可见行及缓冲行节点，支持空数据、缩容、绑定检查和监听解绑。
虚拟列表限定纵向固定单元网格，不承诺可变高度、任意布局或无限列。

## 7. 平台、存储与其他可选模块

PlatformManager 区分 Web、微信和未完整实现的原生平台。
不支持的能力返回 unsupported；广告只有显式 isEnded=true 才是 completed。
分享请求返回 requested，不等于真实分享成功，更不能由停留时长推断奖励资格。
微信广告防并发并设置回调超时，结束时解除监听并销毁实例。
没有项目注入的广告 ID 就不播放；没有默认线上广告位。
FW-01补充：offClose/offError/destroy任一抛错仍尝试其他项，结果Promise始终结算、adPending解除，错误附在CapabilityResult.error。仅明确isEnded=true仍为completed，取消/失败不会被清理错误改为成功；同步回调或迟到load不再调用已结束广告的show。本批广告验证使用wx替身，不是实际广告平台验收。

HTTP 由项目配置 HTTPS baseUrl 和 headers；不内置登录、旧游戏 token 失效弹窗或 POST 自动重试。
V1 仅封装 HTTP JSON，WebSocket、断线重连、上传下载和幂等业务协议不在首版内。
存储使用项目命名空间、JSON schema 版本、串行 flush。
写入成功后才确认保存 revision；写入期间的新变更继续保存，失败保持 dirty。
存储读取/格式错误不自动删档。不使用 XOR/hash 冒充加密或防作弊。
目前没有加密、跨进程事务、云存档、崩溃原子替换或后台同步刷盘保证。

红点为内存派生计数，持久化由游戏决定；红点不隐藏自身宿主导致断订阅。
I18nLabel 接受翻译提供者，不固定配置表名或语言。
引导由项目注入步骤，不再控制战斗暂停、完成标志或固定引导预制体。
GM 默认禁用，没有内置修改金币、清档或远程执行命令。
相机由项目显式传入，框架不强改可见层、创建 3D 相机或搜索 Canvas。

## 8. 诊断与验证

PerformanceMonitor 只保留 60 个趋势样本；场景节点遍历最多每秒一次。
每个 timing 系列最多 240 个样本，最多 32 个系列，提供 p95/max。
DebugPanel 文本更新节流到 0.5 秒；仅项目主动挂载时启用。
当前没有平台级真实 GPU 内存、DrawCall 预算、崩溃收集或线上告警服务。

npm run check 使用 Creator 自带 TypeScript 5.8.2 和本工程生成的真实 cc 声明。
额外扫描业务残留、Kernel 跨层依赖以及 Map/Set 数组展开的 Creator 转译风险。
测试替身验证契约，真实 Web 自检验证引擎启动和 JsonAsset 所有权；两者不能互相代替。
发布前仍需真机性能、资源切换压力、音频与平台能力故障验证。

## 9. 原模块迁移结论

| 原模块 | V1 处理 |
|---|---|
| App / ModuleSystem / 生命周期工具 / Timer | 改为显式组合、纯内核契约和唯一帧驱动 |
| GameConst / EventCenter / DataCenter | 移除游戏字段；框架事件与项目 schema 分离；数据不自动落盘 |
| ResManager / BundleManager / PreloadManager | 重建句柄所有权、并发、取消、失败收尾；删除路径式释放和伪显存策略 |
| UIManager / UIBase / UINavigation / SafeButton | 显式根节点、异步打开、分离显示/实例寿命；不覆写私有触摸方法 |
| Pool / UIPool / 材质助手 | 修正接口查找、归还参数、重复回收、活动对象清理与动态材质释放 |
| Audio / AudioConst | 去固定路径、战斗分类和存档副作用，改为通用通道和事件回收 |
| ConfigManager | Bundle+表名隔离、取消分片索引、重复行校验、明确资源归属 |
| Save / Ad / Share / Http / Platform | 删除具体产品策略与虚假成功，按项目启用 |
| 红点 / 多语言 / 引导 / GM | 提供者/步骤/策略注入，删除固定业务 |
| 动画 / Tween / 特效 | 补全空实现、统一取消、处理重复完成和异步迟到 |
| PathUtils | 删除塔位生成规则，保留真正通用的 3D 路径采样 |
| SafeArea / Billboard / 列表等组件 | 保持可选；适配严格空值、布局和生命周期 |

## 10. FW-02～FW-04新增能力

| 批次 | 实际实现 | 接入边界 |
|---|---|---|
| FW-02 | Kernel.PauseController；TimerManager具名原因/独立租约；RuntimeLifecycle前后台/音频/显式flush；ViewportLayout/ViewportService；四边SafeAreaAdapter | 可选生命周期与视口服务必须由项目显式接入；不修改Game，不强改全局分辨率 |
| FW-03 | App默认PlatformRuntime能力检测/网络变化/低内存闲置清理；窗口/胶囊查询；SubpackageLoader；Bundle来源与版本；HTTP取消/超时及GET显式重试 | 没有自动登录、广告位、线上请求或磁盘清空；真实平台仍需验证 |
| FW-04 | 独立2D/3D示例及专用Bundle；导出依赖/meta/路径边界检查；静态release/体积预算工具；完整说明与测试 | 导出默认不带示例；构建静态通过始终不等于productionReady或负责人验收 |

### 10.1 暂停与保存

PauseController.set用于幂等具名开关，hold返回一次性释放租约；同名hold互不撤销，snapshot为只读快照。观察器异常聚合，未交付的hold失败会撤回自己的租约。
TimerManager保留旧setGroupPaused接口的legacy原因；新holdPause与其他原因独立，GAME暂停不冻结UI通道。定时器退场清空本代次原因，旧释放函数不能干预新代次。
RuntimeLifecycle为可选Module，依赖timers。它在原生前后台回调中记录错误并尽力flush；保存必须项目显式注入，正在写入的flush合并，失败保持由存储层管理的dirty状态。后台操作系统可能终止进程，不提供强制同步刷盘保证。
若传入AudioSystem，则统一控制全部已持有声音的暂停，暂停时新声音等待恢复；不改变用户静音选择。项目如需UI声音继续播放，应另行配置其音频策略，不假设一个全局布尔值适合全部产品。

### 10.2 屏幕、输入与相机

ViewportLayout使用设计空间左上原点、视口空间左下原点；安全区和额外顶部保留区先求可用矩形，再等比contain。设计/输入的往返和相机参数来自同一份布局；不允许视觉、命中各算一套缩放。
ViewportService从view读取设计坐标与物理viewport/scale，从screen读取物理windowSize；相机路径不再次除DPR。非等比EXACT_FIT无法维持相同3D比例时明确拒绝。服务不创建Canvas、不改项目设计分辨率、层或相机可见性；调用方传入内容根和正交相机。
SafeAreaAdapter保存并恢复四边Widget原始偏移，重复适配不累加；胶囊保留区与设备刘海安全区分开。独立示例展示按胶囊底部与safeArea.top差值保留额外顶部空间。
本轮独立示例在真实浏览器DPR2下验证2D参考框与3D白块对齐；当前游戏仍使用其旧TableProjector/相机路径，迁移属于游戏/UI融合任务。

### 10.3 微信、Bundle与请求

PlatformRuntime只绑定具备配对on/off的全局事件，退出注销、迟到事件忽略。低内存只清ResManager闲置资产，活动owner保持；磁盘clearLRU为显式调用，不自行删除存档或clearCache。
窗口优先getWindowInfo，旧SDK按能力回退；只返回布局字段。getNetwork提供消费者取消与逻辑超时，网络状态不存在时不伪造wifi成功。
BundleManager保留Cocos原生下载/磁盘缓存格式：可注册本地名称或HTTPS来源、version、xhrTimeout和0～2次重试。同源多别名注册拒绝；引擎实际共享Bundle的别名逐项释放，其他别名仍在时不物理卸载，也不允许直接换版本。
Cocos资产分包通过loadBundle；SubpackageLoader仅包装原生代码分包，物理同键共享、每消费者取消/超时/进度隔离。无API时明确unsupported错误；平台没有中止API时，逻辑超时不代表物理下载停止，迟到完成不能复活退出服务。
HTTP消费者通过Scope取消；Web中止fetch，微信中止RequestTask。超时即使底层不回调仍结算。HttpManager默认不重试，仅GET可明确选择0～2次有界重试，4xx/解析错误/取消不重试；不自动重试写请求。

### 10.4 独立复用与静态检查

assets/FrameworkExamples是独立验证场景，只有一个App帧驱动；Content是framework-demo专用Bundle。它不导入Game/UIRuntime，也不需要广告ID、账号、线上服务或第三方依赖。
tools/framework-release.mjs可审核、导出和检查构建；导出仅允许新建项目build下的目录，不覆盖旧产物；拒绝越界导入、缺meta/重复UUID及可跳转其他目录的符号链接。可选择携带示例并检查其依赖边界，附独立接入说明和资产哈希清单。
构建检查要求对应入口、平台与debug:false，并报告实际文件数/未压缩字节；可传maxBytes预算。原始目录字节不是微信上传压缩包大小，不代替平台包体规则。默认没有猜测的设备或SDK限额，productionReady始终为false，设备验收另行记录。

参考依据：[Cocos屏幕事件](https://docs.cocos.com/creator/3.8/manual/en/engine/event/event-screen.html)、[Asset Bundle及版本](https://docs.cocos.com/creator/3.8/manual/en/asset/bundle.html)、[CacheManager](https://docs.cocos.com/creator/3.8/api/en/class/AssetManager.CacheManager)、[微信官方小游戏API类型定义](https://github.com/wechat-miniprogram/minigame-api-typings/blob/master/types/wx/lib.wx.api.d.ts)。实现同时核对本机3.8.8引擎源；本项目未安装该类型包。

原有 .ts/.meta 未删除或迁移；旧源码通过原路径重构，旧 API 不是兼容承诺。
现有 Main 的灯光和相机保留，仅追加常驻 Bootstrap。生产场景应关闭 runSelfCheck。
没有安装软件/插件/依赖，没有 Git 提交、推送或发布。

## 10. 参考依据

- Cocos 官方资源引用管理：https://docs.cocos.com/creator/3.8/manual/en/asset/release-manager.html
- Cocos 官方组件生命周期：https://docs.cocos.com/creator/3.8/manual/en/scripting/life-cycle-callbacks.html
- Cocos 官方命令行构建：https://docs.cocos.com/creator/3.8/manual/en/editor/publish/publish-in-command-line.html
- Oops Framework 项目/示例边界：https://github.com/dgflash/oops-framework
- MKFramework 模块能力与生命周期参考：https://github.com/1226085293/MKFramework

以上用于架构参考，未下载或引入其第三方代码/依赖。
