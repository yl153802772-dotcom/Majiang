# DeepSeek Harness · GAME-UI-01 通用框架接入与 UI 融合执行任务单

<!-- 中文注释：本单合并负责人本次要求的游戏接入整改与此前已批准的UI-MVP-01；批准执行不表示实现完成、独立复核通过或负责人验收通过。 -->

日期：2026-10-27。工作区：`/Users/liang/Projects/Majing`。引擎：Cocos Creator 3.8.8。执行者：DeepSeek Harness；独立复核：Codex；最终需求审批和验收：项目负责人。

## 1. 目标、批准状态与完成边界

**状态：已批准执行，尚未实施。** 依据为负责人本次要求“写出代码实施计划，分配给deepseek harness进行编码”，并明确把此前已批准的UI-MVP-01带入本次代码执行。按本文范围自主完成实现、范围内修复和验证；超范围事项遵守项目审批规则。本文不能代替实际工具权限。

本批交付一个在现有 Main 直接启动的真实游戏：**最新通用框架能力实际接入 + 新美术/Prefab + 原有 MVP 玩法 + 真实交互/终局/重开**。不得再交静态空桌、独立样例或仅经过截图修饰的展示版。用户提供的“任务结果：已完成”指此前执行任务单编写完成，不表示UI融合代码已经完成。

| 层级 | 本批完成条件 | 不得混淆的结论 |
|---|---|---|
| L1 内部融合可测版 | 本文 J01～J19 全部通过，新 Creator release Web 包真实触摸，交 Codex 独立复核及负责人测试 | Harness完成不等于Codex复核通过，更不等于负责人验收 |
| L2 完整 MVP | 继续要求真实轻3D物理、微信开发者工具、至少一台主流手机及负责人验收 | Web/Chrome只能承担L1，不能作为唯一最终验收环节 |

本批不启动 G06 物理后端改造；保留现有真实3D牌体和表现，不能降成桌面平面截图。L2缺口如实列出，不能为了“完成本单”删除原定物理或平台验收要求。具备现成合法环境时允许第10节所列本地平台验证。

## 2. 必读输入与最新基线

先读 [根规则](../../AGENTS.md)、[Game规则](../../assets/Game/AGENTS.md)、[需求入口](../README.md)、[项目进度](../项目进度.md)。以下资料在本地逐一读取；不要假设其他聊天、模型、权限或文件自动共享。

| 类别 | 必读文件 |
|---|---|
| 已确认需求 | [MVP_FINAL](../01_需求定稿/MVP_FINAL.md)、[游戏架构V2](../02_架构与接口/MVP_GAME_ARCHITECTURE_V2.md)、[契约V2.3](../02_架构与接口/MVP_V2_CONTRACTS.md) |
| 开发约定 | [Harness规则](DEEPSEEK_HARNESS_RULES.md)、[验收](MVP_V2_ACCEPTANCE.md)、[任务表](MVP_V2_TASKS.md) |
| 最新通用框架 | [Framework README](../../assets/Framework/README.md)、[框架架构](../02_架构与接口/FRAMEWORK_V1_ARCHITECTURE.md)、[接入与验收](通用框架_接入与验收.md)、[FW-01报告](../../docs/reports/FW-01.md)、[FW-02～04报告](../../docs/reports/FW-02-04.md)及涉及的实际源码 |
| 可参考的真实接入 | [FrameworkExamples说明](../../assets/FrameworkExamples/README.md)、其FrameworkDemo/DemoDialog实现；只读参考，不挂到Main、不复制成第二套驱动 |
| UI完整前置要求 | [原UI-MVP-01执行单](../../UI/_docs/DeepSeek_UI-MVP-01_融合可测版执行任务单.md)全文，特别是F1～F3、I01～I16；本单明确替换的旧接入方式以本单为准，其余不删减 |
| 美术依据 | [UI制作说明](../../UI/_docs/UI框架与预制体制作说明.md)、[资源清单](../../UI/_docs/资源清单.md)、[机器清单](../../UI/_docs/resource_manifest.json)、[拼装预览](../../UI/_preview/ui_assembly_v1.jpg)、[风格参考](../../UI/_source/reference.png) |
| 历史证据 | [UI-ART-01](../../docs/reports/UI-ART-01.md)、[R02-CLOSE](../../docs/reports/R02-CLOSE.md)、[R03加固](../../docs/reports/R03-HARDENING.md)及其证据；不是本批测试结果 |

**当前正式规则仍为 V2.3 / 888-v3。** 不改 Domain/Application、关卡、牌池、Group、坐标、blockedBy、推荐序列或公开快照/事件契约。旧游戏架构V1及历史报告不与当前需求叠加。

最新历史基线：FW-02～04完成时 strict 112源文件（Framework79、Game30、Examples3），框架测试169/169，游戏159/159，分层自检18拒绝/6接受。随后只读游戏接入审查跑过161项框架相关测试及159项游戏测试；161不含8项会写临时夹具的FW04工具测试，不是总数回退。本批开工/完工必须重跑四项完整检查，按实际结果记录，不照抄历史数字。

已确认的接入问题，供编写回归测试：

