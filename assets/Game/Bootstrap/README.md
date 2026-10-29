# Bootstrap

Main.scene已接入唯一GameBootstrap，统一装配三相机、场景资源和游戏模块，通过App驱动更新、前后台、退出与错误重试；不同时启用FrameworkBootstrap。
普通重开复用GameSession与场景资源，不重建App；显式debug重建属于诊断，release不开放。R03已补部分构造回滚、启动代次、迟到回调隔离及独立错误UI。
当前阶段见[项目进度](../../../需求设计/项目进度.md)，不将真实物理或微信/真机验收写成完成。
