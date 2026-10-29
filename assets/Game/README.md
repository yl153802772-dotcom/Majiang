# Game · 游戏代码入口

当前已有G01～G05内部可玩Web白膜、规则/会话/回放与R03生命周期加固。需求/契约V2.3，关卡888-v3；真实轻3D物理、微信工具与真机完整验收仍未完成。
先读根[AGENTS](../../AGENTS.md)、[本目录规则](AGENTS.md)、[需求设计入口](../../需求设计/README.md)、[项目进度](../../需求设计/项目进度.md)和获批任务。

| 目录 | 责任与当前状态 |
|---|---|
| Domain | 纯规则、终局与状态不变量，已实现 |
| Config | 固定关/推荐序列/表现常量，已实现 |
| Application | 命令事务、快照、事件与回放，已实现 |
| Bootstrap | 唯一GameBootstrap入口、启动与重试、前后台、退出，已实现 |
| Presentation/UI | 2D文字/状态/四副/七槽/结果/触摸，已实现 |
| Presentation/Table3D | 静态白膜Mesh与共享资源已实现；真实物理替身待G06 |
| Diagnostics | 尚无独立用例运行器；现有显式debug诊断在Bootstrap/Presentation |

不要生成空类来冒充进度；规则不进入Framework，后续批次仍须负责人批准。日志由Codex记录在根[开发日志](../../开发日志.md)。
