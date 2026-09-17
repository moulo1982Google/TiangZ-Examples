# TiangZ 示例工程

这里拥有独立的 SLG、MMORPG 示例包，以及可复用模块和客户端资源，不再依赖引擎内置 Demo。

## 按包开始

在 Examples 根目录执行（PowerShell 可使用 npm.cmd）：

```powershell
npm run packages
npm run build -- --package slg
npm run check -- --package slg
npm run smoke -- --package slg
npm run start -- --package slg
```

把 `slg` 换成 `mmorpg` 就只操作 MMORPG。构建包含所选包的服务端 TS 与所需 Rust 宿主，不执行其他包、不自动启动数据库、不修改协议锁。省略或写错包名直接报错，不隐式构建全部。`--dry-run` 只显示入口与输出位置。

SLG 完整工程已迁入 [packages/slg](packages/slg/README.md)，Cocos 3.8.8 打开 `packages/slg/client/cocos`；也可执行 `npm run client:open -- --package slg`。正常启动仍需 SLG 本地数据库配置，独立数据库命令在该包目录执行，容器名、端口和数据卷不变。已运行容器不会由迁移自动重启；下次显式部署使用新目录。

[packages/mmorpg](packages/mmorpg/README.md) 管理 MMORPG 的运行配置、模块安装点和独立 dist；可复用模块仍在根 modules，六个 MMORPG 客户端和 SDK 仍在 clients/client_sdk，不复制到每个示例。各包输出均在自己的 `packages/<name>/dist`，SLG 不安装 MMORPG。

`tiangz.example.json` 是手写的包名/操作入口清单，不是模块清单。新增包放入 packages 的直接子目录并声明入口即可；模块发现和依赖校验仍归 TiangZ 工具。无需安装第二套编译器或依赖 npm workspace 才能使用包选择命令。

## 目录从这里看

| 路径 | 用途 |
| --- | --- |
| packages/slg | 完整 SLG 示例：服务端模块、Cocos 客户端、配置与工具 |
| packages/mmorpg | MMORPG 可运行示例入口、配置与独立构建输出 |
| modules/mmorpg | 可复用 MMORPG：Model、Hotfix、协议、配置、Native 与公开 API |
| modules/bench | 可选的 Bench/消息验证模块，不属于 Core |
| clients | 六个客户端的手写业务、资源与编辑器文件 |
| configs | 原有本地、集群和部署示例配置；启动前检查端口和持久化设置 |
| navigation | 示例地图导航资源 |
| client_sdk | 通用 SDK 与本模块协议/配置组合后的客户端产物 |
| tools | 本工程生成、检查、构建入口 |
| tests | 从引擎迁出的游戏测试及模块回归测试 |
| legacy | 旧内置宿主的固定拓扑验收脚本，仅作历史参考 |
| perf | 历史性能工具与报告输入；不属于日常启动路径 |
| tiangz.clients.json | SDK 与客户端 Handler 输出位置声明 |
| .tiangz | SDK 生成文件哈希记录，不手改 |
| dist、temp | 构建和验证输出 |

模块的手写物与生成物详见 [MMORPG 模块说明](modules/mmorpg/README.md)。

## 首次构建

要求同级 TiangZ 和 TiangZ-DBProxy，先安装引擎依赖，再在这里执行：

```powershell
npm install
npm run server:build
npm run server:native-build
npm run codegen:sdk
npm run sdk:sync
npm run check:clients
npm run test:runtime
```

server:build 负责模块编辑器路径、协议、Luban、Native 接口、System 声明和 TS 配对构建；server:native-build 编译包含模块扩展的 Rust 宿主。二者不能互相替代。

test:runtime 使用自己的临时目录、随机本地端口和内存数据，验证注册、角色选择、进图、AOI、退出与角色切换。它不使用现有数据库或停止别的服务。正常启动执行 server:start；hello 会先构建再启动，使用 configs/local/all-in-one.json 的端口。

## 日常验证

三类可靠性测试使用 `npm run reliability` 查看计划（默认不执行）。Hotfix、DBProxy故障、游戏进程崩溃恢复可分别选择，构建、数据清理范围、显式执行确认和统一报告见[可靠性测试入口](tools/chaos/README.md)。整理后的运行链尚待用户指令实测，不计入下面的日常验证。

- npm test：本工程游戏测试。
- npm run test:coverage：框架与游戏联合 Core 覆盖率，门槛保持 70/60/75/72。
- npm run test:native：模块 Rust 数据、AOI、战斗与真实 V8 bridge 测试，不跑压测。
- npm run verify：MMORPG 综合回归、客户端静态检查、部署资产及包入口检查，不包含 SLG 全量构建；单包检查用 check -- --package <name>。
- npm run test:runtime：真实隔离联机冒烟。

主工程 codegen 不会自动写这里。SDK 的 source 来自本工程组合产物；publish/check 检查哈希、目标包含关系、目录联接、输出重叠和手写覆盖，保留编辑器 .meta。

Cocos 3D 使用 Creator 3.8.8；二维示例保留 3.8.6。无编辑器类型时只做独立打包，不等于完整编辑器构建。Pixi 使用 build:pixi、serve:pixi。UE、Unity、Godot 的正式编辑器/平台验收独立执行。

服务端模块与 Native 变化要求重建并重启。长稳、真实数据库故障和部署到现有服务不属于上述自动验证。

## 迁移约定

TiangZ-ModuleGame 与 TiangZ-WoW335 用模块根目录联接安装 MMORPG，仅通过公开 API 消费。禁止重建主工程 app/model/mmorpg、app/hotfix/mmorpg、src/game 或 client_demo 的兼容联接。

本仓库和引擎必须一起保存拆分变更；不要只提交引擎的删除项。