| 编号 | 证据位置与现象 | 本批应解决的结果 |
|---|---|---|
| F-G1 / P1 | `GameRoot.refreshViewport`混用物理像素与除DPR后的尺寸；`TableProjector`又在世界坐标叠加fit缩放。原720×1280内容、DPR2的独立探针中，半高3.2而应为6.4，设计点(100,300)落到(400,3920)而应为物理(200,1960)；有安全区时还会重复缩放 | 用框架共享视口统一2D、3D和输入，替换旧计算；不以当前错误投影为测试预期 |
| F-G2 / P2 | `GameBootstrap.onDestroy`先释放静态owner，再异步dispose App。真实App类故障探针中旧实例销毁后新实例立即onLoad，报`App is disposing`，新局未启动；同实例retry不能覆盖此问题 | 场景实例之间有完整关闭屏障和所有权代次，旧回调不能清理新App |
| F-G3 / P2 | 当前hide/show直接调用GameRoot布尔pause/resume，未接多原因协调和GAME定时器 | 后台、手动暂停、帮助/模态独立持有暂停原因，任何单个解除不能误恢复游戏 |

F-G1/F-G2是上一轮只读独立探针结果，本单没有修复它们。F-G3不等于已证明原生后台持续运行：Creator自身也有前后台暂停；本批修的是多原因一致性与游戏接入缺口。

UI遗留仍须处理：真实嵌套关联缺失；ProgressTrack高度12小于上下Border合计16；390×844裁切；预览依赖临时视图覆盖；字号、对比度和对齐不足。70 PNG、11 Prefab、2场景的存在不能代替这些验收。

## 3. 必用框架能力与允许保留的实现

**交付一张接入实证表：能力 → 实际文件/方法 → 初始化/作用域/退出 → 对应用例及运行证据。只导入、写TODO、包一层同名类或运行独立示例不算游戏接入。**

| 能力 | 本批必须采用的接法 | 禁止的替代方式 |
|---|---|---|
| App / ModuleHost | 唯一GameBootstrap通过公开App API装配；声明模块依赖，await init/start/dispose；唯一帧驱动 | 同时挂FrameworkBootstrap/示例启动器；第二套App或模块宿主 |
| ViewportService / ViewportLayout | 一份设计尺寸720×1280的共享视口；内容根applyContent、全屏牌相机applyCamera；输入使用匹配的ui/pixels布局 | GameRoot继续混用DPR；复制一套通用fit；世界坐标和相机各缩放一次 |
| PauseController / RuntimeLifecycle | 每个App代次一套，作为模块接入；RuntimeLifecycle依赖timers；游戏输入/update/效果消费同一状态 | 单个resume清掉全部暂停；重复监听hide/show；只停GAME定时器就声称所有表现已暂停 |
| TimerManager | 业务延时进入GAME通道，UI交互不受其暂停；通过框架租约协调 | 新建Game定时器管理器；菜单关闭直接全局解除GAME暂停 |
| LifecycleScope / 收尾工具 | 场景、当局、弹窗展示分层；逐项回滚、逆序清理、原始错误和清理错误可观察 | 构造返回后才登记唯一清理；空catch；迟到资源挂新局 |
| UIManager / UIBase | App传入真实uiRoot；HUD/暂停/帮助/结果由现有UIManager管理；Prefab根挂真实UIBase派生薄适配组件，使用lifetime/showScope | 第二个UIManager/页面栈/通用弹窗管理器；把普通HudView当Component拖入Prefab |
| ResManager / BundleManager | 加载Prefab/显式SpriteFrame通过acquire及scope/handle；真实Bundle路径，正常重开复用；依赖随Prefab资源持有 | `resources.load('UI/...')`虚构路径；裸load、releaseAll、每次点击重载或自行decRef他人资源 |
| PlatformRuntime / 安全区 | App默认已装配平台服务，复用readWindow和能力检测；胶囊区额外占用只预留一次；四边安全区统一归属 | 再init同一平台服务、业务直接新增wx监听；任意清微信磁盘缓存/存档 |

不要求为“全用框架”而迁移全部现有实现：Domain/Application仍为纯TS，GameSession仍为唯一状态写入者；不能塞入StateStore或另加单例事件总线。BoardResources持有的程序化Mesh/Material不是路径资源，继续由场景owner销毁。现有有界12替身池、TouchPerformanceRecorder可保留，不改采样算法；若保留本地动画调度，其取消/暂停/退出必须消费共享状态，不再实现通用暂停服务。

存档、音频、广告、登录、HTTP、远程资源、代码分包和ECS不是本批新增需求。没有使用场景写“本批不适用”，不要为了接入率启用它们。Asset Bundle经BundleManager加载，不能同时用SubpackageLoader重复加载同一份Cocos资产。

## 4. 修改白名单、保护范围和派生产物

### 4.1 允许改动

