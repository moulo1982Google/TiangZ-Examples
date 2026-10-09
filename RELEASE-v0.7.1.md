# v0.7.1

TiangZ 套件 0.7.1 中的样例集（GitHub Release）。之前的标签与附件保持不变。

本仓库没有业务代码改动：

- 根包 `tiangz-examples` 0.7.0 → **0.7.1**。模块版本不变（MMORPG、Bench 0.7.0，SLG、battlelab 0.1.0），引擎范围 `[0.7.0, 0.8.0)` 覆盖 TiangZ 0.7.1。
- MMORPG Rust 工程经相对路径依赖并列的 TiangZ，`Cargo.lock` 记录该路径依赖的版本；TiangZ 升到 0.7.1 后由 cargo 重新解析。v0.7.0 的锁与 TiangZ 0.7.1 并列时 `--locked` 构建会失败，因此需要本版本（发布后的干净消费者检查发现）。
- DBProxy SDK 依赖仍为 `v0.7.0`。

验证（Windows，并列 TiangZ 为 `v0.7.1` 提交 520dd744）：`build`/`check -- --package mmorpg`、`build`/`check -- --package slg`、`npm run verify` 通过（游戏测试 193/193、包测试 10/10、7/7），生成物无差异；本仓库没有 CI 工作流。
