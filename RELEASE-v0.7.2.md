# v0.7.2

TiangZ 套件 0.7.2 中的样例集（GitHub Release）。之前的标签与附件保持不变。

本仓库没有业务代码改动：

- 根包 `tiangz-examples` 0.7.1 → **0.7.2**。模块版本不变（MMORPG、Bench 0.7.0，SLG、battlelab 0.1.0），引擎范围 `[0.7.0, 0.8.0)` 覆盖 TiangZ 0.7.2。
- TiangZ 0.7.2 的宿主升级到 deno_core 0.412，并校验模块 Native crate 的 deno_core 与宿主一致：`modules/mmorpg/rust` 改为 `deno_core = "0.412"`，SLG battlelab 的 Native crate 改为 `^0.412`。v0.7.1 的模块在 0.7.2 宿主上会因版本不一致被拒绝，因此需要本版本。
- MMORPG Rust 工程经相对路径依赖并列的 TiangZ，`Cargo.lock` 随 TiangZ 0.7.2 与 deno_core 0.412 重新解析。
- DBProxy SDK 依赖仍为 `v0.7.0`。

验证（Windows，并列 TiangZ 为 `v0.7.2` 提交 0b2b4726）：`build`/`check -- --package mmorpg`、`build`/`check -- --package slg`、`npm run verify` 通过（游戏测试 193/193），生成物无差异；本仓库没有 CI 工作流。
