# MVP V2 接口与数据约定

日期：2026-10-25。历史契约版本 V2.1；当前契约版本 V2.3（R0.2 将牌同组残块清理与诊断隔离）。配合 `需求设计/02_架构与接口/MVP_GAME_ARCHITECTURE_V2.md`，是编码契约而非已存在 API。
状态更新（2026-10-26）：核心数据、规则、会话与表现已有实现，本文是当前公共契约基线；具体API须和实际源码及测试核对，不把设计签名当成逐字实现清单。可增加私有辅助函数，不可擅自改变业务语义/依赖方向；后续物理等能力不能据此自动视为已实现。阶段状态见[项目进度](../项目进度.md)。

## 1. 文件归属

| 拟建文件 | 职责/公共面 |
|---|---|
| `Domain/CardTypes.ts` | Suit、Rank、Card、牌面相等比较 |
| `Domain/BlockTypes.ts` | BlockID、GroupID、BlockDefinition、位置类型 |
| `Domain/LevelDefinition.ts` | LevelDefinition、Placement、GroupDefinition、LevelIssue |
| `Domain/GameState.ts` | GamePhase、MeldRecord、WinningHand、规则输入/中间态、私有事务草稿及不变量 |
| `Domain/CombinationResolver.ts` | 纯函数 enumerateCandidates、chooseCandidate |
| `Domain/HandResolver.ts` | 四副、听牌、瞬胡、听牌就地抵消 |
| `Domain/UltimateResolver.ts` | 番型及不可变目标快照 |
| `Domain/BoardRules.ts` | canSelect、可点集合、组完整/遮挡推导 |
| `Domain/TerminalRules.ts` | canVirtualInsert、Won/Lost/Stalled 派生 |
| `Domain/LevelValidator.ts` | validateLevel；列出全部错误，不带引擎副作用 |
| `Config/Level888.ts` | 唯一固定关数据 `LEVEL_888` |
| `Config/RecommendedSolution888.ts` | 推荐命令 BlockID 顺序；无特殊通关逻辑 |
| `Config/PresentationConfig.ts` | 相机映射、尺寸、颜色、动画/物理预算；无 cc 类型 |
| `Application/GameCommand.ts` | 输入/拒绝原因 |
| `Application/GameEvent.ts` | 已提交事实与视觉信息，不发起规则变化 |
| `Application/GameSnapshot.ts` | 对外深只读 DTO |
| `Application/GameSession.ts` | 唯一状态所有者及同步事务入口 |
| `Application/GameReplay.ts` | 回放和规范化状态摘要；不含墙钟/引擎对象 |
| `Presentation/GameRoot.ts` | 绑定快照/事件、输入和 View，不初始化第二个 App |
| `Presentation/UI/BoardInput.ts` | 单触点 TouchEnd、命中、命令提交与测时 |
| `Presentation/UI/{Hud,Buffer,Meld,Result}View.ts` | 纯 2D 渲染，不实现配方 |
| `Presentation/Table3D/TableProjector.ts` | 统一坐标转换、设计命中框与投影 |
| `Presentation/Table3D/{Board,Block}View.ts` | 固定 Mesh 与投影文字/高亮绑定 |
| `Presentation/Table3D/TileVisualPool.ts` | 程序生成节点的有界复用；不得另造资源管理器 |
| `Presentation/Table3D/TilePhysicsAdapter.ts` | 刚体替身、固定步/预算、暂停及清理 |
| `Presentation/EffectPresenter.ts` | 事件去重、非阻塞编排及超时 |
| `Bootstrap/GameBootstrap.ts` | 唯一 App 帧驱动与 composition root |
| `Diagnostics/{MvpCaseRunner,MvpPerformanceProbe}.ts` | 开发白盒与有界测量，正式 UI 不依赖 |

文件名 `{A,B}` 表示两个文件，不是真的花括号文件名。避免为了照表空建全部文件；随任务分批创建真实实现。

## 2. 关卡静态契约

