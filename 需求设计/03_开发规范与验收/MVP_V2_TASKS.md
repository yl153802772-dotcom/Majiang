# MVP V2 分批实施与手动交接

日期：2026-10-25。契约基线 V2.3（R0.2 将牌同组残块清理与诊断隔离）。每个任务只覆盖一批，不能把路线图当全目录修改授权。
当前（2026-10-26）：G01/G02 规则、G03 会话及 G04/G05 内部 Web 白膜已实现，已完成 R0.1/R0.2/R02-CLOSE 交付及独立复核；不再处于“尚未开始游戏实现”。G06 真实轻 3D 物理尚未实现，G07/G08 完整平台验收仍待后续批次。
负责人已确认此前白膜人工测试通过。R03-HARDENING已完成采样异常、构造回滚、启动/重试/退出加固，72/159与真实Web回归见原报告。本轮DOC-01仅归类文档、更新进度与日志，不授权G06或新增玩法。G01历史交接单保留，不作为当前开工状态。
通用框架按负责人本轮决定保持通过进度；本表不抹去历史微信工具/真机未验证记录。

## 1. 执行顺序

| 批次 | 目标/依赖 | 完成门槛 | 独立审查 |
|---|---|---|---|
| G00 | 架构、契约、规则、目录、验收表 | 文档一致、可独立交接，无假玩法实现 | 本轮自检；负责人核验 |
| G01 | 固定关/类型/配置校验 + Game 检查工具 | 48/32/16、全部布局、非法配置用例、测试确被发现 | 普通配置可抽查；工具边界核对 |
| G02 | 纯规则与裁决；依赖 G01 | 吃碰杠将/七槽/目标/终局的正反例 | Codex 必审 |
| G03 | 会话/原子事务/事件/回放；依赖 G02 | 完整推荐回放 Won，拒绝/监听异常/旧局/重开一致 | Codex 必审 |
| G04 | 2D/3D 引擎垂直切片；依赖 G03 | 唯一启动、32 白膜块、2D 字/桌面/触摸、投影和相机探针 | Codex 必审 |
| G05 | 可玩 2D UI 与非阻塞事件接入；依赖 G04 | 七槽/计番/听牌/番型/结果/重开完整可玩，TC 交互验证 | 关键交互抽查 |
| R0.1 | 将牌双形式、稳定满七失败、输入/计时/资源/后台修复；依赖 R0 | R01-01～R01-11 回归、真实引擎证据、原型整图对照 | Codex 必审 |
| R0.2 | 双块将同组残块清理、pairCleanup 契约、诊断构建隔离、版本 V2.3 | R02-01～R02-12、release/diag 双包、完整路线/失败/回放证据 | Codex 必审 |
| R02-CLOSE | 性能采样有界化、144 顺序回归、两张伙伴移除、文档口径 | R02-CLOSE 验收、release 采样与逐步守恒证据 | Codex 只读复核 |
| R03-HARDENING | 已完成；采样失败封闭、构造回滚、启动/重试/退出加固 | 异常注入、全量回归、新Web包通过；见docs/reports/R03-HARDENING.md | Codex已实施并验证；不代签最终MVP |
| G06 | 真实轻 3D 物理替身；依赖 G05 | 正常档可见刚体反弹、≤12、双块整体、超时/降级 | Codex 必审 |
| G07 | 生命周期与诊断加固；依赖 G06 | 20 次重开、前后台、异常、旧事件、性能/资源基线 | Codex 必审 |
| G08 | Demo 平台完整验收；依赖 G07 | TC 全量 + V2 表现，Web/微信工具/真机证据齐 | Codex 独立验证后负责人验收 |

G04 优先验证渲染方案；遇不可行问题先报告再调整，不等全部 UI 写完才发现混合相机不能工作。
G08 默认只验证，不授权修复全项目；发现缺陷回到对应批次开修复任务。任何阶段审查通过不代替负责人同意进入下一批。

## 2. 各批允许修改的候选范围

以下为设计范围及历史批次边界备查：已完成的批次不得重复当作新授权，后续批次须由负责人明确批准本次范围。状态以[项目进度](../项目进度.md)为准。新资产对应.meta与实现文件同批，既有UUID保持；每批可写docs/reports/Gxx.md，普通结果不需长篇文档。

### R03-HARDENING · 已完成优化（历史范围，非新授权）

