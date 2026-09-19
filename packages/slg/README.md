# TiangZ SLG

玩家驻留默认 5 分钟、切前台快照恢复、独立操作回执及离线任务已接入，配置与复测入口见 [驻留和前台恢复](docs/player-residency-and-foreground.md)。仍是单世界无鉴权 Demo，不是正式登录系统。

Examples 中的独立示例包：TiangZ 扩展模块 + Cocos Creator 3.8.8 TypeScript 前端。服务端、客户端和输出都留在本包，不依赖 MMORPG。

从 Examples 根目录可执行 `npm run build -- --package slg`、`npm run check -- --package slg`、`npm run smoke -- --package slg`；以下不带包名的命令均在本目录运行。旧 TiangZ-SLG 目录已迁入这里，Creator 需重新打开本目录下的 client/cocos，VS Code 工作区使用本目录的 TiangZ-SLG.code-workspace。

当前已有**基础玩法 Demo**：建筑升级、每分钟 100 粮食、抽武将与升级、派兵占领中立地块。通过真实 WebSocket 和生成 SDK 调用；玩家与世界分记录，接入 DBProxy 原子提交。玩法规则、代码导读、复测步骤及未验证边界见 [基础玩法说明](docs/gameplay-demo.md)。不是完整游戏，尚无账号鉴权或独立 PlayerHost。

## 立即开始

在本目录打开终端（Windows PowerShell 若拦截 npm.ps1，使用 npm.cmd）：

```powershell
npm.cmd run setup
npm.cmd run dbproxy:up
npm.cmd run build
npm.cmd run dev
```

首次运行 `setup/dbproxy:up/build`；之后日常只需 `dev`。`setup` 生成已有协议的 TypeScript SDK、同步 Cocos 副本和编辑器路径，随后检查；不会分配新协议号，也不再生成 Godot SDK。`dev` 校验宿主版本、模块类型和协议产物，再构建服务端到本工程 `dist/` 并启动；不调用 Cargo，不检查整个前端，不同步 SDK。协议或编辑器路径过期时先运行 `setup`，新增协议仍需显式 `protocol:update`。修改 Rust/Native、升级宿主或首次启动必须运行完整 `build`；宿主版本检查不替代同版本源码重建。输入 `shutdown` 回车停止。当前 dev **不是文件监听或自动热更模式**；改代码后停止并重新运行。

另开终端运行下列命令，会从 Dashboard 的已安装列表定位 Creator 3.8.8；自定义位置可通过 `COCOS_CREATOR` 指定：

```powershell
npm.cmd run client:open
```

也可以直接在 Creator 中导入 `client/cocos`。打开 `assets/scenes/Main.scene`，点击预览。画面连接 `127.0.0.1:18001`；上方升级建筑、选择武将，下方抽卡/升级/征兵，点击资源地块后出征。界面显示粮食、士兵和存储模式。本轮新增 UI 尚未实际预览验收，类型与打包检查不能代替画面验收。

注意：手机客户端看到的 `127.0.0.1` 是手机自身。本机开发默认只监听回环；暂未开放远程游戏访问。

## 常用命令

下一轮以SLG验收默认PG读取、驻留/冷恢复和故障后的资产一致性：[SLG权威读取验收计划](docs/authoritative-read-acceptance.md)。文档区分现有7项强杀脚本与待补的新用例，目前不是一键全覆盖，也尚未执行联合验收。

真实存储的小规模游戏强杀恢复测试见 [恢复测试说明](docs/recovery-test.md)，`npm run test:recovery` 默认仅计划。运行需明确授权，只操作新建隔离环境，不动当前开发库。

本地到 CI 的交付入口与换机接续：[交付脚本与换机指南](docs/delivery-handoff.md)。先用 `npm run delivery -- check`，真实进程用 `local`，隔离容器用 `container`；加 `--plan` 只看步骤。

战斗服务采用公共入口、区服不绑定池，按逻辑与配置版本调度；发布拓扑和当前实现边界见 [战斗发布与调度](docs/battle-release-routing.md)。`npm run battle:test` 是不启动服务的快速回归入口。

