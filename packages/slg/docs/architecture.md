# SLG 起步边界

2026-09-17 驻留改造：单场景内玩家独立互斥，世界变更单独协调；仅提交受影响记录。默认 5 分钟驻留命中不 Load，方法名截止 Timer 保留离线任务，前台使用快照与独立回执恢复。当前边界、配置和验证见 [实现说明](player-residency-and-foreground.md)，不是独立 PlayerHost 或多拥有者接管。

发布目标：公共登录、独立区服、独立战斗服务。区服不固定绑定战斗池；战斗案例按逻辑/配置版本调度，任务键为 realmId + battleId，执行端再次校验版本。同版本执行节点扩缩容不停，版本更新可维护；这些不代表登录/世界发布业务已经实现。详见 [发布与调度](battle-release-routing.md)。

K8s 部署练习在 validation/battle/k8s，独立于世界快照与 Cocos。用单管理器 Deployment、执行节点 StatefulSet 验证明确目标的排空缩容，不挂持久卷；业务名含 Pod UID，容器 IP 显式注册。数据仍在内存，无高可用、HPA、故障重投或结算。此段扩展下方本地案例的部署方式，实际通过情况见练习报告。

2026-09-16：新增隔离的 validation/battle 案例，用 BattleManager/多个 BattleHost 验证模块 Rust 壳、后台计算和本地扩缩容。通用期望副本控制器属于 TiangZ 工具，战斗协议/账本/算法属于案例模块；当前无持久结算、崩溃恢复或 Kubernetes。动态副本是否用于 SLG 尚未限定，本轮不接入副本业务。

合服设计已确认，但 Demo 合服业务尚未实现：新世界重建、地块重新争夺，旧坐标占领不迁入，角色持久身份不变。规则的手写声明在 modules/slg/policies/realm-merge.json，不在 TiangZ 通用工具内。realm:plan 只输出计划，不执行合服；realmGeneration 是规划中的区服切换代次，不是已经实现的旧世界消息拦截。行军结算、资产、公会、入场政策仍明确列为未决项。

当前只有一个 `SlgWorldScene`，装饰器默认去掉 Scene 后缀，部署配置使用 `sceneType: SlgWorld`。它挂载 SlgGameComponent，协调基础经济和行军；玩家与世界是分开的 DBProxy 记录，用多记录版本比较事务提交，但尚未拆成独立 PlayerHost/World 进程。Handler 只调用领域方法，Model 持有状态，Hotfix 实现规则。当前功能、持久模式与重试约定见 [基础玩法](gameplay-demo.md)。

协议属于 `org.tiangz.slg`；模块 Proto 生成服务端描述符、codec 和自包含 TypeScript SDK，客户端不手写 opcode。Cocos 和自动化 smoke 使用同一个 SlgConnection；每帧/定时泵 update，销毁时 close。

## 后续生产职责拆分（尚未实现）

登录 → 城池 → 派兵 → 行军到达 → 采集 → 返程 → 资源入账。

- PlayerHost：认证后玩家请求、部队可用性、资源与持久化记录的所有者。
- World/Region：地图与行军状态的所有者；不直接修改玩家资源。
- 行军到达通知：携带稳定业务操作号发给玩家所有者，后者幂等处理、持久提交，再反馈前端。
- Scene 是逻辑边界，不必一 Scene 一 OS 进程；先单进程验证职责，再测试跨进程等价语义。
- 重连使用快照恢复当前状态；未来经济事实必须可靠处理，不用 latest 覆盖事件。

开发环境已配置专属 DBProxy/PostgreSQL/Redis，入口为本机 18700，凭据只从 Git 忽略的本地文件注入游戏服务端。基础玩家/行军和世界存档已接入，真实存储下游戏强杀的限定验收见 [恢复测试](recovery-test.md)。无数据库配置的内存模式仅供隔离测试，必须明示；配置后故障不能降级为内存，不复用其他游戏的 namespace、账号和数据库配置。

## 开发体验待办

优先用真实业务需求检验：新协议是否一次生成完成、错误是否直接定位模块、普通业务改动是否不需重复构建 Rust、重启是否一条命令。当前统一入口已完成；文件监听/自动 Hotfix、玩法 Luban 表、独立服务职责拆分与真实恢复验收仍待推进。