~~~ts
type Suit = 'wan' | 'tong' | 'tiao';
type Rank = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
type BlockID = string; // 校验 /^B\d{2}$/，Level888 还校验精确 B01～B32
type GroupID = string; // 同理 G01～G16
interface Card { readonly suit: Suit; readonly rank: Rank; }
type BlockDefinition =
  | { readonly id: BlockID; readonly groupId: GroupID;
      readonly kind: 'single'; readonly cards: readonly [Card] }
  | { readonly id: BlockID; readonly groupId: GroupID;
      readonly kind: 'identicalPair' | 'sequencePair'; readonly cards: readonly [Card, Card] };
interface Placement {
  readonly blockId: BlockID;
  readonly x: number; readonly y: number; // 左上原点，块中心，设计像素
  readonly layer: 1 | 2 | 3;
  readonly blockedBy: readonly GroupID[];
}
interface GroupDefinition {
  readonly id: GroupID;
  readonly blockIds: readonly [BlockID, BlockID];
}
interface LevelDefinition {
  readonly id: '888'; readonly contentVersion: string;
  readonly blocks: readonly BlockDefinition[];
  readonly groups: readonly GroupDefinition[];
  readonly placements: readonly Placement[];
}
~~~

静态配置无完整组“吃/碰/杠/将”强制锁定字段；组表的类型用于内容校验，不限制跨组组合。
若校验用参考组类型，不能让 CombinationResolver 以它替代真实牌面计算。
contentVersion 当前为 `888-v3`（R0.2 将牌同组残块清理规则升版）；表现调参不改它；牌池/布局/规则再改动须负责人批准并升版。
LevelValidator 除静态检查外，完整推荐回放由 Application 测试调用，避免 Domain 导入 Application 形成环。

## 3. 会话最小接口

~~~ts
type GamePhase = 'Collecting' | 'Tenpai' | 'Won' | 'Lost';
type GameCommand =
  | { readonly kind: 'select'; readonly sessionId: string; readonly blockId: BlockID }
  | { readonly kind: 'restart'; readonly sessionId: string };
type RejectReason = SelectionRejection | 'stale-session' | 'busy';
interface SessionOptions {
  readonly level: LevelDefinition;
  readonly nextSessionId: () => string; // 装配层单调分配，不来自 Date/随机
  readonly onSubscriberError?: (error: unknown) => void;
}
interface GameSession {
  getSnapshot(): GameSnapshot;
  dispatch(command: GameCommand): CommandResult; // 同步；不 await 动画
  subscribe(listener: (result: AcceptedCommand) => void): () => void;
  dispose(): void;
}
type CommandResult = AcceptedCommand | {
  readonly accepted: false; readonly reason: RejectReason;
  readonly sessionId: string; readonly revision: number;
};
interface AcceptedCommand {
  readonly accepted: true;
  readonly snapshot: GameSnapshot;
  readonly events: readonly GameEvent[];
}
~~~

`new GameSession(options)` 初始化 revision=0 并通过 getSnapshot 取得初始局面；订阅不隐式发一遍初始成功命令。
接受 select：同一 session、revision+1。拒绝不通知成功监听、不递增、不改变状态；UI 根据 reason 提示。规则内部异常作为异常上报，不伪装成 accepted=false 的正常玩家拒绝。
restart 校验旧 sessionId（终局也可执行），从 nextSessionId 获取新 ID，revision=0，返回新局快照及 `session-restarted` 事件；不可复用旧 ID。
GameSession 本体和 subscribe 订阅由场景 Scope 持有，restart 不 dispose/recreate 控制器、不清空长期订阅。Round Scope 只持有局内任务和表现；只有场景退出才 dispose 控制器。
重开结果的 envelope 使用新局 ID；GameRoot 收到快照局号改变时，先结束旧局表现 Scope、建立新 Scope，再渲染/消费事件，不能把合法重开误当旧事件丢弃。
dispose 后禁止 dispatch/subscribe 并抛清晰生命周期错误；不能静默复活局面。
subscribe 中同步重入 dispatch 返回 busy；监听器异常隔离并送诊断，其他监听仍通知，已提交结果仍 accepted。
onSubscriberError 是注入的纯诊断接口，其异常也不能破坏提交；不把 Logger/cc 导入 Application。
公共 DTO 不直接暴露可变 Map/Set。调用方可以读、拷贝、序列化，但不取得内部状态引用。

