# 历史内置宿主验收脚本

这里保留拆分前的专用联机、故障与长稳脚本，方便查阅历史性能报告和原始断言。它们依赖旧的内置宿主目录与固定部署拓扑，不是当前 npm 的可执行入口；不要直接运行，更不要用来操作现有服务。

当前入口在工程根目录：`server:build`、`server:native-build`、`test`、`test:native`、`test:runtime` 和 `verify:server-assets`。新的联机冒烟使用独立临时资源根、随机端口、内存数据，并且只停止自己创建的进程。

游戏单元测试已迁到 `tests/` 并接入执行，而非归档。MMORPG 的 Rust 数据存储、AOI 与 Native bridge 测试在 `modules/mmorpg/rust`。长稳、数据库故障与真实引擎客户端验收仍须单独授权。
