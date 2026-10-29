# 通用框架独立示例

本目录用于验证框架复用，不连接当前游戏规则、美术UI、网络服务或广告位。引擎目标为Creator 3.8.8；入口为`FrameworkDemo.scene`。

## 运行

在Creator中打开本场景并运行。场景只有一个FrameworkDemo驱动，通过App装配资源、UI、定时器、平台运行时和可选RuntimeLifecycle；不要再挂FrameworkBootstrap或GameBootstrap。
场景在运行时选择720×1280/SHOW_ALL，不修改项目设置文件。白块应位于绿色2D参考框中，横屏窗口保留完整内容。

| 控件/观察点 | 预期 |
|---|---|
| 帧驱动计数 | 运行时递增；暂停时停止，UI按钮仍可用 |
| 暂停/继续 | 只释放本按钮的demo-menu租约 |
| 打开模态窗口 | 加入demo-dialog暂停；真实Prefab与原生Button运行 |
| 关闭模态 | 释放dialog暂停；菜单若仍暂停，不恢复计数 |
| 重复加载 | 同键请求共享JsonAsset；结束后owner不累积 |
| 重建示例 | 重建轮次增加，旧App退出后再装配新App；资源与层节点不累积 |
| DPR/窗口变化 | UI与3D参考框始终共用ViewportService，不将物理像素重复除DPR |

Content为独立`framework-demo` Asset Bundle，包含配置和模态Prefab；使用原生文字与白块，不引用UIRuntime或Game。正式游戏构建应按自己的Bundle清单排除本示例内容。

## 独立迁移

在来源工程根目录运行`node tools/framework-release.mjs export build/<新目录> --examples`。输出包含assets/Framework及本示例、meta、独立接入README与资产哈希清单。目标目录必须尚不存在，工具不会覆盖旧导出。
将导出的assets内容放入另一个已创建的Creator 3.8.8工程，打开本场景即可；不要求复制Game、UI、来源项目设置、npm依赖或原始聊天记录。

自动测试使用cc/wx替身，真实引擎构建、真实浏览器、微信工具和真机证据各自记录，不相互代替。测试结果见来源工程报告；此说明本身不表示平台验收完成。
