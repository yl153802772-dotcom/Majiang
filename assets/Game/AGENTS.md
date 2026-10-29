# Game 编码补充规则

先遵守 `/Users/liang/Projects/Majing/AGENTS.md`。本文件不授予修改权限。

本目录已有MVP V2内部可玩Web白膜、规则/会话/表现与R03生命周期加固。真实轻3D物理和微信/真机验收仍未完成。后续开工必须有负责人明确批准的批次任务单。

先读项目根目录 `需求设计/README.md`、`需求设计/项目进度.md`，再读其中的MVP_FINAL、游戏架构V2、接口契约、Harness规则和本批验收/任务表。不使用历史游戏架构V1开工。开发日志由Codex按根AGENTS约定统一维护。

- Domain/Application 为纯 TS；不依赖 cc、wx、Framework 单例、表现、随机、网络或存储。
- Config 保存唯一固定关数据，UI/物理参数不进入规则配置。不能改关卡来让错误算法通过。
- GameSession 是唯一局状态写入者；UI/物理/动画只消费快照与事件，不计算配方或胜负。
- UI 全 2D，牌桌 2D 视觉；牌效果用真实轻 3D 白膜和受限刚体，双块不拆分。物理不改变玩法。
- Framework 不依赖 Game；本批不得顺手改通用框架或项目设置。
- 保留 strict；Map/Set/iterator 转数组用 Array.from，避免 Creator 展开转译差异。
- 新资产保持有效且唯一的 .meta，现有 UUID 不变；所有视觉有作用域、取消和清理，不阻塞下一轮输入。
- 测试必须独立推导预期；Node/mock 通过不等于 Cocos、微信工具或真机通过。

详细边界与完成报告遵循上述项目文档，遇冲突或超范围先报告负责人。
