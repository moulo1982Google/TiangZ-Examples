# 本地战斗节点验收（2026-09-16）

## 范围与入口

本轮只验证 SLG 战斗执行节点，不开发副本玩法、不接入 Kubernetes、不修改 Cocos 或现有世界快照。SLG 未来可以有动态副本机制，不能把该机制限定为 MMORPG 专属。

入口：SLG 包目录 `npm run battle:build`、`npm run battle:verify`。源码和说明在 [validation/battle](../validation/battle/README.md)。模块由宿主 `modules:create --with-rust` 创建后扩展，模板基础能力保留。

引擎新增 `tools/local_replica_controller.mjs` 及单测，只有期望数量、上下限、串行启动、失败退避、排空确认与停止回调。SLG 验证脚本提供自身进程创建/停止与排队、空闲策略；该控制器不扫描或停止其他系统进程，不包含游戏规则。

BattleManager 拥有注册、租约及有界任务账本，BattleHost 的薄 TS Handler 交给 Component/System，再调用生成的 NativeOps。Rust 每进程固定一个工作线程和一个在途槽，经有界通道返回摘要；TS 提交和轮询都是短调用，实际计算与验收延迟不占用 V8 线程。不是通用异步 Native 语言语法或生产线程池框架。

## 真实验证结果

最终案例证据：`validation/battle/temp/run-JFmWG2/report.json`，日志同目录。

- 两个独立 BattleHost 进程注册，积压持续触发 2→3。
- 第三个进程就绪注册后参与计算；前 24 场分布到全部三个执行节点，结果与独立 JS 参考计算一致。
- 相同 battleId/输入复用既有任务，改变输入返回 conflict。
- 额外在途任务验证排空：先停止接单，工作完成并确认后才退出，不提前删除进程。
- 连续空闲触发自动缩到两个；排空中的进程仍占容量槽，同时最多三个执行进程。
- 64 个并发准入请求中 32 个进入队列，32 个明确返回 full；无效输入被拒绝。所有已接收任务共 62 个完成并校验结果；拒绝的请求没有任务记录。
- 所有本次进程正常停止后才写成功报告；没有操作数据库或已有游戏进程。

## 工程验证

- 正式 Native/协议 codegen、模块 TS 类型检查、Model/Hotfix 与配置构建、Rust 组合构建通过。协议锁只经正式生成器显式更新。
- 初次联机发现内部连接禁止客户端协议号；按既有边界拆为客户端控制协议与内部节点协议，没有放宽引擎访问检查。保留正式锁中的历史记录，没有手工清理生成锁。
- 通用副本控制器单测 2/2，覆盖串行/有界创建、排空确认、失败退避及关闭时的迟到启动。
- 模块 Rust 单测 2/2；独立 crate 的 Clippy `--all-targets -- -D warnings` 通过。
- Examples `npm run check -- --package slg` 通过，现有模块与客户端检查未受影响。
- 引擎 `npm run verify` 完整矩阵 6/6 通过，其中快速矩阵 31/31；包括真实模块宿主、教学工程、在线 Hotfix、双 Native 模块/发布拒绝及 Rust 脚手架真实运行回归。已有 Windows LNK4098 链接警告仍存在，不宣称零警告。

## 不能据此宣称

这是有界、短时、单机的功能案例，不是常驻生产控制平面。尚未验证杀进程/网络分区、Manager 重启与恢复、任务持久幂等结算、多控制器选主、长期容量与资源泄漏、跨机器部署或 Kubernetes。Manager 的内存账本有固定上限，不能长期无限运行；超时只标 unknown，不能据此安全重算或发奖。

未修改 DBProxy、未操作已有容器/数据库、未启动长稳或大规模压测、未发布/提交/推送，也没有接入 Kubernetes。
