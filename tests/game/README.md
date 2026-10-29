# MVP V2 游戏测试

已具备关卡、静态边界检查、纯规则、会话、回放、表现适配、采样和启动/构造生命周期测试；R03实际基线159项（含144顺序变体的一项组合回归）。本轮复跑结果以根[开发日志](../../开发日志.md)为准。
使用手工期望、反例及现有register.mjs/TypeScript加载器，不安装新测试依赖。

npm test只发现tests根目录，不会执行此目录。项目根目录执行：

~~~sh
npm run check
npm test
npm run check:game
npm run test:game
~~~

纯规则不依赖引擎；cc mock/生产源码依赖注入用例不冒充真实Cocos或真机测试。文档契约已迁到[需求设计](../../需求设计/02_架构与接口/MVP_V2_CONTRACTS.md)。
