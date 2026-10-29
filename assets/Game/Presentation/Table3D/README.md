# Table3D

BlockView及BoardView/BoardResources已实现真实有厚度的静态白膜Mesh、共享材质及按快照显示；投影入口位于上级Presentation/TableProjector.ts。
共享资源在场景寿命内复用，R03已补部分分配失败回滚和退场释放；桌面视觉仍为2D，不用渲染遮挡代替blockedBy。
真实动态刚体替身/物理池尚未实现，最多12个、双块整体、仅碰效果地板是G06的设计约束，不是已验收结果。见[项目进度](../../../../需求设计/项目进度.md)。
