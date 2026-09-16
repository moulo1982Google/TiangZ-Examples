# org.tiangz.slg.battlelab

TiangZ外置游戏模块。Model状态放在`src/model`，Hotfix System/Handler及其显式loader放在`src/hotfix`。

模块增删、manifest或Model变化需要完整构建并重启Process；已有行为变化才允许Hotfix。

包含 Rust 扩展；先阅读 RUST.md，运行 Native codegen 后再类型检查。
