# 起步验收（2026-09-15）

## 开发流程精简

- `setup` 和完整 `build` 通过：只生成服务端/TypeScript SDK，生成后不再重复执行协议产物检查；保留完整类型与客户端检查。
- 实际运行 `dev`：只检查服务端和宿主版本、打包并启动，没有调用 Cargo 或全量前端检查；通过 shutdown 正常停机。随后 `smoke` 完成真实 WebSocket 重复快照 RPC、DBProxy 认证连接及正常停机。
- 旧 Godot 产物和两份重复开发说明移到工作区外层可恢复归档，重新生成后 Godot 目录未重建。协议锁、Creator meta 和数据库数据未删除。
- 框架 `test:game-modules`、协议生成回归（默认双 SDK、禁用/恢复 Godot、非法选项拒绝）、codegen 清单、严格版本与 diff 检查通过。Godot 实际运行因未设置 GODOT_BIN 跳过。
- 本轮未重跑框架 quick/full、容量、长稳或 Creator 浏览器验收；使用针对构建工具的回归与 SLG 实际联调。完整构建仍有原有 LNK4098 警告。
- MMORPG 默认宿主装配尚未拆分，不能删除打包中的示例代码/配置。dev 不是 Watcher 或自动热更；同版本 Rust/Native 源码变更仍必须显式 build。

## 宿主升级：TiangZ 0.6.0-alpha.0

- 模块宿主范围迁移为 `[0.6.0-alpha.0, 0.7.0)`，游戏模块仍为 0.1.0。
- `npm.cmd run build`：模块协议生成（未更新锁）、SDK 同步、模块/连接层/Creator 完整类型检查、独立 Bundle 与 Rust 宿主构建通过。宿主 `--version` 返回 `TiangZ 0.6.0-alpha.0`。
- `npm.cmd run smoke`：新宿主认证连接独立 DBProxy 成功，真实 WebSocket 重复读取城池、林地、农田、矿场快照通过；测试进程正常退出。
- 本次未重新运行 Creator 画面构建或浏览器验收，未重部署数据库，未实现新的游戏玩法。MSVC 构建仍有 LNK4098 警告，未阻止编译。

## 后续环境接入验收：Creator 3.8.8 与独立 DBProxy

下方“未定位编辑器、未接入数据库”是首轮历史状态，本节记录后续结果。

- `npm.cmd run client:build`：通过真实 Creator 3.8.8 Web Desktop 构建。
- `npm.cmd run check`：通过编辑器生成的完整 cc 类型检查，模块及 SDK 一致性检查通过。已覆盖 moduleResolution 为 Bundler，解决默认 node10 与宿主 TypeScript 6 的兼容问题。
- `npm.cmd run dbproxy:up`：从当前 DBProxy 源码构建独立镜像，启动独立 PostgreSQL/Redis/DBProxy，命名卷与凭据不复用其他工程。
- `npm.cmd run dbproxy:smoke`：真实 SDK 写入、版本迁移、第二个进程重读与旧写入拒绝通过；独立库中留下一条唯一验收记录，不是玩家存档。
- 游戏启动日志确认 DBProxy 连接池认证连接 `127.0.0.1:18700` 成功。
- 真实浏览器运行发布产物：Main 场景正常，显示“边境原野 · 在线 · 4 个地点”，城池/林地/农田/矿场均存在，控制台无运行错误。截图见 [Creator 3.8.8 实际画面](creator-3.8.8.png)。

数据库组保持运行；游戏与静态预览仅用于本次验收，结束后停止。未进行容量、长稳、故障注入、Native 客户端发布或完整框架回归；未修改业务 Proto，也没有更新协议锁。

## 通过

- `npm.cmd run setup`：模块协议生成、SDK 同步、编辑器路径准备以及检查。
- `npm.cmd run build`：模块独立类型检查、Model/Hotfix Bundle、配置启动包、Rust 开发二进制构建。
- `npm.cmd run smoke`：实际 TiangZ 进程，实际 WebSocket 与生成 SDK；世界名、尺寸、四个唯一地点、坐标边界与重复 RPC 一致性；最后通过父进程 stdin 控制正常停机，退出码 0。
- 上述命令内部的 check：模块目录验证、只读协议/SDK 一致性、连接层严格 TypeScript 检查、Cocos 主脚本打包检查。
- 主工程 `git diff --check`。

## 未通过或未执行

- 额外启动的宿主 `npm.cmd run verify:quick` **没有完整通过**：其嵌套 check 为 14/15，native-data 测试受全局 GCC/MSVC 混用影响链接失败；后续 clippy 扩展回归已主动停止。不能引用本次为 quick 全绿。SLG 命令在自己的子进程环境中排除 GCC 的 CC/CXX，实际 build/smoke 已通过；未修改全局环境。
- 未运行本轮完整 `npm run verify`、长稳或容量测试。
- 已发现本机 Cocos Dashboard，但尚未定位 Creator 编辑器。未运行 Creator 导入、完整 cc API 类型检查、Web 发布及画面验收；打包检查不能代替这些验证。
- 未接入或修改 DBProxy，未启动数据库、迁移或部署。

当前闭环是公开只读世界快照，登录、派兵、采集与返程入账没有实现，不属于本轮已验证功能。
