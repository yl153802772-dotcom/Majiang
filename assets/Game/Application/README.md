# Application

GameSession同步命令事务、只读快照/事件及GameReplay回放已实现；仅依赖Domain和外部注入的数据/ID，不依赖cc、wx、Framework单例或Presentation。
双形式将、pairCleanup冻结/清理、稳定终局和重开由唯一会话处理；UI/动画不得直接改会话状态。
契约见[接口约定](../../../需求设计/02_架构与接口/MVP_V2_CONTRACTS.md)，当前进度见[项目进度](../../../需求设计/项目进度.md)。
