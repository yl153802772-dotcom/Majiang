# UI施工指南 · Main场景唯一编辑入口

版本UI-HANDOFF-4 / MAIN-UI-03，2026-10-29。项目`/Users/liang/Projects/Majing`，Creator3.8.8。

**本版按负责人本轮图一执行，尚未获负责人重新验收。** 文件名为历史链接保留；不能从“已验收”推断当前通过。旧“Main与Preview共用排版”已被负责人明确否定，不再作为施工依据。

## 1. 在哪里修改

唯一正式入口：[Main.scene](../../assets/scenes/Main.scene)，UUID保持`6f81ed5b-0a4a-4ffc-b7d0-fabc1906c359`。

顶部、右侧、底部和背景均在Main中保存为本地可编辑节点；原GameHUD/背景实例已展开，UI组件/字段仍保留，不依赖运行时按预览重建。不要创建新场景，不要修改SkyWhiteV2Preview，不要回写源Prefab让Main“间接跟随”。原12个Prefab保留为历史/复用模板，当前Main不与其同步排版；GameMenu仍作为通用UIManager加载的功能模态使用。

```text
Main / GameBootstrap（唯一游戏驱动）
├─ BackgroundCanvas / SkyBackground / BackgroundImage
├─ OverlayCanvas
│  ├─ SafeContentRoot / GameHUD
│  │  ├─ TopHud（背景、独立Label、暂停/帮助Button）
│  │  ├─ ToolRail（四工具；暂禁用）
│  │  └─ FooterExactReference / OriginalImageMapping
│  │     └─ FooterExactNative（普通UI根，无Camera/Canvas/RT）
│  │        ├─ meld_frame / Skin
│  │        ├─ buffer_frame / Skin
│  │        ├─ MeldSlot1…4 / Skin、IndexPaper、Index、ContentsRoot
│  │        ├─ BufferSlot1…7 / ContentsRoot
│  │        ├─ MeldTitle / MeldCount / BufferTitle / BufferCount
│  │        ├─ AddMeldButton
│  │        └─ BufferContentsRoot / BufferBlock0…6 / Card0、Card1
│  └─ ModalRoot
├─ Board3DRoot（沿用白膜，本批不重做）
└─ BackgroundCamera / BoardCamera / OverlayCamera
```

## 2. Main中查看第一/第三层

选Main根GameBootstrap，勾选`layoutOnly`可只运行UI和背景：不创建GameSession、牌桌、输入或App模块。关闭后恢复原MVP。交付Main默认**false**，Board3DRoot为active，保证可测试。

这只是同一Main的排版检查选项，不是新场景、第二套驱动、调试写状态入口或功能已验收。第一阶段示例第1关；运行游戏仍读取正式固定关888，不伪造新关卡。

## 3. 参考图与坐标

图一941×1672，参考存证：[负责人参考图](../../docs/reports/MAIN-UI-03-evidence/owner-reference.png)。设计核心720×1280，原点左上。UI通过现有ViewportService统一contain一次；背景940×1672独立cover，不重复给UI乘背景比例。

| 区域 | 图一参考尺寸/坐标 |
|---|---|
| 顶栏可见框 | 约x84/y87/宽773/高66；Main TopHud中心(0,549) |
| 右侧栏可见框 | 约x844/y398/宽94/高546；Main ToolRail中心(319,128) |
| 副牌面板 | x7/y1316/宽923/高153 |
| 底槽面板 | x32/y1452/宽890/高156 |
| 四副中心 | x234.5+163i，y1390，i=0…3 |
| 七槽中心 | x206+104i，y1526，i=0…6 |
| 标题/计数 | 分别独立Label，不能烘焙在皮肤里 |

Main保留941×1672的OriginalImageMapping，等比scale=720/941；FooterExactNative局部(0,-650)。四副局部中心(-236+163i,96)，七槽(-264.5+104i,-40)。图像透明留白需计入：面板Skin的PNG尺寸不等于可见框；不要再直接把九宫格缩到槽位框而挤粗边框。副槽Skin必须在IndexPaper/Index/ContentsRoot之前绘制，否则盖住真实内容。

旧layout.json/30图manifest仅参考原始几何；不得按旧带字整图或旧隐藏MeldStrip方案覆盖Main。本批清除会留下白色拼接痕迹的花饰/云切片，背景花卉保留；字体、独立皮肤与效果图的纹理细节不宣称逐像素相同。

## 4. 真实组件与数据绑定

- [SkyWhiteFooterBindings](../../assets/Game/Presentation/UI/SkyWhiteFooterBindings.ts)：Main保存meldCount、bufferCount、4个meldSlots、7个bufferBlocks、两组各7个牌面Label及addButton。
- [SkyWhiteMeldSlotBindings](../../assets/Game/Presentation/UI/SkyWhiteMeldSlotBindings.ts)：Main每副保存index和4个牌面Label；吃/碰3张、杠4张，不能裁掉第四张。
- [MainUiShape](../../assets/Game/Presentation/UI/MainUiShape.ts)：编号纸片/小装饰的可编辑Graphics，无玩法或相机；编号文本仍为Label。
- [SkyWhiteGameView](../../assets/Game/Presentation/UI/SkyWhiteGameView.ts)：消费GameSnapshot，只更新字段和动态牌面；不按历史Preview重建/替换UI。副槽占用隐藏编号与纸片，重开恢复；双块同根跨连续两格。
- [GameBootstrap](../../assets/Game/Bootstrap/GameBootstrap.ts)：唯一App/GameSession/ViewportService/PauseController/RuntimeLifecycle装配；直接识别Main本地HUD，不再额外加载同名HUD。

余牌=board中实际卡面总数；四副=melds.length；底槽=occupiedSlots。规则/终局只由GameSession决定。时间00:00、星数0为图一占位，原MVP没有计时/评分业务。四工具/加号暂禁用，不扩大需求。暂停/帮助/重开仍使用Framework UIManager/UIBase及暂停租约。

## 5. 资源与所有权

Sprite用于独立无字皮肤/图标。七槽使用不含字的独立槽位纹理；不能把整张原型或带计数的面板当成UI。Main场景持有保存的组件和资产依赖；Presenter只回收自己的监听/临时提示，不提前销毁Main UI。模态GameMenu通过game-ui Bundle的ResManager/UIManager加载，保留通用框架生命周期。

底部禁止Camera、Canvas、RenderTexture、读回、整图合成或截图导出实现。既有meta/UUID保持；本批脚本未写入源PNG、库Prefab、旧预览、Framework、Domain/Application或关卡。最终范围核对发现库FooterExactNative另有同期尺寸/序列化改动，来源未确认，已保留未覆盖；它不再驱动Main。详情以阶段3报告/机器清单为准。

## 6. 验证与交付

[阶段1](../../docs/reports/MAIN-UI-03-阶段1-Main排版.md)：同一Main检查第一/第三层。
[阶段2](../../docs/reports/MAIN-UI-03-阶段2-MVP融合.md)：真实MVP融合。
[阶段3](../../docs/reports/MAIN-UI-03-阶段3-完整整合.md)：最终包、适配、范围及限制。

只读资产核对：`python3 UI/_tools/check_current_ui.py`。当前文件基线[UI组件基线](UI组件基线.manifest.json)、[机器交接](ui_handoff.json)、[审计](current_ui_component_audit.json)。旧基线/报告仅保留追溯，不代签本轮视觉、微信、真机或完整MVP验收。