- 允许：Framework/Kernel/LifecycleScope.ts；Game 的 GameBootstrap、GameRoot、TouchPerformanceRecorder、Table3D/BoardView；对应 tests；当前架构/交接/验收状态文档及本批报告/证据；本项目必要构建缓存和 `build/mvp-v2-r03-hardening-web/`、`-diag/`。
- 不改：Domain/Application/关卡/推荐序列/规则、AGENTS、场景/既有 metadata、package/tsconfig/引擎设置、历史报告/证据/构建；不安装、不操作 Git、不上传、不发布、不访问其他项目。
- 通用框架修改是负责人本轮的明确例外授权；不得据此允许 Harness 后续任务任意修改 Framework。

### G01 · 数据与检查基线

- 允许：`assets/Game/Domain/{CardTypes,BlockTypes,LevelDefinition,LevelValidator}.ts`、`assets/Game/Config/{Level888,RecommendedSolution888,PresentationConfig}.ts`、`tests/game/level.test.mjs`、`tools/check-game.mjs`；`package.json` 仅增加 `check:game` 和 `test:game` scripts。
- Game 检查器复用 `tools/typescript.mjs`，实现层间导入/无引擎 Domain/Application/无随机规则检查及 Game 的非数组 iterable-spread 检查；不得改既有框架检查来删规则。现有全工程严格检查继续保留。
- `test:game` 执行 `node --import ./tests/register.mjs --test tests/game/*.test.mjs`。测试数必须非零，错误配置覆盖重复/缺失 ID、坏配方、超牌面上限、环和坐标越界。
- 此批不假称已跑通推荐回放；只转录推荐命令，G03 才可验证其可解性。
- 采用 V2.1 的明确类型，保留独立框架加固及文档契约测试；游戏检查器必须用非法 import/随机/iterator 展开的负例证明会失败，不能只打印通过。

### G02 · 纯规则

- 允许：`assets/Game/Domain/` 本批所需真实 TS、`tests/game/rules.test.mjs` 及边界 fixture。
- 禁止：修改固定关来迎合算法、创建 GameSession/UI/引擎物理。
- 交付：显式唯一比较器、真实/虚拟同一模拟算法、Group 完整性/遮挡/番型/目标、严格终局和状态不变量；TC-01～TC-11、R-01～R-03 的可单测部分。

### G03 · 事务与回放

- 允许：`assets/Game/Application/`、`tests/game/session.test.mjs`、`tests/game/replay.test.mjs`、`tests/game/fixtures/`。
- 若确需变更 G02 公共接口，先报告；不默许连带改 Domain。
- 交付：完整真实选牌链路、拒绝不变、原子回滚、监听隔离/重入、冻结快照、重复/旧局/重开、完整推荐回放和每步断言；不是只有最终 Won 断言。

### G04 · 真实引擎垂直切片

- 允许：`assets/Game/Bootstrap/`、`assets/Game/Presentation/GameRoot.ts`、`Presentation/UI/BoardInput.ts`、`Presentation/Table3D/{TableProjector,BoardView,BlockView}.ts`、`Config/PresentationConfig.ts`、`assets/scenes/Main.scene`（保留场景 UUID），本批 adapter 测试。
- 新 GameBootstrap 替换场景组件，不改 Framework 源码；背景/牌/overlay 的用户 Layer mask 集中在游戏配置中选未使用用户位，不必写全局配置。
- 允许构建派生：本项目 `library/`、`temp/`、`profiles/`、`build/mvp-v2-web/`；只作引擎导入/构建输出，不手工修派生代码。
- 交付：Cocos Web 实际运行、三层相机色块探针、全部 32 块/文字、遮挡高亮、设计/世界/屏幕往返、真实点选；临时诊断文本可展示快照但不是最终 UI。
- 此批即完成 GameRoot.pause/resume 与 Bootstrap 前后台转发接口，G05/G06 后续各自接入暂停收尾，不必越界修改入口。
- 生成 TS `.meta` 后验证实际脚本注册 ID；检查场景无 Missing class。此批暂不启用刚体，也不宣称轻 3D 全验收完成。

### G05 · 完整可玩白膜 UI

- 允许：`assets/Game/Presentation/UI/`、`Presentation/EffectPresenter.ts`、`Presentation/GameRoot.ts`、`Config/PresentationConfig.ts`、对应表现适配测试。
- 交付：七格、双块连续占位、计番四副、听牌/将牌高亮、番型/威力提示、空间不足、胜负、重开；普通飞牌可以无物理轨迹先接通；大招与新输入同时工作。动画不改规则。
- 游戏逻辑修改不在本批默认范围；发现会话 Bug 回交 G03 修复任务。
- 沿用 G04 本地 Web 构建派生范围，用实际引擎验证 UI；EffectPresenter 预留 pause/resume 并实现无物理视觉的暂停/取消。

