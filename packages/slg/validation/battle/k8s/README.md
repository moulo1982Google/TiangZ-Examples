# 第一个 Kubernetes 战斗服练习

后续已增加平台无关自动交付入口，并在独立命名空间完成新版单制品的构建→部署→验收→清理，见 [交付与换机接续](../../../docs/delivery-handoff.md)。下文早期镜像记录保留作历史证据；双版本制品共存仍未实测。

目标：一个 BattleManager、两个 BattleHost，扩到三个，让三个节点都执行 TS Handler → Rust 后台计算，再排空第三个节点并缩回两个。不是正式 SLG 战斗，也不是生产调度系统。

2026-09-16 已完成两轮真实集群验证，含清理后重新启动；结果与限制见 [验收记录](../../../docs/battle-k8s-minimal-20260916.md)。

上述报告对应版本路由改动前的镜像。当前源码新增 realmId 与逻辑/配置版本，SDK 及进程必须配套重建；不会自动升级已运行的练习。发布模型为公共战斗入口、区服不绑定池，见 [发布与调度](../../../docs/battle-release-routing.md)。本轮版本路由的真实验收在本地进程进行，不将旧集群报告算作新版验收。

## 从哪里开始

以下命令在 `TiangZ-Examples/packages/slg` 执行，Windows 可用 `npm.cmd`。

```powershell
# 已有本地战斗案例时可跳过；首次用于生成并锁定 Native 组合依赖。
npm.cmd run battle:build

# 下载并校验 kind，只在本工程 temp 保存工具和 kubeconfig。
npm.cmd run battle:k8s:setup

# Linux 镜像首次构建较慢；先完成集群准备，再构建镜像。
npm.cmd run battle:k8s:image

# 新建独立实验命名空间，运行一个管理器、两个执行节点。
npm.cmd run battle:k8s -- up
npm.cmd run battle:k8s -- status

# 在全新实验中验证 2→3→2、三个节点真实计算和在途排空。
npm.cmd run battle:k8s -- verify
```

`verify` 不是压测：共 48 个有限任务，包含受控的 250ms 测试延迟。逐个对照独立 JS 参考算法检查 Rust 结果，检查无未知结果、无容器重启、第三节点正常退出。成功证据在 `validation/battle/temp/tiangz-battle-<编号>-report.json`，退出日志单独保存；失败时保留 Pod/Event 快照，不自动删除现场。

手动体验：

```powershell
npm.cmd run battle:k8s -- scale 3
npm.cmd run battle:k8s -- status
npm.cmd run battle:k8s -- scale 2
```

不要用裸 `kubectl scale` 代替受控缩容：本入口先通过生成的 BattleClient 请求指定节点排空，确认结果已交给管理器，再修改 StatefulSet 副本数。Pod 的 preStop 再做一次确认，随后容器入口将 SIGTERM 转成 TiangZ 的 stdin shutdown。排空失败不会由本入口发出缩容命令；K8s 自己触发的删除仍有 30 秒强制终止上限，不提供无限等待保证。

练完退出：

```powershell
npm.cmd run battle:k8s -- down
```

`down` 只删除它记录且拥有正确标签的实验命名空间，先停 worker 再停 manager。存在排队、运行或未知结果时拒绝清理，避免掩盖任务丢失。它不会删除 kind 集群、镜像或缓存，不动 DBProxy/Redis/PostgreSQL。再次 `up` 获得全新账本；`verify` 拒绝在已消费任务的账本上重复运行。

## 文件怎么看

| 手写文件 | 用途 |
|---|---|
| kind.yaml、setup.mjs | 创建独立单机 K8s，安装工具不改系统 PATH/默认 kubeconfig |
| Dockerfile、image.mjs、export-binary.mjs、cargo-config.toml | 制作当前源码对应的 Linux 镜像；复用正式 Native 组合构建器、依赖锁与指纹校验 |
| manifest.mjs | 管理器 Deployment、执行节点 StatefulSet、内网 Service、资源额度和探针 |
| config.mjs、entry.mjs | 将 Pod 地址/编号转换成 TiangZ 配置，启动进程并处理退出信号 |
| drain.mjs | preStop 使用生成 SDK 请求排空，不直接改游戏状态 |
| lab.mjs | 部署、状态、受控扩缩容、48 个任务验收和限定清理 |
| lab.test.mjs | 配置、隔离边界和错误输入的快速检查 |

`temp/` 下的连接配置、镜像上下文、部署 JSON、报告和日志都是生成物，不手改。`modules/battle/generated`、Model 中 generated、Rust 中 generated 仍由正式生成器维护。

## 为什么用 StatefulSet

本练习需要明确选中 `battle-worker-2` 排空。StatefulSet 的编号与逆序缩容便于验证这个关系；不挂持久卷，也不意味着战斗状态能恢复。业务注册名还包含 Pod UID，重建 Pod 不悄悄继承旧 Pod 的任务。管理器只运行一个副本，不能复制成多个实例冒充高可用。

## 隔离和限制

- kind 集群固定名 `tiangz-battle-lab`，每次 up 创建随机独立命名空间；所有 kubectl 调用显式携带本地 kubeconfig/context。
- 没有 Ingress、NodePort、LoadBalancer 或公网游戏入口。临时 port-forward 只绑定 127.0.0.1，用完关闭。
- Pod 不挂集群访问令牌，以非 root 身份运行；这是可信本地实验，不是多租户安全隔离。kind 默认网络不提供本案例的身份认证/网络策略保护，不能加入不可信工作负载。
- 注册 IP 只接受回环和 RFC1918 IPv4；该限制不等于鉴权。IPv6、生产证书、跨机发现和认证不在本轮。
- 本地号段身份为临时开发模式，没有数据库记录；Pod 编号不应直接作为正式持久 ID 的唯一防重方案。
- Linux 构建复用本地集成分支的 DBProxy SDK 源码，只读打包必要源码；不启动 DBProxy，也不复制数据库密钥。仍不是正式发布依赖方案。
- 当前队列、任务和结果都在内存，有界保留；不处理管理器重启恢复、宕机重投、幂等持久结算或长稳/容量验收。
- readiness 只表示进程已启动；验收还会等待管理器确认注册。不配置用来冒充业务恢复的激进 liveness 重启。
- 这里只验证手动扩缩容，没有 HPA、指标适配器或云服务器扩容。
- 首次解包可能使 kind 初始化超时。配置延长了 kubeadm 初始化等待，但未关闭健康检查/etcd 持久性。失败先看日志，不重启整个 Docker、不清理现有数据服务。

官方参考：[kind 安装与独立 kubeconfig](https://kind.sigs.k8s.io/docs/user/quick-start/)、[StatefulSet](https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/)、[容器生命周期钩子](https://kubernetes.io/docs/concepts/containers/container-lifecycle-hooks/)。