| 路径 | 具体用途/上限 |
|---|---|
| `assets/Game/Bootstrap/GameBootstrap.ts` | 装配最新框架、UI根、启动/重试/关闭屏障、错误入口，保留唯一驱动 |
| `assets/Game/Bootstrap/GameAppLifecycle.ts` | 可选新增：仅协调GameBootstrap实例的App所有权、代次及关闭Promise；调用公开框架API，不重写App/ModuleHost |
| `assets/Game/Bootstrap/UIArtPreviewBootstrap.ts` | 可选新增：预览视图初始化；不创建App/GameSession，不复制游戏启动器 |
| `assets/Game/Presentation/{GameRoot,TableProjector,EffectPresenter}.ts` | 共享投影、真实UI绑定、暂停与取消适配 |
| `assets/Game/Presentation/Table3D/{BoardView,BlockView}.ts` | 牌体/牌面/描边/遮挡及视觉布局，不启用新物理后端 |
| `assets/Game/Presentation/UI/` | 既有View/BoardInput适配；必要的UIBase派生页面、类型化绑定及2D槽牌组件；不加入规则或平行管理器 |
| `assets/Game/Presentation/BoardLayoutTransform.ts` | 可选新增：唯一逻辑牌区与美术内框正逆变换；也可集中到TableProjector |
| `assets/Game/Config/PresentationConfig.ts` | 仅区域、字号、颜色、表现尺寸与资产路径常量 |
| `assets/UIRuntime/Prefabs/Components/`、`Prefabs/Pages/` | 修嵌套/样式/绑定；新增最小暂停/帮助/结果Prefab，不新增玩法页面 |
| `assets/UIRuntime/Scenes/UIArtPreview.scene`、`UIArtSamples.scene` | 预览关联及可持久重复启动 |
| `assets/UIRuntime.meta` | 本单新增的明确资产配置范围：用Creator把现有UIRuntime配置为本地`game-ui` Asset Bundle，保留UUID；只改对应Bundle字段，不改项目全局设置 |
| `assets/UIRuntime/Art/**/*.png.meta` | 必要导入/切片修复，保留UUID和所有PNG字节 |
| `assets/scenes/Main.scene` | 现有启动器、根/相机/UI引用与必要装配，保留场景UUID |
| `tests/game/{presentation,startup-lifecycle}.test.mjs` | 定向加强投影/装配/失败回归，保留原有语义覆盖 |
| `tests/game/game-ui-*.test.mjs`、`tests/game/fixtures/game-ui-*.mjs` | 新增本单接入、Prefab、暂停、生命周期和融合测试；不得改正式关卡 |
| `tests/support/cc-mock.mjs` | 只补实际用到的API与自洽单位数据，不伪造必定成功的加载/投影 |
| 六份正式文档 | `需求设计/01_需求定稿/MVP_FINAL.md`仅表现增补；`需求设计/02_架构与接口/MVP_GAME_ARCHITECTURE_V2.md`；`需求设计/03_开发规范与验收/`中的`MVP_V2_ACCEPTANCE.md`、`MVP_V2_TASKS.md`、`DEEPSEEK_HARNESS_RULES.md`；`需求设计/项目进度.md`。仅同步本批真实接入/表现/进度，不改玩法/契约版本 |
| `docs/reports/GAME-UI-01.md`、`docs/reports/GAME-UI-01-evidence/` | 新报告、接入表、逐项验收、哈希、截图、构建/运行日志和负责人手测表 |

新TS/Prefab/目录由Creator产生有效meta，既有UUID保留；不猜序列化脚本类型ID。没有保存/验证编辑器资产的能力就报告阻断，不能手改出“看起来像Prefab”的文件冒充运行交付。

### 4.2 禁止改动

- `assets/Framework/`及其测试、`assets/FrameworkExamples/`、所有AGENTS、工具/测试加载器、package/tsconfig、settings及全局配置。
- Domain、Application、Level888、RecommendedSolution888、契约V2.3、牌池/Group/坐标/blockedBy/推荐序列；不允许调牌消除测试失败。
- `TouchPerformanceRecorder.ts`采样算法；原PNG字节、整个`UI/`源包和旧任务文档；既有报告/证据/构建。不删除历史失败材料。
- 其他未列路径；不安装软件/依赖/插件/字体、不执行Git操作、上传/发布、不访问其他项目。
- 根`开发日志.md`由Codex按交付和独立复核维护，Harness不代写。

允许Creator在本项目`library/`、`temp/`、`profiles/`产生必要导入/预览缓存，不手改缓存代替源码。新产物只写`build/mvp-v2-game-ui01-web/`、必要时`build/mvp-v2-game-ui01-web-diag/`和本地`build/mvp-v2-game-ui01-wechat/`，不覆盖旧包。允许本批四项检查、现有框架audit、Creator保存/导入/预览/本地构建、真实浏览器触摸及无状态注入的取证。

以上是对原UI-MVP-01白名单的合并细化，新增GameAppLifecycle、game-ui Bundle元数据和game-ui测试路径。若仍需改框架公共API/其他meta/配置，暂停受影响分支，提交最小新增路径、原因、风险和验证方式，等负责人批准；可继续无冲突的已批准部分。

## 5. 分步实施与阶段门槛

### T0 · 基线和接线确认

