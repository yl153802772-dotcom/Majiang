# 晴空蓝白UI · Main当前施工入口

2026-10-29 / UI-HANDOFF-4 / MAIN-UI-03。**本轮按负责人图一整改，等待重新验收。**

- 唯一UI编辑与运行入口：[Main.scene](../assets/scenes/Main.scene)。顶部、右侧、四副七槽及背景直接保存在Main；没有新增场景，不再跟随旧Preview/源Prefab排版。
- [Main施工指南](_docs/已验收UI架构与施工指南.md)、[后续任务模板](_docs/Codex_UI后续施工任务模板.md)、[机器清单](_docs/ui_handoff.json)。
- Main的GameBootstrap.layoutOnly可仅查看第一/第三层；交付默认关闭，沿用白膜验证原MVP，不重做麻将美术。
- 底部是真实可编辑Label/Button/内容节点，无相机、Canvas、RT或整图；时间/星数占位、工具/加号禁用。
- [阶段1 Main排版](../docs/reports/MAIN-UI-03-阶段1-Main排版.md)、[阶段2 MVP融合](../docs/reports/MAIN-UI-03-阶段2-MVP融合.md)、[阶段3 完整整合](../docs/reports/MAIN-UI-03-阶段3-完整整合.md)。
- 当前[组件基线](_docs/UI组件基线.manifest.json)、[资产审计](_docs/current_ui_component_audit.json)。只读核对：`python3 UI/_tools/check_current_ui.py`。

旧SkyWhiteV2Preview、源Prefab、layout.json和历史基线/报告保留追溯；不能用其“已验收”、像素零差分或旧共享布局结论证明当前Main已获批准验收。微信/真机、真实物理另按项目阶段执行。

## 3D 麻将美术样品（独立待确认）

2026-10-29 新增 [MAHJONG-3D-01 首版资源包](L2_3D/mahjong_v1/README.md)：640 三角面的圆角白模，以及暖白牌身/天空蓝底的九条样品。包含 glTF/GLB、颜色/ORM 贴图、真实网格预览和 Cocos 导入说明；仅生成九条，其余牌面待负责人确认后制作。本包尚未导入 Cocos，也未替换 Main 的现有麻将显示，不改变上面的 UI 施工入口或验收状态。