GameSession 的构造签名为 `constructor(options: SessionOptions)`；上面的 interface 约束实例公共面，不表示可以实例化 TS interface。

R0.1 将牌规则：将牌只在 Tenpai 成立；一个同牌双块可独立成将（占 1 个 BlockID），两个相同单块可成将（占 2 个 BlockID）；顺子双块不作将，已参与副牌的 Block 不可复用。四副完成时若底槽已有合法将牌立即胡；未满四副不生成将牌候选。稳定满七且无候选立即 Lost，不再检查桌面救牌。

R0.2 双块将同组清理：`UltimateSnapshot.pairCleanup` 记录同组残块；来源 GroupID 必须来自真实 Block，残块在 board/buffer 时整块清理，已在 meld/pair/removed 时为空；两单块将为空。残块不计入手牌/目标/番型/威力，不按牌面跨组清理，不增加目标数量；清理后在同一事务完成底槽压缩、组状态、遮挡和终局判断。

## 4. 快照与事件

GameSnapshot 至少包含：

- sessionId/revision/levelId/contentVersion/phase。
- board：按固定 BlockID 排序的只读块条目，含 blockId、placement、cards、selectable、拒绝/遮挡原因、`none`/`normal`/`tenpai-match`/`winning-pair` 高亮。目标 removed 不再进入 board。
- buffer：紧凑 BlockID 列表，派生每块 startSlot、slotCount、只读 cards；occupiedSlots=总牌数 ≤7。
- melds：最多四副，含 meldId、kind、两 BlockID 和全部 cards（杠 4 张），按形成顺序。
- groups：intact/broken/removed 供诊断；UI 不能改。
- terminal：null 或 Won/Lost 原因；stalled 仅诊断标志，非第五个玩法状态。
- audit：已消费牌/块的只读摘要或测试可用的守恒视图，不泄露可变存储。

事件统一 envelope：`{ sessionId, revision, eventId, kind, payload }`。一条命令的 eventId 按事务内序号稳定生成；相同命令回放可复现。

| kind | payload 的必要数据 | 禁止用途 |
|---|---|---|
| `block-selected` | blockId、原 board 设计位置、最终去向、是否虚拟入槽 | 不再自行向 buffer 追加 |
| `combination-resolved` | 类型、两 BlockID、完整 cards、是否进入计番区 | 不从动画回调增加副牌 |
| `phase-changed` | from/to | 不靠动画切状态 |
| `ultimate-resolved` | effectId、番型、完整四副一将冻结副本、目标组及每组两块、配置设计位置 | 不从当前 UI 反算番型/目标 |
| `board-unlocked` | newlySelectable BlockID | 不修改 blockedBy 图 |
| `session-ended` | Won/Lost、原因 | 不延迟数据胜负 |
| `session-restarted` | oldSessionId/newSessionId | 不接收旧局完成回调 |

表现先按 result.snapshot 更新真实可交互表示，再按 events 创建临时替身。
event 的原位/目标位是设计坐标/逻辑区域信息，不得含 world Vec3/Node。若最终已消除，不生成临时第八格，飞牌直达结算视觉区。
ultimate-resolved 在生成目标快照后、同事务清除目标完成后对外发布，snapshot 是该事务的最终稳定状态。不能将渲染时的 board 当作旧目标数据源。
Session 内部消费完成的逻辑大招队列在公开稳定快照中为空；视觉 pending 数另由表现诊断统计，不参与 Won。

### 4.1 固定的公开类型

以下与前面的 TS 片段组成一份可严格类型检查的契约。是文档类型，不是游戏实现。
GamePhase、BlockLocation、MeldRecord、WinningHand、UltimateSnapshot 和规则输入类型归 Domain；
GameSnapshot、GameEvent 与命令/会话接口归 Application，禁止 Domain 反向 import Application。

~~~ts
type BlockLocation = 'board' | 'buffer' | 'meld' | 'pair' | 'removed';
type SelectionRejection = 'terminal' | 'unknown-block' | 'not-on-board' |
  'blocked' | 'locked' | 'insufficient-space';