1. 输出简短开工记录：任务ID/已批准范围、工作区、Creator/Node/工具能力、实际文件状态。枚举源文件和保护哈希，区分已有他人变更。基线不符先报告，不覆盖或自行纠正。
2. 实际跑四项检查，保留完整结果。读取上述框架源码和示例，先填写第3节接入表的计划调用点、资源路径和依赖顺序；完工时换成实际证据。
3. 确认Main仅一个GameBootstrap；不挂FrameworkBootstrap。列出scene scope、round scope、UI showScope、资源handle及暂停租约的所有者和退出顺序。
4. 先补能复现F-G1/F-G2/F-G3的独立断言，保留修复前失败和修复后结果。不依赖旧报告一句“通过”替代当前基线。

组合顺序须明确：先等前代退出并建立本代根/相机和uiRoot；再由唯一App初始化resources/timers/platform-runtime/ui及本批runtime模块；游戏模块显式声明所用依赖，资源/UI就绪后才装配GameRoot和唯一GameSession；成功后启用唯一帧驱动。初始化失败沿本代作用域回滚，不提前使用尚未初始化的UI/资源单例。

### T1 · 统一视口、牌桌和命中映射（先解决F-G1）

1. 运行时设计尺寸保持720×1280，本批不改全局1280×720项目设置；由入口持久初始化，不能截图前在控制台补视图。独立美术预览也有可保存重进的初始化入口。
2. ViewportService是唯一安全区/contain适配来源。`getUILocation`对`snapshot.ui`，物理屏幕点对`snapshot.pixels`；记录坐标原点和单位。禁止把`screen.windowSize / DPR`与物理viewport/scale拼在一起。
3. 保留一个游戏专有变换：原Level逻辑牌区 → 新美术牌桌可用内框；再接通用视口。逆向输入只反算各层一次。世界坐标采用未重复fit的设计单位，牌相机用`applyCamera`处理屏幕fit；不能保留旧TableProjector世界缩放再套新相机缩放。
4. 3D牌体、2D牌字、描边/听牌高亮、飞牌起终点、副/底槽、触摸区域使用同一链；尺寸/厚度比例也应一致。12像素滑动阈值先在720×1280内容设计坐标判断，再转逻辑牌区命中，不随牌桌局部缩放漂移。真实blockedBy和重叠优先级不变。
5. UI内容contain，背景可cover；牌桌1024×753图与706×595容器等比适配，记录留白/边框及可用内框。背景、牌、HUD/弹层三相机层级及整棵子树layer正确；正式入口分别加载背景/HUD，不用含不透明背景的整页Prefab盖住牌。
6. 通过PlatformRuntime读取窗口/胶囊能力，转换为当前视口同一单位。`reservedTop`只补安全区尚未覆盖的胶囊占用，不重复加安全区；没有SDK时按已有能力降级。Canvas/SafeArea/Widget不得在同节点同轴重复控制。
7. viewport变化、resize、前后台恢复时刷新；进行中效果重投影或安全取消。不得通过改Level坐标/牌池、整体隐藏3D或扩大hit框掩盖错位。

**投影必测：** 720×1280、390×844、720×1130；DPR1/2/3自洽矩阵（物理windowSize、viewport、view scale须一致）、非零viewport原点、上下40安全区及左右安全区/胶囊占用。无安全区720×1280设计点(100,300)应分别落到物理(100,980)/(200,1960)/(300,2940)，`unitsPerPixel=0.01`时全屏相机半高均6.4。若上下各40，手算内容scale=1200/1280=0.9375，该点应为(116.25,958.75)。这些是共同设计点校准，不把旧逻辑牌区点误当新美术点。

正逆误差≤1设计像素。**另用相机投影独立验证世界点→物理屏幕**，不能只正反调用同一错误函数证明往返；在运行包真实点击中心/边缘/B05/B11重叠处及双块两半。旧startup测试只改windowSize/DPR而保留scale=1的夹具必须加强，不能继续据此证明DPR正确。

### T2 · 场景替换与App关闭屏障（解决F-G2）

1. 可在Game组合层保留最小所有权协调器，记录owner/代次/共享关闭Promise。它不拥有第二个App或模块宿主。禁止访问FrameworkBootstrap私有shutdownTask，禁止同时挂通用启动器来“借用屏障”。
2. 新实例必须等待旧实例App.dispose及其场景/UI/资源收尾完成后再init/start；关闭开始即停旧帧驱动和命令入口。每个await后检查本实例/代次有效性，退出后的init、加载、错误UI不能复活。
3. 同场景真正重复启动器应可诊断拒绝；合法新场景实例不能因旧onDestroy稍晚而永久被当成重复。覆盖“旧先销毁，新再加载”和“新onLoad先到，旧onDestroy随后”两种顺序；以实际场景实例和租约判定，不只看静态非空标记。
4. 旧实例迟到onDestroy、finally、重试不能dispose新App、销毁新UI或清新owner。退出幂等；单项收尾失败仍处理其余项，保留原始和清理错误。前代退出失败不得默默显示成功或无条件接管未知残态；按框架实际状态作可见错误及受控重试。
5. App模块依赖保证先关游戏/弹层节点及持有者，再关闭共享UI/表现/资源；异步退出先await，不能把Promise塞进仅同步执行的清理工具并误判已完成。