### R02-CLOSE · 性能记录、回归测试与文档收尾

- 允许：`Presentation/{GameRoot,TouchPerformanceRecorder}.ts` 及相关 `.meta`；`tests/game/r02-regression.test.mjs`、`r02-metrics.test.mjs`、fixtures；六份正式文档的必要口径；`docs/reports/R02-CLOSE.md`/证据；`build/mvp-v2-r02-close-web`（必要时 `-diag`）。
- 禁止：Domain/Application/Level888/推荐序列/规则、BoardInput/BoardView、Framework/AGENTS/场景/UUID、package/tsconfig/引擎设置、旧报告/旧构建、Git/发布/物理/美术/其他项目。
- 交付：release 每局 256 条有界 User Timing，换局 reset、退场 clear；144 变体逐步守恒；两张同组伙伴整块移除；release 19/22/14 步实测、重开后不累积、无诊断入口；完成后停止交 Codex。

### R0.2 · 普通胡牌残局修复与验收补齐

- 允许：`Domain/{GameState,HandResolver,LevelValidator}.ts`（LevelValidator 仅文案）；`Application/{GameSession,GameReplay}.ts`；`Presentation/{GameRoot,EffectPresenter}`、`Bootstrap/GameBootstrap.ts`；`Config/Level888.ts` 仅 contentVersion；指定 tests 与 `tests/design-contracts.test.mjs`；六份正式文档；`docs/reports/R02.md`/证据；`build/mvp-v2-r02-web` 与 `-diag`。
- 禁止：Framework、AGENTS、既有 UUID、场景、牌池/Group/坐标/遮挡、推荐序列、CombinationResolver/TerminalRules、BoardInput/BoardView、package/tsconfig/引擎设置、依赖、Git/上传/发布、物理/美术、其他项目。
- 交付：pairCleanup 同事务冻结/清理/守恒、回放摘要、构建期诊断隔离、release/diag 实测、R02 证据与报告；完成后停止交 Codex。

### R0.1 · 规则调整与定向修复

- 允许：`需求设计/01_需求定稿/MVP_FINAL.md`、`需求设计/02_架构与接口/MVP_GAME_ARCHITECTURE_V2.md`、`需求设计/02_架构与接口/MVP_V2_CONTRACTS.md`、`需求设计/03_开发规范与验收/MVP_V2_ACCEPTANCE.md`、`需求设计/03_开发规范与验收/MVP_V2_TASKS.md`、`需求设计/03_开发规范与验收/DEEPSEEK_HARNESS_RULES.md`（仅同步本批规则/版本）；`Domain/{GameState,CombinationResolver,HandResolver,UltimateResolver,TerminalRules}.ts`；`Application/` 五个文件；`Presentation/` 输入/游戏根/效果/UI/牌桌资源清理；`Bootstrap/GameBootstrap.ts`；`Config/PresentationConfig.ts`；`Config/Level888.ts` 只改 contentVersion；`tests/game/`；`docs/reports/R01.md` 与证据；必要时 `Diagnostics/R01CaseRunner.ts`。
- 禁止：Framework、AGENTS、牌池/坐标/遮挡、推荐序列、既有 UUID、package/tsconfig/引擎设置、其他项目、物理/发布。
- 交付：R01-01～R01-11 测试/真实引擎证据；新 Web 构建 `build/mvp-v2-r01-web/`；正式 release 配置关闭全局诊断与逐次 console；完成后停止交 Codex 复核。

### G06 · 轻 3D 物理

- 允许：`assets/Game/Presentation/Table3D/{TileVisualPool,TilePhysicsAdapter}.ts`、`Presentation/EffectPresenter.ts`、`Config/PresentationConfig.ts`、对应物理适配测试；`settings/v2/packages/engine.json` 仅启用 Cocos 自带所需 3D 物理后端/模块。
- 物理步长/分组/碰撞矩阵优先在游戏装配内设置，退出恢复原值；引擎若必须写其他设置文件，先列实际路径/键请求新增范围，不猜造配置键。
- 构建派生：本项目 `library/`、`temp/`、`profiles/`、`build/mvp-v2-web/`、`build/mvp-v2-wechat/`，无上传。
- 交付：一个双块一个刚体，最多 12 动态替身，仅碰地板；短时反弹/翻转、超时/并发降级；参数改变不影响规则摘要；Web 和微信工具实测，真机在 G08 完整复验。
- 如工具不可用，报告“部分完成/平台待验”，不得跳过后改成通过。

