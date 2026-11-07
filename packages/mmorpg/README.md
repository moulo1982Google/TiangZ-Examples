# MMORPG 示例包

从 Examples 根目录运行 `npm run build -- --package mmorpg`，然后用 `check`、`smoke` 或 `start` 操作同一个包。在本目录也可直接执行 `npm run build`。

Windows 已构建后可直接双击 Examples 根目录的 `start-mmorpg.bat` 启动服务端，在窗口中输入 `shutdown` 并回车停止。脚本不构建、不启动数据库或客户端；首次使用、升级宿主或修改服务端源码后，先重新运行上述 `build`。

当前 MMORPG 的 check 沿用生成后类型检查流程，会刷新模块生成物但不修改协议锁；SLG 的 check 为只读一致性检查。共享模块的生成/构建操作应串行运行。

0.7 候选把地图部署放在 `configs/local/map-deployment.json`，`setup/build` 用模块自己的强类型校验生成 `map-deployment/runtime.pack.json`，`check/start/smoke` 检查是否过期。Process 只引用通用数据包；地图规则仍属于本模块。修改部署后重新构建并重启，不能通过 Hotfix 更改拓扑。旧配置的 `staticMapIds/acceptDynamicMaps` 暂仍接受；同时提供新旧值时必须完全一致，声明包缺少当前 MapHost 时拒绝启动。

默认布局为同级 `TiangZ/` 和 `TiangZ-Examples/`，本候选 Rust 依赖也使用该布局。联合开发显式设置 `TIANGZ_ENGINE_ROOT` 时，还必须把 `modules/mmorpg/rust/Cargo.toml` 中的 TiangZ 路径对齐到同一宿主，并用 Cargo 生成锁后重建。环境变量不会改写 Cargo 依赖；Native 组合构建拒绝同版本的其他宿主源。

- `tiangz.example.json`、`package.json`、`tools/workspace.mjs`：手写包入口。
- `configs/local/all-in-one.json`：本包运行配置，普通启动使用该配置的固定端口；启动前确认没有冲突。
- `modules/`：构建时显式安装 MMORPG、Bench 根联接，不提交 Git，不自动扫描其他示例。
- `dist/`：仅本包的 Model、Hotfix、配置构建输出。
- `navigation/`：首次构建从共享导航资源初始化；之后不覆盖本包已有地图。

可复用业务源码在 [../../modules/mmorpg](../../modules/mmorpg/README.md)。客户端仍在根 `clients`，组合 SDK 在根 `client_sdk`，用根目录 `codegen:sdk`、`sdk:sync`、`check:clients` 管理。服务端 build 不代表正式客户端平台构建。

`smoke` 使用临时目录、随机端口和内存状态，验证登录、Map 1 和 Cocos 3D 使用的 Map 100、方向移动/停止、退出和角色切换后关闭自己启动的进程；不操作已有数据库。普通 `start` 不自动构建，缺少正确 Native 制品时会拒绝启动。

## 原生测试与宿主升级

在 Examples 根目录运行 `npm run test:native`。升级宿主时，如果测试提示 `Cargo.lock` 需要更新，应在宿主目录使用 Cargo 重新解析模块锁文件，检查宿主和 DBProxy tag 的差异，然后重跑 `npm run test:native`；不要移除测试的 `--locked`。例如 Windows x64 在宿主目录执行：

```powershell
cargo metadata --manifest-path ../TiangZ-Examples/modules/mmorpg/rust/Cargo.toml --format-version 1 --filter-platform x86_64-pc-windows-msvc > $null
```

Windows 上若 Rust 缓存和测试目标位于不同盘符，V8 的默认符号链接可能因缺少特权失败。测试入口会从锁定的 Cargo 元数据定位 V8，并按宿主构建方式创建目录联接；如果现有联接指向其他版本，入口会拒绝覆盖，可将 `TIANGZ_NATIVE_TEST_TARGET_DIR` 指向新的测试输出目录后复测。