容器部署学习入口：[Kubernetes 战斗服最小练习](validation/battle/k8s/README.md)。它与世界快照和 Cocos 流程隔离，不连接既有数据库。

独立战斗节点案例使用 `npm run battle:build` / `npm run battle:verify`，见 [本地战斗验证](validation/battle/README.md)。验证管理节点、TS→Rust 后台计算、2→3 扩容和排空/空闲缩容；不修改下方世界快照流程，不连接数据库，也不是完整 SLG 战斗或生产调度系统。

日常记住 `dev`（服务端开发）和 `client:open`（打开前端）即可。提交前运行 `check` 和 `smoke`；`client:build/preview`、`dbproxy:smoke` 是按需验收，不是每次启动的前置步骤。

| 命令 | 用途 |
|---|---|
| `npm run realm:plan` | 读取目录、请求和模块策略，输出只读合服计划，不执行迁移 |
| `npm run test:realm-plan` | 校验 SLG 策略声明及只读规划入口，不启动游戏或数据库 |
| `npm run check` | 检查模块、协议产物、SDK 一致性、连接层 TS 和 Cocos 打包；不修复源码或锁 |
| `npm run build` | 完整生成、检查并构建，不启动 |
| `npm start` | 检查后启动上次构建；改源码请用 dev/build |
| `npm run test:gameplay` | 29 条规则、模拟持久事务和前台恢复测试，不启动数据库 |
| `npm run smoke` | 临时目录、随机端口、不连接数据库，真实 RPC 验证地图、升级、抽卡和行军占领并正常停机；需先 build |
| `npm run protocol:update` | **显式**分配/更新模块协议锁，并生成 SDK；审查 Proto 和锁的 diff 后提交 |
| `npm run client:build` | 调用本机 Creator 构建 Web Desktop |
| `npm run client:preview` | 本机预览已构建客户端：127.0.0.1:19080 |
| `npm run dbproxy:up` | 构建并启动 SLG 独立 DBProxy/PG/Redis，首次自动生成本地密钥 |
| `npm run dbproxy:check` | 检查 DBProxy 与数据库依赖就绪状态 |
| `npm run dbproxy:smoke` | 在独立库中通过 SDK 验证写入、版本迁移、第二进程读取与旧版本拒绝 |
| `npm run dbproxy:stop` | 仅停止 SLG 数据服务，保留数据卷 |

默认宿主为本包相对路径 `../../../TiangZ`（与 Examples 同级），可用 `TIANGZ_ENGINE_ROOT` 指定其他兼容宿主；切换后运行 setup/build。依赖使用宿主固定的 TypeScript/esbuild，无须给游戏再次安装一套。要求 Node.js 24.x，宿主依赖已安装、Rust toolchain 可用。

## 代码从哪里写

```text
modules/slg/proto/                  协议唯一来源，锁文件提交版本管理
modules/slg/src/model/              稳定类型与状态；变化后重建重启
modules/slg/src/hotfix/             System 行为和薄 Handler；显式入口
client/cocos/assets/scripts/        Cocos UI 与引擎无关连接
client/cocos/assets/scenes/         可直接打开的主场景
configs/dev/                       独立部署配置（18001 / 健康端口 18600）
tools/                             一套开发命令，不在模块发现时自动执行
docs/                              架构边界、开发流程与验收说明
```

`generated/`、`Generated/` 和 `dist/` 是可重建产物，不手改。SDK 同步保留 Cocos meta；日常检查发现过期会要求 setup，不会暗中修复。当前同步不是多进程事务，请串行运行生成/构建命令。

## 当前限制

2026-09-17：DBProxy配置将`slg.demo.player.v1`和`slg.demo.world.v1`设为权威PG读取，避免恢复被旧缓存/负缓存误导。启用前须重新构建DBProxy镜像；旧二进制会拒绝新字段。本次没有重启现有开发容器。当前驻留命中不再逐请求Load，冷加载和启动任务索引恢复仍受存储成本影响；不能把32玩家Demo当正式SLG登录容量模型。详见[权威读取与验收边界](../../../TiangZ-DBProxy/docs/authoritative-recovery-reads.md)及[驻留实现](docs/player-residency-and-foreground.md)。

