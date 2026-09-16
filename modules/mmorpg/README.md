# MMORPG 可复用模块

模块 ID：`org.tiangz.mmorpg`，版本 `0.6.0-alpha.0`。它不是 TiangZ Core，也不是必须安装的默认游戏。

## 先看四处

1. `tiangz.module.json`：模块能力、入口、公开 API、协议、配置和 Native 的位置。
2. `src/model/index.ts`：模块注册。`src/model/public.ts` 是其他模块可以使用的公开契约。
3. `src/model/<领域>`：Scene、Entity、Component 的稳定状态；改这里需要重启。
4. `src/hotfix/<领域>`：System、Handler 与业务行为。

`proto/` 的 .proto 与锁、`game_config/` 的 Luban 源数据、`native/` 的声明，以及 `rust/src/game` 和 `rust/src/native_data.rs` 是模块拥有的输入。协议编号沿用拆分前契约，没有重新分配。

`src/model/generated`、`src/hotfix/generated`、`generated/`、`game_config/generated` 和 `rust/src/generated` 是生成物。不要手写 System 方法占位，也不要修改 Native/协议生成代码来绕过指纹检查。

在 Examples 根目录运行 `npm run server:build` 完成生成与 TS 构建；Native 改动还要运行 `server:native-build`。`test:native` 验证模块 Rust 单测和真实 V8 op；`test:runtime` 验证整条登录/地图链路。

## 其他工程使用

通过宿主 `modules:link -- --source ../TiangZ-Examples/modules/mmorpg --modules-dir <安装目录> --name mmorpg` 安装模块；在消费模块 manifest 中显式添加直接依赖，并使用 `#tiangz/modules/org.tiangz.mmorpg` 导入公开类型。不要导入它的内部文件，也不要把源码复制回引擎 app 目录。

模块的资源路径相对于运行工程；运行工程必须部署所用地图的 navigation 资源。配置注册走 ModuleConfigRegistry，冷表变化拒绝在线安装，需重建重启；旧格式配置文件仅用于示例 SDK 导出与测试，不是宿主内置配置。