type GroupIntegrity = 'intact' | 'broken' | 'removed';
type MeldKind = 'chi' | 'peng' | 'kong';
type Fan = 'qingyise' | 'pengpenghu' | 'pinghu';
type FanResult =
  | { readonly fan: 'qingyise'; readonly power: 5 }
  | { readonly fan: 'pengpenghu'; readonly power: 2 }
  | { readonly fan: 'pinghu'; readonly power: 1 };
interface MeldRecord {
  readonly meldId: string;
  readonly kind: MeldKind;
  readonly blockIds: readonly [BlockID, BlockID];
  readonly cards: readonly Card[]; // chi/peng=3；kong=4，运行时校验
}
type PairRecord =
  | { readonly pairKind: 'twoSingles'; readonly blockIds: readonly [BlockID, BlockID];
      readonly cards: readonly [Card, Card]; } // 两个相同单块
  | { readonly pairKind: 'doubleBlock'; readonly blockIds: readonly [BlockID];
      readonly cards: readonly [Card, Card]; }; // 一个同牌双块独立成将
interface WinningHand {
  readonly melds: readonly [MeldRecord, MeldRecord, MeldRecord, MeldRecord];
  readonly pair: PairRecord;
}
// 候选也必须区分单块将/双单块将；不能把 blockIds/indices/orders 改成无约束数组。
type MatchCandidate =
  | { readonly kind: MeldKind; readonly blockIds: readonly [BlockID, BlockID];
      readonly bufferIndices: readonly [number, number]; readonly enterOrders: readonly [number, number];
      readonly cards: readonly Card[]; }
  | { readonly kind: 'pair'; readonly pairKind: 'twoSingles';
      readonly blockIds: readonly [BlockID, BlockID]; readonly bufferIndices: readonly [number, number];
      readonly enterOrders: readonly [number, number]; readonly cards: readonly [Card, Card]; }
  | { readonly kind: 'pair'; readonly pairKind: 'doubleBlock';
      readonly blockIds: readonly [BlockID]; readonly bufferIndices: readonly [number];
      readonly enterOrders: readonly [number]; readonly cards: readonly [Card, Card]; };
interface TargetBlock {
  readonly definition: BlockDefinition;
  readonly placement: Placement;
}
interface UltimateTarget {
  readonly groupId: GroupID;
  readonly layer: Placement['layer'];
  readonly blocks: readonly [TargetBlock, TargetBlock];
}
interface PairCleanupRecord {
  readonly sourceGroupId: GroupID;
  readonly blockId: BlockID;
  readonly previousLocation: 'board' | 'buffer';
  readonly cards: readonly Card[];
}
type UltimateSnapshot = FanResult & {
  readonly effectId: string;
  readonly sessionId: string;
  readonly revision: number;
  readonly hand: WinningHand;
  readonly targets: readonly UltimateTarget[];
  readonly pairCleanup: readonly PairCleanupRecord[];
};
type TerminalState =
  | { readonly outcome: 'Won'; readonly reason: 'board-and-buffer-cleared' }
  | { readonly outcome: 'Lost'; readonly reason: 'full-buffer-stable' }
  | null;
