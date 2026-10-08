# v0.7.0

TiangZ 六仓库套件 0.7.0 正式版中的样例集（GitHub Release）。候选标签 `v0.7.0-rc1` 与其附件保持不变。

本仓库相对 v0.7.0-rc1 **没有业务代码改动**，只定正式版本：

- 根包 `tiangz-examples` 0.7.0-rc1 → **0.7.0**。
- MMORPG（含 `packages/mmorpg` 与 Rust Native crate）、Bench 模块 0.7.0-rc.1 → **0.7.0**；SLG 与 battlelab 保持 `0.1.0`。所有模块引擎范围改为 `>=0.7.0 <0.8.0`，Bench 对 MMORPG 的依赖同样。用正式命令重新构建后，受版本控制的协议、生成锁与 SDK 文件无差异。
- `@tiangz/dbproxy-sdk` 依赖改为 DBProxy `v0.7.0` 标签；MMORPG Rust 锁随并列的 TiangZ `v0.7.0` 重新解析。

套件内 0.7 的实际改动在 TiangZ（Scene HTTP、`outerIp` 允许域名）与 Developer Tools（HTTP Handler 热更规则）。

验证（Windows，并列 TiangZ 为发布提交 09a9039e）：`build`/`check -- --package mmorpg`、`build`/`check -- --package slg`、`npm run verify` 全部通过；其中游戏测试 193/193、包测试 10/10、另一组 7/7。本仓库没有 CI 工作流。未执行：客户端编辑器内验收、真实存储长稳。
