# 示例工程协作入口

- SLG 在 packages/slg；MMORPG 包入口在 packages/mmorpg。根 build/check/start/smoke 必须带 --package <name>，不默认构建所有包；根 check:clients 保留六个 MMORPG 客户端检查。各包输出在自身 dist，生成协议锁必须显式操作。

- 本工程拥有 MMORPG/Bench 服务端模块、游戏协议与配置、Native 游戏代码、六个客户端、部署示例及游戏测试；TiangZ 引擎源码在独立仓库。
- 修改前检查 `git status --short`，保留未提交代码和编辑器元数据。不要重建主工程的 `client_demo` 或添加指回它的目录联接。
- `tiangz.clients.json` 中声明的 SDK 和 Handler 输出是生成物，不手改。运行本工程 `server:build`、`codegen:sdk`、`sdk:sync`；引擎通用 SDK 通过组合生成器使用，不向引擎写回游戏协议。
- `.tiangz/client-sdk.manifest.json` 是生成哈希记录，不能为通过检查而手改。
- 普通 MMORPG 客户端修改至少执行 `npm run check:clients`；SLG 使用 `npm run check -- --package slg`。Cocos 编辑器构建、UE/Unity/Godot 真机验收未执行时必须明确说明。无编辑器类型时的独立打包不等于完整 Cocos 检查。
- 不把玩法放入 SDK/Core，不启动或修改现有服务、数据库。
- 模块 Model 承载稳定状态，Hotfix 只承载行为；Native/Model/协议变化必须重建重启。公开依赖使用 `#tiangz/modules/<id>`，不要重建引擎旧目录联接。
- 游戏单测用 `npm test`，Rust 用 `test:native`，隔离联机用 `test:runtime`；框架测试归引擎。`legacy` 与 `perf` 中旧固定拓扑脚本是历史资料，不直接运行。