interface BoardBlockSnapshot {
  readonly definition: BlockDefinition;
  readonly placement: Placement;
  readonly selectable: boolean;
  readonly disabledReason: 'blocked' | 'locked' | 'terminal' | null;
  readonly highlight: 'none' | 'normal' | 'tenpai-match' | 'winning-pair';
}
interface BufferBlockSnapshot {
  readonly blockId: BlockID;
  readonly cards: readonly Card[];
  readonly startSlot: number; // 从 0 起，紧凑且与前块连续
  readonly slotCount: 1 | 2;
}
interface GroupSnapshot {
  readonly groupId: GroupID;
  readonly integrity: GroupIntegrity;
  readonly everBroken: boolean; // 即使后来 removed，也不抹去曾被点击的事实
  readonly remainingBoardBlockIds: readonly BlockID[];
}
interface BlockAudit {
  readonly blockId: BlockID;
  readonly location: BlockLocation;
  readonly enterOrder: number | null;
}
interface GameSnapshot {
  readonly sessionId: string;
  readonly revision: number;
  readonly levelId: LevelDefinition['id'];
  readonly contentVersion: string;
  readonly phase: GamePhase;
  readonly board: readonly BoardBlockSnapshot[];
  readonly buffer: readonly BufferBlockSnapshot[];
  readonly occupiedSlots: number;
  readonly melds: readonly MeldRecord[];
  readonly groups: readonly GroupSnapshot[];
  readonly terminal: TerminalState;
  readonly stalled: boolean;
  readonly audit: {
    readonly totalTileCount: number;
    readonly blocks: readonly BlockAudit[]; // 包含全部 32 块，ID 唯一
  };
}
interface GameEventPayloads {
  readonly 'block-selected': {
    readonly blockId: BlockID;
    readonly from: Placement;
    readonly finalRegion: 'buffer' | 'meld' | 'removed';
    readonly virtualInsert: boolean;
  };
  readonly 'combination-resolved': {
    readonly meld: MeldRecord;
    readonly counted: boolean;
  };
  readonly 'phase-changed': { readonly from: GamePhase; readonly to: GamePhase };
  readonly 'ultimate-resolved': UltimateSnapshot;
  readonly 'board-unlocked': { readonly newlySelectable: readonly BlockID[] };
  readonly 'session-ended': NonNullable<TerminalState>;
  readonly 'session-restarted': { readonly oldSessionId: string; readonly newSessionId: string };
}
type GameEvent = {
  [K in keyof GameEventPayloads]: {
    readonly sessionId: string;
    readonly revision: number;
    readonly eventId: string;
    readonly kind: K;
    readonly payload: GameEventPayloads[K];
  }
}[keyof GameEventPayloads];
~~~

将牌信息随 ultimate-resolved.hand.pair 发布，不再假装将牌是第五副。
startSlot/牌数/番型威力/phase 与 terminal 的对应关系由运行时不变量及测试验证，不能只靠 TS 类型断言。
事件序号按事务事实发生顺序生成，统一在最终提交后发布；中间过程不对外发布半成品快照。
GameSnapshot.board 按 definition.id 排序，groups/audit 按 ID 排序；buffer/melds 按玩法顺序，不能为了排序破坏入槽/形成顺序。

### 4.2 纯规则函数输入/输出

以下输入和返回值均归 Domain；不含局号、引擎对象或 Application 类型。内部辅助函数自由拆分，公共签名变更走批准流程。

~~~ts
interface RuleBlock {
  readonly definition: BlockDefinition;
  readonly placement: Placement;
  readonly location: BlockLocation;
  readonly enterOrder: number | null;
}
interface RuleGroup {
  readonly definition: GroupDefinition;
  readonly integrity: GroupIntegrity;
  readonly everBroken: boolean;
}
interface RulesPosition {
  readonly phase: GamePhase;
  readonly blocks: readonly RuleBlock[];
  readonly groups: readonly RuleGroup[];
  readonly bufferIds: readonly BlockID[];
  readonly melds: readonly MeldRecord[];
  readonly logicalLocks: readonly BlockID[]; // 事务目标锁，不由物理/动画写入
}
// MatchCandidate 的受约束联合已在上方 §4.1 定义；此处仅复用，避免重复声明。
type SelectionProbe = { readonly legal: true } |
  { readonly legal: false; readonly reason: SelectionRejection };
interface HandStep {
  readonly next: RulesPosition;
  readonly combination: MatchCandidate;
  readonly counted: boolean;
  readonly winningHand: WinningHand | null;
}
interface LevelIssue { readonly code: string; readonly path: string; readonly message: string; }
declare function validateLevel(level: LevelDefinition): readonly LevelIssue[];
declare function enumerateCandidates(position: RulesPosition): readonly MatchCandidate[];
declare function chooseCandidate(position: RulesPosition, newBlockId: BlockID | null): MatchCandidate | null;
declare function applyCombination(position: RulesPosition, candidate: MatchCandidate): HandStep;
declare function canSelect(position: RulesPosition, blockId: BlockID): SelectionProbe;
declare function canVirtualInsert(position: RulesPosition, blockId: BlockID): SelectionProbe;
declare function calculateFan(hand: WinningHand): FanResult;
declare function selectUltimateTargets(position: RulesPosition, limit: 1 | 2 | 5): readonly UltimateTarget[];
declare function evaluateTerminal(position: RulesPosition): {
  readonly terminal: TerminalState; readonly stalled: boolean;
};
declare function assertPositionInvariants(position: RulesPosition): void;
~~~

