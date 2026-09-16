# Kubernetes 战斗服最小练习验收（2026-09-16）

## 结论

真实 kind 集群中两轮通过 **一个管理器、执行节点 2→3→2**：每轮 48 个任务的 Rust 结果全部与独立 JS 参考算法一致，三个执行 Pod 都实际参与计算。排空首次返回 idle=false，待在途结果交回后才修改副本数；被缩掉节点的日志记录 `runtime exit code=0 signal=null`。无未知任务，保留的游戏容器重启次数为 0。

这不是 HPA 自动扩缩容、正式战斗玩法、生产高可用或持久结算验收。

## 当前可查看的环境

- kind `v0.33.0`，Kubernetes `v1.37.0`，Docker Desktop Linux/amd64。
- 集群：`tiangz-battle-lab`，单台本地节点。
- 当前实验命名空间：`tiangz-battle-b8be0887`，一个管理器、两个执行 Pod 保留运行。
- 镜像：`tiangz-battle-lab:k8s-image-dlketk`，本地构建/载入，未推送远端。
- 连接配置：`validation/battle/temp/k8s-tools/kubeconfig`；默认 kubeconfig/context 未修改。
- DBProxy、PostgreSQL、Redis 原有三个容器未重启、未改配置、未访问游戏数据。

在 SLG 包目录运行 `npm.cmd run battle:k8s -- status` 查看。手动体验 `scale 3` / `scale 2`；结束用 `down`。完整命令与文件导航见 [练习说明](../validation/battle/k8s/README.md)。

## 实际执行的验证

| 验证 | 结果 |
|---|---|
| 正式协议生成 | Register 追加一个 IPv4 字段，显式更新 schema lock；未手改 SDK/消息码 |
| 本地 battle:build / battle:verify | 通过；62 个结果正确，32 次容量拒绝，原本地扩缩容保留 |
| Linux Docker 镜像构建 | 通过；正式 Native 组合构建器，Cargo --locked，Native/二进制指纹校验 |
| battle:k8s:setup | 已实际下载并校验 kind；独立集群 Ready；最终入口检查 CoreDNS rollout |
| battle:k8s -- verify 第一轮 | 48 个结果正确，三个节点参与，主动排空后缩容，正常退出 |
| battle:k8s -- down | 先停止执行节点、再删除第一轮自有命名空间；报告保留 |
| 修正后的 battle:k8s -- up / verify 第二轮 | 完整通过，另一个全新命名空间，48 个结果正确 |
| battle:k8s:test | 4/4：Pod 配置、非法输入、部署边界、注册地址/身份不可替换 |
| TiangZ npm run verify | full 6/6、内含 quick 31/31 通过 |
| SLG npm run check | 通过，世界快照/Cocos 检查流程未被战斗案例替换 |

Windows 原有 LNK4098 链接警告仍存在，不宣称零警告。Cocos 编辑器画面未启动。

## 证据（Git 忽略的本地生成物）

- 本地进程：`validation/battle/temp/run-7rikOU/report.json`。
- 第一轮：`validation/battle/temp/tiangz-battle-c52e12b0-report.json`、同前缀 `worker-2.log`。其命名空间已清理，内存测试账本不保留；可重新 up 建立全新实验。
- 第二轮：`validation/battle/temp/tiangz-battle-b8be0887-report.json`、同前缀 `worker-2.log`。
- `validation/battle/temp/k8s-state.json` 记录当前实验；以后重新 up 会变化，不把本报告中的编号当作固定配置。
- 镜像构建上下文：`validation/battle/temp/k8s-image-DLKetK`。

## 本轮发现并处理的问题

1. 旧本地注册把所有 Host 地址写死成 127.0.0.1。现在通过模块内部协议上报部署地址，限制可信实验网 IPv4；同名节点地址/端口变化拒绝。没有放宽内部 RPC 与客户端协议的传输边界。
2. Linux 初次构建缺失当前工作区使用的 DBProxy SDK 本地依赖补丁，--locked 正确拒绝。实验构建现在只读带入相同 SDK 源码和显式补丁，仍使用锁与组合身份校验；没有通过移除 --locked 规避。
3. kind 首次初始化出现镜像解包/容器创建超时，延长 kubeadm 等待后仍曾遇到 etcd API 超时。镜像打包完成后单独重建最终成功。已保存两组失败日志；没有关闭健康检查、etcd fsync，也没有重启整个 Docker。原因尚未做独立磁盘基准确认，不能断言完全由并行构建造成。
4. OnDelete StatefulSet 不支持 `kubectl rollout status`。入口改为检查明确的目标 Pod 数量及 Ready，第二次完整 up 已验证修复。

## 未验证和后续边界

- 没有 HPA/自定义指标适配器、自动增加云机器或跨机器网络验收。
- 没有杀 Pod/杀节点、管理器重启、网络分区、持久恢复、幂等结算或故障自动重投。
- 没有长稳/容量测试；250ms 是有限测试延迟，不是战斗吞吐指标。
- preStop 已配置并作为受控缩容的补充；裸 kubectl 缩容、驱逐、强制终止路径没有独立故障验收。钩子超时不能阻止 K8s 最终强制结束。
- 只在可信本地集群使用，无生产身份认证/网络隔离承诺。注册私网地址校验不能替代鉴权。
- Native Rust 源码未增加新的战斗规则；本轮主要是 Examples 容器部署适配、模块注册协议和教学入口。TiangZ 主工程仅同步文档，不增加 K8s 或战斗专用 Core API。
- 未修改 Developer Tools 插件，未提交或推送代码，未执行正式发布。