启动失败提示和重试入口须保留原生Label/最小底板兜底，不依赖正在加载失败的game-ui资产，否则资源错误会连重试界面一起丢失。

**必测：** 旧init未完成、旧dispose未完成/拒绝、加载晚到、同实例并发retry合并、两种场景替换顺序、真实重复启动器、旧destroy在新局运行后到达、重复cleanup及错误页重试。至少一组回归使用生产App/ModuleHost配合故障驱动，不能只mock成永远resolve；再用Creator实际切换/重建验证。

### T3 · 共享多原因暂停（解决F-G3）

1. 每个App代次新建一套PauseController和RuntimeLifecycle，注册显式模块依赖；RuntimeLifecycle本身不可dispose后复用。复用App已有PlatformRuntime，不再新增wx/hide/show平行监听。
2. RuntimeLifecycle管理background，菜单/帮助用独立`hold(reason)`租约；租约归展示scope所有，关闭/失败/销毁只释放自身一次。同名两个持有者也不能互相解除。
3. GameRoot输入、游戏update、飞牌/大招效果和结果延时读同一暂停状态；GAME定时器由框架协调，UI通道和继续/关闭/重开保持可用。无需为不存在的音频/存档业务填flush或启用模块。
4. 暂停/帮助覆盖期间不允许取牌，不暂停整个引擎导致菜单失效。切后台取消未完成手势；恢复不补算、不复用旧触点。重开清旧局手势/表现但保留仍有效的后台/弹层原因；菜单重开可明确关闭菜单，只释放它自己的租约。
5. 弹层首次加载期间也要阻止牌桌穿透；打开成功前的临时阻断租约在成功交接/失败/取消时正确转移或释放，不能出现一帧空窗或加载失败永久锁住。

**必测：** 菜单→帮助→关闭帮助仍暂停；手动暂停→后台→恢复仍暂停；关闭最后原因才恢复；失败/重复打开/销毁不泄漏租约；弹层开着重开和后台期间重建；旧手势松开不提交。分别记录替身事件单测和真实浏览器隐藏/恢复，不能把手调update探针当原生后台事实。

### T4 · 真Prefab、资源持有与新UI装配

1. 修复组件→HUD→整页→预览嵌套关联；保留组件实例override。做一次可恢复的可见样式传播验证，恢复后保存/重开；交Creator关联/Inspector证据，不能只数11个Prefab或节点名。
2. 修复ProgressTrack的12<16约束；0/50/100%填充不越界，核对Trim=None、CUSTOM、RGBA及九宫格合法目标尺寸。保持源70 PNG，不能清Border或拉伸花纹掩盖布局。补字号层级、对比度、基线和序号对齐，390宽可读，长短数字不跳位。文字用独立原生Label。
3. 在Creator将UIRuntime配置为本地`game-ui` Bundle。路径基于Bundle根，例如`Prefabs/Pages/GameBackground`、`Prefabs/Pages/GameHUD`，不带assets前缀或扩展名；开工时核对真实资产，不能仅抄路径字符串。暂停/帮助/结果也在Pages内，经UIManager注册实际路径。
4. 背景通过ResManager.acquire+scene scope加载/实例化到背景根；HUD/弹层通过启用的UIManager加载。HUD和弹层Prefab根挂UIBase派生薄适配组件，以序列化类型化引用连接现有Presenter/View。绑定缺失可见失败并回滚，不能静默退回两套HUD。
5. 实际使用UIManager的层、modal、缓存和显示scope；明确每页keep/destroy策略。取消旧白膜HUD/Buffer/Meld/Result的重复绘制，保留行为并适配新Prefab；不要另写页面栈/资源管理器。
6. Scene scope持长期资产/订阅；Round scope只持当局任务/表现。正常restart复用现有GameSession本体并切sessionId/快照，不重新创建并行会话或重载整套资源。退出/部分构造失败先停用/销毁节点，再释放资产handle；Prefab依赖不单独重复释放。失败/取消后迟到handle释放，不挂载到新场景。
7. 槽内2D单/双块Prefab服务真实快照；桌面仍32个真实轻3D牌块。双块一根整体点击/移动，在底槽占连续两格。禁止用静态牌堆代替游戏。

### T5 · 全量快照、交互与规则回归

| UI项目 | 权威来源/要求 |
|---|---|
| 桌面剩余/进度 | `snapshot.board`所有Block的cards.length之和，初始48；进度=桌面张数/48，明确“桌面剩余”。不是节点数或守恒总数audit |
| 四副/七槽 | melds及buffer.startSlot/slotCount/cards、occupiedSlots；吃/碰3张、杠4张，无第5副/第8格，逻辑立即压缩 |
| 牌与拒绝 | phase/selectable/disabledReason/highlight驱动单/双块；拒绝不改revision/计数，提示实际原因，不在UI重算配方 |
| 胡牌/大招 | 消费不可变UltimateSnapshot.hand/targets/pairCleanup；结算不等动画；将牌、听牌和收尾文案不遗漏 |
| 终局 | 只按terminal显示；Lost立即面板并阻断取牌；Won按现有视觉等待上限显示，普通胡牌不是直接Won |
| 未开放部分 | 用时`--:--`，星数`—`或“未开放”；工具/补给禁用并明确“未开放”，无假库存/积分/奖励/广告成功 |

