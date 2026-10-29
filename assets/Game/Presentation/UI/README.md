# UI

HudView、BufferView、MeldView、ResultView和BoardInput已实现；按钮、文字、底槽、四副、结果与牌面字体均为2D。
有效TouchEnd提交一个完整BlockID，支持旧局取消、滑动阈值、拒绝反馈与完整同步计时；UI不依赖物理碰撞决定可选性，不写规则。
坐标通过Presentation/TableProjector统一。阶段与平台边界见[项目进度](../../../../需求设计/项目进度.md)。