### G07 · 生命周期与测量

- 允许：`assets/Game/Diagnostics/`、`Bootstrap/GameBootstrap.ts`、`Presentation/GameRoot.ts`、`Presentation/EffectPresenter.ts`、`Presentation/Table3D/{TileVisualPool,TilePhysicsAdapter}.ts`、对应生命周期测试。
- 交付：TouchEnd 区间完整采样，样本有界、设备信息/内容版本；20 次重开同基线、前后台无追赶爆发、订阅/刚体/池清零；诊断入口不暴露于正式包。
- 如需改 BoardInput 埋点，任务单另列 `Presentation/UI/BoardInput.ts`，不得以“诊断”名义默认修改全部 UI。
- 沿用 G06 本地 Web/微信构建派生范围；手机预览涉及传包的授权边界同 G08。

### G08 · 平台验收与交付

- 允许：读取实现与需求、运行已批准检查/本地构建、写 `docs/reports/G08.md` 和本次截图/日志；派生目录同 G06。
- 构建命令/安装路径以当前机器实际环境核实，不安装；检查日志且实际打开产物，不只报告退出码。
- 微信工具与手机需要项目负责人提供合法 AppID/初始化登录和设备。仅做本地编译/预览测试，不上传/发布；若工具的预览会发送包至服务端，单独说明并取得明确批准后执行。
- 发现问题先报告并另立修复任务；最终报告按 P1～P5 状态分别列，不篡改历史框架报告。

所有批次都禁止：Framework 源码/公共 API、根 AGENTS、未列出的项目设置、历史需求、无关项目、全局配置、依赖安装、Git 提交/推送、发布；确需例外由负责人明确增加授权。

## 3. 可独立复制给 DeepSeek 的最简任务单

下面四栏填写完整后即可复制。不要只发“继续 G02”；不要把默认待批准模板当授权。

~~~text
任务目标：
项目 /Users/liang/Projects/Majing；任务 ID G__，目标 ______。
需求/架构基线：MVP_FINAL（V2.3）、游戏架构/契约 V2.3；关卡 888-v3。
审批状态：待批准 / 已批准执行（只能留一项）。
批准者/日期/依据：______；未取得负责人明确批准时只读，不修改。
先遵守根 AGENTS.md、assets/Game/AGENTS.md；读取 需求设计/01_需求定稿/MVP_FINAL.md、
需求设计/02_架构与接口/MVP_GAME_ARCHITECTURE_V2.md、需求设计/02_架构与接口/MVP_V2_CONTRACTS.md、
需求设计/03_开发规范与验收/MVP_V2_ACCEPTANCE.md、需求设计/03_开发规范与验收/DEEPSEEK_HARNESS_RULES.md，
及 需求设计/03_开发规范与验收/MVP_V2_TASKS.md 对应批次。以工作区当前实际文件为准，不依赖其他聊天。
本批前置结果：______（上批报告路径/原文；没有写无）。

允许与禁止范围：
允许创建/修改的精确路径：______；允许生成的 .meta/构建派生路径：______。
原因与风险：______（如仅数据转录/场景入口替换/项目物理配置变更）。
其他路径不在范围；不得擅自变更玩法、扩范围或把助手意见当已批准需求。
验证权限：允许执行 ______；不允许执行 ______。

验收条件：
本批必须断言/观察 ______；对应 TC/R/V/P 编号 ______。
实际要运行的命令/环境 ______；缺工具或失败时报告，不安装/绕过。
当前未获授权的后续批次不要开始。

执行结果：
开工前留空；完工后按根 AGENTS 五项简报：任务结果、实际修改路径、
实际验证/未执行项、问题风险、待确认/下一建议。失败、异常、高风险才补复现细节。
~~~

## 4. 给 Codex 的独立审查补充

复制同一任务单与 DeepSeek 实际结果，标明“只读审查，不修复”，并提供可读工作区或具体文件内容/差异；不假设自动共享上下文。
Codex 先自行定位实现、构造规则反例/边界和验收断言，再检查测试是否真被执行、是否用了 mock、是否删改了预期；报告具体文件/位置、影响、复现、遗漏与验证边界。
关键审查发现按阻断/高/中/低列；无发现也说明审查范围与未验证平台。不复述 DeepSeek 的“已通过”作为自己的证据。
批准修复和最终交付验收仍由负责人决定。
