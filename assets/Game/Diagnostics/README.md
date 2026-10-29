# Diagnostics

本目录仍无独立用例运行器。现有生命周期诊断在Bootstrap/GameBootstrap.ts，有界触摸采样在Presentation/TouchPerformanceRecorder.ts，不为文档进度生成空脚本。
只有debug构建且显式启用参数才开放开发动作；release不开放任意状态修改入口，Domain/Application不依赖诊断层。
模拟测试、实际Web和手机数据分别报告；当前缺少微信/真机证据。见[项目进度](../../../需求设计/项目进度.md)。
