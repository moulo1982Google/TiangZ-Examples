# 本地战斗执行节点验证

这是 SLG 包下隔离的框架接入案例，不是已经实现的 SLG 战斗玩法。由 `modules:create --with-rust` 生成壳后扩展，不依赖 MMORPG，不修改 Cocos、世界快照或数据库。

在 SLG 包目录运行：

```powershell
npm run battle:build
npm run battle:test
npm run battle:verify
```

先安装 TiangZ 宿主依赖与 Rust 工具链。build 运行正式生成器、TS 构建和 Rust 组合构建，不启动服务。verify 使用匹配的组合二进制，创建随机端口与临时配置，复制自己的 dist 到独立运行目录；只启动/停止本次进程，不连接现有服务。成功后所有进程退出，证据保留在本目录 temp/run-*。

## 一眼看懂所有者

```text
本地验证脚本：排队/空闲策略 → 通用 LocalReplicaController → 本次进程
BattleManager：注册、心跳、容量、任务账本、分配与查询
BattleHost：TS Handler → HostSystem → 生成 NativeOps
Rust：固定单线程计算槽 → 有界结果通道 → TS 非阻塞查询
```

普通 Rust 函数只计算确定性摘要，不回调 TS、不改玩家资产。最多一个在途工作，每场最多 100 万轮，验收延迟最多 250ms；延迟发生在 Rust 工作线程，不阻塞 V8。Manager 每 30ms 查询进度，Worker 每 100ms 注册/续租；这些是便于观察的测试参数，不是生产推荐值。

## 文件导航

- `modules/battle/tiangz.module.json`：模块、协议和 Rust 声明。
- `src/model/BattleState.ts`：两种 Scene、Component 状态与方法形状。
- `src/model/BattleRelease.ts`：随制品固定的逻辑/配置版本，注册和执行校验共用；不允许环境变量改名冒充。
- `src/hotfix/ManagerSystem.ts`：任务选择、原分配查询、容量和排空。
- `src/hotfix/HostSystem.ts`：心跳、原生提交和非阻塞结果读取。
- `src/hotfix/handlers/`：每个文件一个薄 RPC Handler。
- `proto/Battle_C_42000.proto`：本机测试控制入口；`Battle_S_24000.proto`：内部注册/执行/查询/排空。内部协议不走客户端连接。
- `native/Example.native`、`rust/src/native_data.rs`：手写接口与线程/算法；保留脚手架原有 Add 示例。
- `generated/`、`src/model/generated/`、`rust/src/generated/`：正式工具生成，不手改。
- `run.mjs`、`client.ts`：隔离进程、自动扩容/空闲缩容策略及真实 SDK 验收，不是常驻生产控制平面。

通用控制器在 TiangZ/tools/local_replica_controller.mjs；不包含战斗术语，只认识期望数量、上限、启动、排空确认和停止。回调只能管理自己创建的资源，不扫描系统进程。一次只改变一个副本，启动串行，失败退避，数量有上限，排空中的进程仍占槽。

## 验证内容

1. 两个真实执行进程完成注册；积压持续后目标变为三个。
2. 第三个进程就绪注册后开始执行，三者均返回正确 Rust 结果。
3. 同一 realmId 内重复 battleId 且相同输入/版本复用原任务；改变输入或版本返回 conflict，不多算一场。
4. 在途节点先停止接单，确认本地任务结束后才停止进程。
5. 连续空闲触发目标回到两个；总数不超过三个。
6. 通用控制器单测覆盖重复 reconcile、上限、排空确认、启动失败退避与关闭期间迟到启动。
7. 64 个额外并发请求验证排队上限 32，满载返回 full；已接收请求全部完成并比对结果，拒绝请求不创建账本记录。
8. 两区同号战斗各自得到正确结果，不绑定战斗池；无兼容逻辑/配置版本返回 unavailable 且不入队，旧请求缺少身份或版本返回 invalid。

发布关系、版本语义和维护边界见 [战斗发布与调度](../../docs/battle-release-routing.md)。`battle:test` 还覆盖混合版本精准调度、执行端二次校验和失去兼容节点不降级；混合版本传输为模拟，不等于两份真实制品部署验收。

## 明确没有实现

- Manager/Worker 账本只在本次运行内有效：Manager 最多 128 个任务、32 个排队任务、16 条节点记录；Worker 最多保留 128 条回执，不自动驱逐幂等记录。不是无限运行的服务。
- 失联/执行超时只标为 unknown 并停止向原节点派单，不直接重新分配；尚未验证杀进程故障、Manager 重启、持久恢复或跨节点重算。
- 没有玩家结算、奖励、战报持久化，也不声称 exactly-once。未来结算必须由权威业务所有者持久幂等处理。
- 本地进程入口仅绑定回环，禁止直接公开；容器适配另见下方 K8s 练习。没有生产鉴权、租户隔离、真实多机验收、多控制器选主或长期容量指标。
- Rust/Native/Model 改动须重新完整构建并重启；不是 Rust 热更新或自动监听。

以后 SLG 也可以有动态副本。本轮只验证战斗执行节点；副本的空闲、玩家迁移和恢复策略需由拥有副本机制的游戏模块提供，不能写死为 MMORPG 专属或战斗通用规则。

## Kubernetes 最小练习

本地流程之后进入 [K8s 战斗服练习](k8s/README.md)：独立 kind 集群、Linux 镜像、2→3→2 受控扩缩容。具体实际验收状态见练习报告；不代表生产自动扩容或故障恢复。