函数归属：LevelValidator.validateLevel；CombinationResolver.enumerateCandidates/chooseCandidate；
HandResolver.applyCombination；BoardRules.canSelect；TerminalRules.canVirtualInsert/evaluateTerminal；
UltimateResolver.calculateFan/selectUltimateTargets；GameState.assertPositionInvariants。

- validateLevel 返回全部问题，空数组才有效；不自动修配置。
- canSelect 只做终局/牌存在/board/blockedBy/逻辑锁验证；canVirtualInsert 额外做实际容量与新块成组模拟，即使容量未满也必须先通过 canSelect，不提交任何状态。
- chooseCandidate 在内部用同一枚举器和已定比较器选唯一候选；newBlockId=null 表示稳定扫描阶段。
- applyCombination 只接受当前 position 中的合法候选，返回新的事务中间态、是否进入计番区和可选的完整胡牌快照。第四副瞬胡也在此检查既有对子；消费本手、番型/目标与大招清除由 GameSession 的下一步骤完成。
- 中间态不得作为 getSnapshot 的结果暴露；GameSession 必须完成稳定扫描、大招和终局后才提交。
- selectUltimateTargets 的 limit 必须来自 calculateFan 的 power，不能由 UI 传入。零合格目标时返回空数组。
- assertPositionInvariants 在稳定提交点检查 ID/去向守恒、紧凑 ≤7、计番上限与终局一致性；校验失败抛错，不部分提交。

## 5. 回放与测试接口

GameReplay 输入 `{ levelId, contentVersion, commands }`；固定初始 ID 分配器，输出每步 accepted/reason、phase、buffer、melds、group/board 状态、番型/目标摘要及最终状态摘要。
对比结果必须忽略性能时间/物理轨迹，却不能忽略命令顺序、拒绝原因或目标集合。摘要按 ID 排序规范化，不依赖对象属性或 Map 无意的遍历顺序。
不要求写入磁盘或持久化“回放系统”；测试在内存执行。未来要保存需另行批准。
白盒用专门 fixture 工厂构造合法边界状态并校验，不给 GameSession 公共 API 加任意 setState。
所有预期应从需求手工推导，不能用同一 Resolver 给测试生成“标准答案”。

## 6. 引擎边界契约

TableProjector：`designToWorld / worldToUi / screenToDesign / getHitRect`。使用可复用输出对象降低活跃效果逐帧分配；视口或安全区变化时集中刷新。
BlockView：`bind(blockId, definition) / render(snapshotEntry) / reset / dispose`，只展示，无规则状态写入。
TileVisualPool：程序生成白膜节点专用 pool；可复用真正的 Prefab 时才使用现有 GameObjectPool.registerPrefab，不伪造 Prefab 或猜测存在的 spawnFactory。创建预算、租借中集合、关闭及回收语义必须测试。
TilePhysicsAdapter：`play(proxy, params, effectScope) / pause / cancelAll / getDiagnostics / dispose`。返回可取消控制句柄，完成/取消/超时只收尾视觉，永不回调 GameSession 修改状态。
EffectPresenter：`present(events, snapshot) / pause / resume / cancelSession(id) / dispose`；旧局/重复 eventId 忽略，错误按最新快照恢复。所有 pending 有界且可清零。G05 就保留暂停接口，G06 可在内部接入刚体适配。
GameRoot：`mount(session, sceneScope) / pause / resume / unmount`；统一由 Bootstrap 前后台监听调用 pause/resume，UI 不访问私有 state，资源走场景所有权。
具体 `cc` API 在编码前用 Creator 3.8.8 的真实声明确认，禁止 `as any` 或补假 `.d.ts` 掩盖错误。

## 7. 兼容与变更

上述公共接口要改变时，在当前批次报告原因、影响模块和需同步的用例，获得负责人批准后同步文档与调用方。局部私有函数拆分无需冒充需求变更，但仍受该批文件范围约束。
尚未实现的 API 不承诺兼容旧游戏；通用框架已经通过的公共面不得为了麻将随意破坏。
