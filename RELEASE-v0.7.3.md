# v0.7.3

TiangZ 套件 0.7.8 中的样例集（GitHub Release）。之前的标签与附件保持不变。

本仓库没有业务代码改动：

- 根包 `tiangz-examples` 0.7.2 → **0.7.3**。模块版本不变（MMORPG、Bench 0.7.0，SLG、battlelab 0.1.0），引擎范围 `[0.7.0, 0.8.0)` 覆盖 TiangZ 0.7.7。
- **客户端 SDK 副本同步到 TiangZ 0.7.7**（`npm run codegen:sdk` 与 `npm run sdk:sync`，并列 TiangZ 为 `v0.7.7` 提交 `1c4a36be`）：TypeScript `RpcSocket` 在远端关闭时把已入队回复的 RPC 交给 `update()` 按到达顺序交付；C# `RpcSocket` 的远端关闭改由 `Update()` 在已收到的帧之后处理，`Closed` 在 `Update()` 线程触发。影响 Cocos 2D/3D、Pixi、Unity 示例客户端与 `client_sdk/` 下的共享副本；其他 SDK 文件与协议生成物内容不变。生成清单 `.tiangz/client-sdk.manifest.json`、`codegen.manifest.json` 与 MMORPG 的协议、配置清单随引擎文件哈希更新。
- **依赖安全补丁**：`vitest` 与 `@vitest/coverage-v8` 5.0.0 → 5.0.5（仍为精确版本），`vite` 随之升到 8.3.5，`npm audit`（全部与生产）为 0。
- **MMORPG Rust 锁随并列的 TiangZ 0.7.7 重新解析**：`TiangZ` 0.7.2 → 0.7.7（经它间接使用的 DBProxy 客户端随之从 `v0.7.0` 变为 `v0.7.3`，并带入 0.7.6 崩溃诊断的 `libc`/`windows-sys` 依赖边），`quinn-proto` 0.11.18、`rustls` 0.23.46、`rustls-webpki` 0.103.16、`webpki-root-certs` 1.0.11，与 TiangZ 0.7.7 锁文件版本一致。`cargo audit` 由 9 项漏洞降为 0；剩下 3 项警告（`paste` 无人维护、`tokio` 不健全、`chacha20` 被撤回）与 TiangZ 0.7.7 相同。
- 根包 DBProxy SDK 依赖仍为 `v0.7.0`。

验证（Windows，并列 TiangZ 为 `v0.7.7` 提交 `1c4a36be`）：`npm run verify` 通过（游戏测试 61 个文件 193/193，SDK 同步无差异、客户端检查、服务端资产与样例包检查）；`npm run test:native`（`cargo test --locked`，MMORPG Native 库 49 项与桥接 2 项）通过；`cargo audit` 对两份 Rust 锁均为 0 项漏洞。本仓库没有 CI 工作流。