分服/合服规划使用 `npm run realm:plan`：两个逻辑服合入新世界，地块重新争夺，不导入旧占领。此命令只读、不启动进程、不改库；只有带指纹和前置条件的计划，不具备正式合服执行能力。

这里是 SLG 的设计声明，不是已完成的合服 Demo。三份手写输入分别是 configs/realms/catalog.example.json（有哪些服）、merge.example.json（这次合哪些服）、modules/slg/policies/realm-merge.json（SLG 如何处理数据）。输出 JSON 是生成的计划，不手改。通用宿主只校验并呈现策略，不决定地块重建，也不执行策略。

宿主基线为 `0.6.0-alpha.0`，模块仍独立编号为 `0.1.0`，宿主范围 `[0.6.0-alpha.0, 0.7.0)` 不代表未来版本已验收。新增 Model 值需要导出并登记 modelExports；模块增删、manifest 或 Model 修改后重建游戏制品并重启。协议源和锁一起审查提交，已有行为修改不更新协议锁。

当前使用纯模块宿主，构建清单仅包含 org.tiangz.slg，不混入 MMORPG 或 Bench。

- 没有账号鉴权，开发玩家名由客户端提供；不应开放公网。当前固定 realm-41，最多 32 个玩家，不支持同玩家多标签并发操作。
- 地点与玩法数值暂在 Hotfix，尚未接模块 Luban 表。玩家/世界事务存档的小规模真实存储强杀结果见 docs/recovery-test.md，不代表DBProxy自身故障或长稳已验收。
- 没有独立 PlayerHost、地图分区、跨区行军或 Rust 战斗服务持久结算；建筑等级暂不增加产量。详见 docs/gameplay-demo.md。
- 未安装/导入 Creator 时，check 只验证连接层类型和前端打包，不等同于 Cocos API 完整类型检查或画面验收。
- 首次 Rust 冷构建可能较慢；后续 Rust 未改时复用缓存，游戏产物不写入宿主 dist。

Creator 命令与构建退出码依据：[官方命令行发布说明](https://docs.cocos.com/creator/3.8/manual/en/editor/publish/publish-in-command-line)。

默认PG读取的A/B/C/D隔离夹具现已提供：`npm.cmd run test:acceptance`只输出计划，`npm.cmd run test:acceptance-tools`检查工具；完整构建与经授权执行方法见[权威读取验收计划](docs/authoritative-read-acceptance.md)。夹具就绪不等于实库验收通过。

### SLG热更与30分钟关键路径 / SLG hotfix and 30-minute profile

查看计划：`npm run test:acceptance -- plan --profile smoke30`。独立构建热更夹具：`npm run test:acceptance -- build-hotfix`；纯工具检查：`npm run test:acceptance-tools`。默认不启动服务。覆盖、缺项、完整构建和授权运行命令见[权威恢复验收](docs/authoritative-read-acceptance.md#hj夹具实施与30分钟入口2026-09-17)。此profile为3玩家关键路径，不代表500玩家或完整三轮验收。

完整单轮计划：`npm run test:acceptance -- plan --profile acceptance90`。42项目、3玩家、90分钟预算上限，B组恢复后各观察3分钟，H8同进程观察约16～18分钟；完成即结束。构建和纯工具检查不代表真实故障验收通过。

八小时功能长稳入口为`npm run test:soak -- --profile soak8h --confirm isolated-slg-authoritative-test --hj-reports "<report1.json>,<report2.json>"`，启动前要求全部H/J通过证据，并先执行`--profile smoke5`自检。每5分钟写入`temp/authoritative-acceptance/soak8h-*/report.json`与`observations.jsonl`；创建该目录下的`STOP`文件可协作停止。固定3名角色，具体负载、故障时间表和通过门槛见[八小时计划](docs/authoritative-read-acceptance.md#八小时功能长稳--eight-hour-functional-endurance)。