必须可用：真实取牌、重开、结果再来一局、启动失败重试；最小暂停菜单（继续/重开）和帮助（现有MVP规则/关闭）。每个按钮一条命令路径，不同时Button Click Events和touch-end双发。弹层遮罩不穿透，同时不禁用全局Touch令关闭失效。

冻结规则逐项回归：48张/32唯一Block/16组；双块不可拆；两种将牌及9/10 Block；四副形成时已有将牌瞬胡；听牌额外副就地抵消不出现5/4；pairCleanup只按真实同组board/buffer伙伴整块清理，不清跨组/副/将/removed，不改变番型威力；组合/瞬胡/大招/稳定扫描后满七立即Lost，即使有可救牌；6+2可组合接受、不可组合拒绝；未满且无步为Stalled；Won按正式board/buffer及待结算条件，可放弃未完成副。数据立即结算，旧session/revision/effect不能污染新局，视觉不锁死下一轮合法输入。

### T6 · 新构建、真实路线和交付

先尽早做一条新UI取牌→底槽的release垂直切片，发现错位优先修T1，不等全部UI完成才构建。最终完成全部门槛后提交报告，不自动进入下一批或发布。

## 6. 三条必须完整重跑的release路线

来源：[推荐配置](../../assets/Game/Config/RecommendedSolution888.ts)、[R02精确回归](../../tests/game/r02-regression.test.mjs)、[R03浏览器历史摘要](../../docs/reports/R03-HARDENING-evidence/browser-summary.md)。下列是输入序列，不是自动写状态的实现方案。每条均从新局开始，交付时记录每步实际BlockID/接受或拒绝/关键计数/终局，并提供负责人可辨识牌块的对应说明。

```text
普通胡/同组收尾，19步，期望Won：
B01 B02 B03 B04 B05 B06 B07 B08 B09 B10
B21 B22 B23 B24 B27 B28 B29 B30 B26

原推荐，22步，期望Won：
B01 B02 B03 B04 B05 B06 B07 B08 B09 B10
B21 B22 B23 B24 B25 B26 B27 B28 B29 B30 B31 B32

稳定满七，14步，期望Lost/full-buffer-stable：
B01 B02 B03 B04 B05 B06 B07 B08 B09 B10
B22 B24 B26 B27
```

必须在本批新release融合画面通过真实触摸命中链完成，允许工具发送触摸输入，不允许dispatch/select API、snapshot注入、修改状态或仅在Domain回放来冒充UI路线。19步的B26胡牌后B25清理、双块将9 Block与两单将10 Block都要保留证据。B25先在buffer、先将后第四副、两张伙伴整块清理及144顺序变体用既有单测/白盒继续证明，不能删去；不可自然到达的白盒单列debug或单元证据。

## 7. 验证命令与新增测试要求

开工和完工实际执行并记录命令、输出、退出状态：

```sh
cd /Users/liang/Projects/Majing
npm run check
npm test
npm run check:game
npm run test:game
node tools/framework-release.mjs audit
```

完整`npm test`包括FW04临时夹具，属于本单批准的验证；只读审查的161子集不能替代它。新测试用既有发现机制，不能改package/加载器/strict或跳过阻断项。原169/159覆盖不弱化；表现断言需更新时列旧断言、新断言及依据，规则和生命周期不变量不删。Framework源码/测试只读，不能改框架测试去适配错误游戏代码。

新增测试至少覆盖：

- T1自洽DPR/安全区/viewport原点、独立物理投影期望、业务映射及输入阈值；禁止测试用同一被测函数生成预期。
- T2真实App/ModuleHost竞态、双顺序场景替换、旧init/退出/回调隔离、错误保留和重试。
- T3多原因/同名租约、GAME/UI计时区别、弹层加载期阻断、失败释放、重开/后台交错。
- 真Prefab嵌套、九宫格目标尺寸、绑定缺失可见失败、重复打开/关闭、资源迟到/失败和退出无持有者泄漏。
- 快照与UI同步、单/双块占位、拒绝不变、胡牌/收尾/终局正确；旧规则、144变体、完整TouchEnd和采样清理失败封闭仍通过。

构建成功同时检查Creator完成记录、日志级别/Missing class/编译和资源错误、真实首屏与控制台；本机历史退出36不是通用成功标准。正式游戏构建场景只选本批入口，不加入独立框架示例/测试场景；通过本次构建参数排除示例Bundle，不修改全局settings，实查产物引用而非只写“已排除”。如现有工具无法按许可参数排除，报告具体原因。

## 8. 合并验收矩阵（L1硬门槛）

各行实际填“通过/失败/未执行”，一行结论加精确证据入口即可；失败/异常补复现和影响。原UI-MVP-01的I01～I16全部保留，不能因先做框架整改而漏掉UI交付。

