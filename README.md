# Majiang · Cocos 微信小游戏

Cocos Creator **3.8.8** + TypeScript strict。当前包含通用框架、固定关卡 `888-v3`、可玩 MVP 和 Main UI/背景。真实物理、微信开发者工具及真机验收尚未完成。

## 克隆与运行

```sh
git clone https://github.com/yl153802772-dotcom/Majiang.git
```

1. 使用 **Cocos Creator 3.8.8**，在 Dashboard 中添加克隆目录下的现有工程；该目录包含 `package.json`、`assets` 和 `settings`。
2. 等待首次资源导入完成。`library`、`temp`、`profiles` 由编辑器自动生成，无需从仓库下载，也无需安装 npm 依赖。
3. 打开 **`assets/scenes/Main.scene`**，点击编辑器预览运行。
4. Main 根节点的 `GameBootstrap.layoutOnly` 应关闭，运行真实 MVP；勾选时只查看 UI 和背景，不能取牌。旧 `SkyWhiteV2Preview` 只保留历史参考，不是正式运行入口。

麻将暂用白膜；四副/七槽、听牌/胡牌、大招、失败、通关、重开以及暂停/帮助使用现有逻辑。四工具及加号暂禁用；时间/星数为占位，没有额外玩法。

## 仓库内容

| 路径 | 用途 |
|---|---|
| `assets/` | 完整代码、Main 场景、预制体、已导入美术与全部 `.meta`；必须保持 UUID 配套 |
| `settings/` | 可共享的 Creator 工程设置，包括设计分辨率 |
| `package.json` / `tsconfig.json` | 工程版本、检查命令和 TypeScript 规则 |
| `tools/` / `tests/` | 类型、依赖边界与回归验证；测试需要的接口文档/UI 参数也随仓库保留 |
| `需求设计/01_需求定稿`、`02_架构与接口`、`03_开发规范与验收` | 当前正式需求、接口与编码规则 |
| `UI/_docs/` | 少量当前 Main 施工资料及测试使用的 `bottom_exact/manifest.json` |
| `AGENTS.md` / `开发日志.md` | 项目协作规则、实际开发与验证记录 |

`.gitignore` 排除缓存、构建包、本机设置、原始美术/建模副本、历史原型和截图证据。运行资源均保存在 `assets/`；本次不把素材从工程移走。历史文档中的部分截图/报告链接只在原工作区保留，不属于运行依赖。

## 可选命令行检查

先用 Creator 打开工程，生成 `temp/tsconfig.cocos.json`；使用支持 `node --import` 的 Node.js。检查器复用已安装 Creator 的 TypeScript，不需要 `npm install`。

```sh
npm run check
npm run check:game
npm test
npm run test:game
```

macOS 默认查找 Creator 3.8.8 安装目录。Windows/Linux 或自定义安装位置需将 `COCOS_TYPESCRIPT` 指向该 Creator 自带的 `typescript/lib/typescript.js`，随后运行命令；不要提交本机绝对路径或生成的 `temp`。

后续协作先遵守 [AGENTS.md](AGENTS.md)，再读 [当前需求](需求设计/01_需求定稿/MVP_FINAL.md)、[接口契约](需求设计/02_架构与接口/MVP_V2_CONTRACTS.md)及 [Main 施工指南](UI/_docs/已验收UI架构与施工指南.md)。GitHub 源码上传不等于游戏发布或完整 MVP 验收。
