# MMORPG 示例包

从 Examples 根目录运行 `npm run build -- --package mmorpg`，然后用 `check`、`smoke` 或 `start` 操作同一个包。在本目录也可直接执行 `npm run build`。

当前 MMORPG 的 check 沿用生成后类型检查流程，会刷新模块生成物但不修改协议锁；SLG 的 check 为只读一致性检查。共享模块的生成/构建操作应串行运行。

- `tiangz.example.json`、`package.json`、`tools/workspace.mjs`：手写包入口。
- `configs/local/all-in-one.json`：本包运行配置，普通启动使用该配置的固定端口；启动前确认没有冲突。
- `modules/`：构建时显式安装 MMORPG、Bench 根联接，不提交 Git，不自动扫描其他示例。
- `dist/`：仅本包的 Model、Hotfix、配置构建输出。
- `navigation/`：首次构建从共享导航资源初始化；之后不覆盖本包已有地图。

可复用业务源码在 [../../modules/mmorpg](../../modules/mmorpg/README.md)。客户端仍在根 `clients`，组合 SDK 在根 `client_sdk`，用根目录 `codegen:sdk`、`sdk:sync`、`check:clients` 管理。服务端 build 不代表正式客户端平台构建。

`smoke` 使用临时目录、随机端口和内存状态，验证登录/进图/退出后关闭自己启动的进程；不操作已有数据库。普通 `start` 不自动构建，缺少正确 Native 制品时会拒绝启动。