| 本单ID / 原来源 | 必须达到 | 最少证据 |
|---|---|---|
| J01 / I01 | 全部修改在白名单；保护范围、源70 PNG、旧UUID无未授权变化 | 开工/完工清单、哈希和差异用途；不是Git基线 |
| J02 / I02 | 组件→HUD→整页→预览真嵌套，源修改传播后恢复 | Creator关联/Inspector、重开后审计 |
| J03 / I03 | 切片尺寸合法、进度0/50/100、字号对比/基线/序号可读、素材等比 | 真实属性截图与同尺度区域差异表 |
| J04 / I04 | Main新包直接冷启动/刷新/重进，新美术+真实游戏，无控制台补丁/重复HUD | 新release首屏、操作与console |
| J05 / I05 | 三种尺寸、四边安全区/胶囊、DPR及resize，三相机正确无关键裁切 | 自洽单测、每尺寸实际图、真实设备项另列 |
| J06 / I06 + F-G1 | 共享2D/3D/输入链，正逆≤1设计像素且独立物理投影正确；边缘/重叠/双块/12px/旧触点正确 | 修复前失败、修复后预期对照、真实触摸 |
| J07 / I07 | 真实桌面张数/进度、四副七槽/高亮同步，双块单根两格，禁用项无假数 | 多个中间快照和UI一致性记录 |
| J08 / I08 | 两形式将、瞬胡、board/buffer残块及两张伙伴、逐步32/48守恒 | 既有回归保留及融合结果，B25不留死局 |
| J09 / I09 | 满七即时Lost、6+2/拒绝/Stalled不退化；Won正确、重开可用 | 失败/拒绝/通关与revision |
| J10 / I10 | 本批release三条19/22/14路线真实触摸通过 | 逐步输入、结果、画面和重开 |
| J11 / I11 + F-G3 | 暂停/帮助/继续/菜单重开/终局重开/错误重试，不穿透，多原因不误恢复 | 租约/计时单测及真实交错操作 |
| J12 / I12 | 20次普通重开与20次完整退场重建分别验证；失败/绑定/加载/迟到收尾，无重复会话/订阅 | 稳定时点节点/资源owners/监听/采样趋势，错误恢复 |
| J13 / I13 | 完整TouchEnd每次<100ms；正常重开复用资产，无逐次点击新材质；draw call及帧时间有实测 | 样本数/p95/max/环境，资源趋势，不沿用旧包数字 |
| J14 / I14 | release无参及带r01diag参数均无__R0__/开发改状态入口；debug显式隔离 | 两种release URL检查，debug如有单列 |
| J15 / I15 | 四项完整检查和framework audit通过，新增用例实际发现，原覆盖不弱化 | 原始输出、断言变更原因 |
| J16 / I16 | 最短复测入口、构建、手测表、L1/L2状态、未完成项完整 | 五项报告与交接材料 |
| J17 / F-G2 | 场景实例交接等待退出完成，双顺序/失败/旧destroy不误杀新局；同场景重复可诊断 | 生产App竞态回归、Creator实际重建 |
| J18 / 框架接入 | 第3节每项必用能力都有实际调用/生命周期/测试证据，无平行实现；业务层边界不变 | 接入实证表、依赖/导入审计、唯一驱动记录 |
| J19 / UI资源 | game-ui真实Bundle、UIBase/UIManager真实接线；退出/失败资源逆序回收，默认平台服务不重复 | Bundle/Prefab引用审计、故障与资源owners趋势 |

J12完整重建可使用单列debug场景或自动化测试驱动公开生命周期，不需要给release添加重建写入口；普通重开必须真实UI。稳定后连续无单调增长，解释缓存保留/帧末释放，不用JS计数代替GPU归零证明。

性能预算沿用架构：初始draw call目标≤120，目标机稳态帧p95≤33.3ms。至少在本批release暖机5秒后采样30秒，注明分辨率/DPR、硬件/渲染后端、取样方法和场景；实际TouchEnd记录全样本数/p95/max，不能只报p95掩盖单次≥100ms。桌面只证明桌面，不替代手机；达不到预算须列瓶颈和范围内优化结果，不能自行改全局图集/压缩/质量设置。TouchPerformanceRecorder保留每局256硬上限、reset/dispose与命名清理失败封闭，换新UI后完整链路仍需重新测量。

## 9. 负责人手动测试对照表

Harness交付时补新包入口、牌块定位示意和实际环境，不代签负责人“通过”。项目负责人测完后再决定后续开发。

| 人工操作 | 应看到的结果 |
|---|---|
| 直接启动/刷新/关闭重进 | 新背景/HUD+真实32Block游戏，无临时控制台操作 |
| 长短屏、屏幕旋转再回竖屏、安全区 | 牌、文字、暂停/帮助、四副七槽不裁切、不重影，触摸跟随 |
| 点单块、双块两半、边缘、B05/B11重叠区；滑动松手 | 显示/命中一致，遮挡牌不能取；双块整体；超过12设计像素不误发 |
| 19步普通胡路线 | 第四副/将提示正确，B26胡后B25同组残块清除，Won，无孤牌死局 |
| 22步推荐路线 | 双单将/三碰一杠与后续步骤正确，最终Won |
| 14步失败路线 | 末步稳定7/7立即Lost，即使有可救牌；失败页可重开 |
| 连续取牌及吃/碰/杠、6+2拒绝 | 七槽紧密压缩、双块两格，副牌3/4张正确；拒绝不改计数 |
| 菜单→帮助→关帮助；暂停→后台→恢复 | 只关闭一个原因仍暂停，UI按钮可用；最后原因解除才恢复 |
| 按住牌→重开/后台→松开旧触点 | 新局不误取牌，无旧效果、双命令或旧计时样本 |
| 大招中继续合法点击 | 逻辑已结算，合法输入进入下一轮；视觉不全屏锁死 |
| 从结果/菜单重开，连续20次 | 初始状态、计数和UI一致，无重复HUD或持续资源增长 |
| 查看用时/星数，点击工具/补给 | 明确未开放，无假库存/奖励/广告路径 |

## 10. 平台验证、失败处理与停止边界

微信工具/真机不是可删除的验收项。已完成的通用框架游客微信构建仅是历史本地构建，不等于本批游戏工具内编译或真机通过；上次Mac锁屏受阻也是当时事实，本次要实际确认当前能力，不绕过锁屏。

现有合法Creator/AppID/工具环境具备时，可以生成本单本地微信构建并导入现有开发者工具做本地编译/运行；游客能力有限应注明。不要虚构AppID、改账号/全局配置或安装工具解阻。预览、真机调试等若将代码包发送服务端，说明发送内容、目的和风险并获得单独明确批准后再操作；本单不授权上传体验版、发布或其他外部传输。

具备条件的平台需复验融合画面、字体、安全区/胶囊、输入/胡牌/失败/通关、20次重开、前后台和真实性能，注明机型/系统/微信/工具版本。G06真实物理仍属后续明确批次，不能写为已完成。环境/权限缺失继续无冲突L1工作，L2写未执行/受阻及需负责人提供的条件。

范围内Bug可自行修复复测；规则歧义、公共API缺口、范围外文件或配置变更，报告“复现→证据→影响→最小改法/新增范围→风险/验证”，暂停该分支，不复制平行框架或改规则绕过。不把自动化审查通过当负责人批准。

## 11. 完工材料与独立复核

提交`docs/reports/GAME-UI-01.md`，按根AGENTS五项格式：任务结果（分别L1/L2）、修改内容、验证结果、问题风险、待确认事项。普通通过项简短，失败/异常补细节；完成后停止，等Codex独立复核和负责人验收。

证据目录最少包含：

1. `framework-usage.md`：第3节实际接入表，标明文件/方法/作用域/清理/测试；哪些旧实现保留及理由。
2. `acceptance.md`：J01～J19逐项状态、对应原I01～I16，无空项；同尺度原型区域对照、已知差异和本批人工测试表。
3. `before.sha256` / `after.sha256` / `scope-diff.md`：实际文件新增/修改/删除与允许范围；无Git基线就只称哈希比对，不宣称Git diff。
4. 自动检查/构建完整日志、源/规则版本、Bundle/场景选择和产物路径、最短启动方式、控制台记录。
5. 本批release三条完整触摸路线与截图、投影校准、多原因暂停、20次重开/20次重建及失败/迟到清理证据；单元/mock/debug/release/平台证据分别标记。
6. 性能原始样本/统计/环境、稳定资源/节点/订阅趋势、真实Inspector属性/嵌套传播证据。

Codex将独立读取实现和测试、核对权威需求/Framework公共API，重算投影预期，抽查事务/生命周期及证据来源；不会只复述Harness报告。测试数、截图数量或“全部通过”一句话不能代替正确性证明。

## 12. 可直接复制给 DeepSeek Harness 的开工消息

> 工作区`/Users/liang/Projects/Majing`。执行已批准的`GAME-UI-01`，先完整读取`需求设计/03_开发规范与验收/DeepSeek_GAME-UI-01_通用框架接入与UI融合执行任务单.md`及必读资料，遵守根/Game AGENTS。本单合并此前UI-MVP-01，不能只交静态展示，也不能只修框架接入后跳过UI。通用框架已完成FW-01～04，先读最新源码/接入规范；按T0～T6修复物理像素投影、跨实例App关闭屏障和多原因暂停，再通过现有App/UIManager/UIBase/ResManager/ViewportService/RuntimeLifecycle融合新Prefab与真实MVP。交付每项通用能力的实际调用、作用域、退出和测试证据，不以import代替接入。仅改本单白名单，不改Framework/Domain/Application/正式关卡/契约/采样算法/全局设置，不安装/Git/上传发布。保留V2.3/888-v3及原I01～I16，按J01～J19交付新release真实触摸19/22/14路线、20次重开和20次完整重建、全部回归、原型/Inspector对照、资源/暂停/竞态证据及人工测试表。真实物理、微信工具和真机仍是完整MVP门槛，未做写未做，外部传包另行批准。提交`docs/reports/GAME-UI-01.md`及证据后停止，等待Codex独立复核与负责人验收；超范围暂停相关分支并报告最小需求。
