# 交付脚本与换机接续指南

这份文档是本地开发和未来自建 Git CI/CD 的共同入口。先让本地脚本可靠运行，再让 Runner 调用相同命令；不依赖某一家 Git 平台。

## 我们已经决定了什么

- 目标是完善 TiangZ 模块开发和交付体验，SLG 是验证案例，不是已经完成的游戏。
- 登录服务独立部署；区服各自拥有 Gate、世界、玩家服务及副本管理。战斗服务独立部署，区服不绑定战斗池，统一入口按逻辑版本与配置版本选择节点。
- TS Handler 委托 Rust 后台计算。同版本战斗节点扩缩容不停，版本更新允许维护。
- 当前只有有界内存战斗账本和计算夹具，没有生产鉴权、管理器恢复、持久结算、全自动维护发布、HPA 或生产回滚保证。
- 业务留在 Examples 模块；宿主提供构建和检查；插件只负责入口与呈现；DBProxy 不拥有游戏规则。

详细边界见 [战斗发布与调度](battle-release-routing.md)、[本地案例](../validation/battle/README.md)、[K8s 练习](../validation/battle/k8s/README.md)。历史验证报告不代表换机或新版镜像已通过。

## 换工作机器：先准备什么

保留同级目录布局，可以放在任何磁盘，不要复制旧机器的绝对路径配置：

```text
工作目录/
├─ TiangZ/                 引擎仓库
├─ TiangZ-DBProxy/         SDK 本地依赖的源码仓库
└─ TiangZ-Examples/        示例仓库
   └─ packages/slg/        在这里执行本文命令
```

**搬机器前先保存并审查三个仓库的改动。** 当前 Examples 存在大量尚未提交的源码，只 clone 远端可能拿不到本次实现。本文没有替你提交或推送。逐仓库查看 `git status --short`，把应当携带的手写源码、协议锁、依赖锁、文档和正式生成物按仓库规则提交；不要盲目 `git add .` 上传凭据。

若暂不使用远端，也可安全备份完整源码与未提交修改；这只适合本地恢复，不是干净 CI 源码基线。三个仓库的提交组合应一起记录，不能各自随便取 latest。

需要安装：

| 工具 | 用途 |
|---|---|
| Git、Node.js 24.x | 获取源码，执行脚本与 TS 工具 |
| Rust/rustup | 使用 TiangZ/rust-toolchain.toml 固定工具链（当前 1.97.1） |
| Windows：VS2022 C++ 构建工具、Windows SDK、CMake/Clang | 本地 Rust Native 组合构建；VSCode 插件不能替代编译器 |
| Linux：C/C++ 编译器、CMake、Clang/libclang | Linux Runner 原生构建；系统依赖按镜像/发行版准备 |
| Docker Linux 容器、kubectl、curl | 仅容器验收需要；kind 由工程脚本下载并校验 |

本轮不是 Cocos 画面或数据库验收，不需要启动 DBProxy/PostgreSQL/Redis。DBProxy 源码仍被本地 SDK patch 和 Linux 镜像构建使用，不能遗漏。不要迁移旧机器的 node_modules、target、dist、temp、目录联接、kubeconfig 或 Docker 凭据；在新机器重建。原开发数据库若要搬迁，应另行制定数据备份方案。

首次准备：

```powershell
# 在工作目录执行；Windows 使用 npm.cmd，Linux 使用 npm。
cd TiangZ
npm.cmd ci
cd ../TiangZ-Examples/packages/slg
npm.cmd run battle:build
npm.cmd run delivery -- local
```

`battle:build` 准备本机编辑器路径，运行正式生成器并建立 Native 组合依赖锁；不会静默更新协议锁。若 schema 锁不匹配，先核对是否拿错提交，不要为通过 CI 自动执行 update-locks。

模块首次在另一台机器准备后可能出现路径/生成变化，应检查原因再建立干净 CI 基线。当前发布依赖尚有本地 SDK patch、首次组合锁解析和浮动基础镜像标签，因此不能宣称位级可复现发布。

## 三个执行入口

所有命令均在 `TiangZ-Examples/packages/slg` 执行。

```powershell
# 只打印步骤，不写报告、不调用工具、不启动服务
npm.cmd run delivery -- container --plan

# 不启动服务：战斗/流水线单测、协议产物一致性、模块类型检查
npm.cmd run delivery -- check

# 上述检查 + 完整构建 + 真实多进程/Rust/排空验收
npm.cmd run delivery -- local

# 首次显式准备独立 kind 集群；不在每次流水线中隐式安装
npm.cmd run battle:k8s:setup

# 上述本地闭环 + Linux 镜像 + 隔离部署 + 48 场容器验收 + 成功后清理
npm.cmd run delivery -- container
```

容器流程只使用本工程 `validation/battle/temp/k8s-tools/kubeconfig` 和 `kind-tiangz-battle-lab`，不读取默认集群。不接受生产目标参数，不推送镜像仓库。镜像首次构建耗时较长，预留 Docker 内存与磁盘。

每轮新建 `validation/battle/temp/delivery-<随机编号>/`，其中包含：

- `report.json`：总状态、每步开始/结束/失败信息、工具平台信息，以及三个仓库的提交和 dirty 状态摘要。
- `<步骤>.log`：子命令完整输出，失败先看这一份；不会把所有环境变量写入报告。
- `local-acceptance.json`：本轮真实进程验收结果。
- 容器流程另有 `artifact.json`、`k8s-image.json`、`k8s-state.json`、Pod/事件及验收报告。

容器制品记录随机唯一标签、Docker inspect 返回的本地 image ID、模块图和配套客户端摘要；部署前重新检查 image ID/客户端摘要。这不是已推送远端仓库的发布凭证。部署复用这份镜像，不重编译。镜像上下文与客户端由原 image 脚本保存，`artifact.json` 中的路径只对本机有效。

**这一版整条流程必须在同一台 Runner、同一工作目录执行。** 不能把 artifact.json 单独拷到另一台机器就部署；跨 Runner 交付还需接镜像仓库、registry digest 和配套测试客户端归档。

## 失败如何处理

失败退出码非零，后续步骤不执行。只有验收成功后才清理自己的实验命名空间；失败不在 finally 自动删现场，防止掩盖未知战斗结果。kind 集群、镜像和构建缓存保留；原手动练习状态目录及数据库不受影响。

检查某一轮保留的容器现场（将 `<本轮目录>` 换成报告所在绝对目录）：

```powershell
$env:BATTLE_LAB_STATE_DIR = '<本轮目录>'
npm.cmd run battle:k8s -- status
# 核对现场且没有排队/在途/未知任务后，才主动清理
npm.cmd run battle:k8s -- down
Remove-Item Env:BATTLE_LAB_STATE_DIR
```

如果部署在写入状态前失败，没有 k8s-state.json，则无需做 down。down 检查所有权标签和待处理任务，拒绝时先处理原因，不用强删绕过。

`delivery.lock` 防止两条流水线并发覆盖生成物；运行流水线时也不要另开手动 build/codegen。CI 平台应设置同一工作区并发数为 1，尤其不能多 Runner 共用同一 Cargo/生成工作目录而没有调度限制。

机器断电或 Runner 被强杀可能留下锁和进程。先确认该轮父子进程确实退出、查看报告/日志和集群状态，再手动移除对应零字节锁；不要删除整个 temp 或结束所有 TiangZ/Docker 进程。尚未实现强杀后自动恢复。报告停在 running 或缺失不算成功。

## 自建 Git 后怎么接

平台只需要完成这些接线：

1. 按明确的三个提交检出上述同级目录；Git 地址由你自己的平台提供。
2. 准备带 Node/Rust/C++ 工具链的专用 Runner；容器验收另需 Docker、kubectl 和预先准备的 kind。
3. 首次环境准备与生成一致性审查完成后，使用干净源码调用 `node tools/delivery/pipeline.mjs local --ci` 或 `container --ci`。
4. 任何一步非零就判失败；无论成功失败，收集本轮报告和日志。不要上传 kubeconfig、完整 Docker 上下文或本地密钥。
5. 先接可信分支/人工触发的测试环境。生产凭据不授予普通 PR，也不在具有 Docker 权限的共享敏感主机上执行不可信 PR。

`--ci` 要求三个仓库都有提交且工作区干净；本地模式允许 dirty，但报告明确标记，不允许把这种记录作为正式发布证据。报告不是签名或供应链证明，状态摘要也不是完整未提交源码备份。

建议平台任务的核心只有：

```text
检出锁定的三仓库提交
准备构建环境（与业务发布分开）
cd TiangZ-Examples/packages/slg
node tools/delivery/pipeline.mjs local --ci
始终收集 delivery-*/report.json 与 *.log
```

现有 TiangZ `.github/workflows/starter.yml` 是基础 Starter CI，不是本条 SLG 多仓库/容器流水线；没有擅自替换它，也没有假装自建 Git 平台已上线。

## 给下一台机器上的协作者 / AI

可以直接转交下面这段：

> 先读 Examples/packages/slg/docs/delivery-handoff.md，以及三个相关仓库的协作说明和 git status。我们的目标是完善模块开发与交付，不是扩展 SLG 玩法。公共登录、独立区服、独立战斗服务，区服不绑定战斗池，按逻辑/配置版本调度。同版本战斗节点扩缩容不停，版本更新可维护。先准备同级三仓库与本机工具，运行 delivery --plan，再跑 check/local；容器验收只用隔离本地 kind。检查最新报告再判断完成程度，不把历史通过当成本机验收。不要改 Core 玩法特例、不要复制凭据、不要操作现有数据库或生产集群。后续接线是自建 Git Runner、镜像仓库、审批；认证、持久任务恢复、双版本制品共存和正式维护回滚仍待实现。

## 当前验收边界

2026-09-16，在 Windows x64 + Docker Desktop Linux 容器环境实际通过：

- 流水线/战斗/K8s 配置测试合计 16/16。
- `--plan` 无执行预览、实际并发锁拒绝和 `--ci` 拒绝当前未提交源码已验证；最终 `delivery -- check` 通过。干净远端检出的 CI 正向实跑仍待自建平台接线。
- `delivery -- local` 完整通过，报告 `validation/battle/temp/delivery-8C5wWK/report.json`。
- `delivery -- container` 完整通过，报告 `validation/battle/temp/delivery-0WIoSt/report.json`：本地 63 场 Rust 计算、容器 48 场结果与排空验收通过。
- 镜像 `tiangz-battle-lab:k8s-image-cxxxok` 构建后原样部署；实验命名空间 `tiangz-battle-852ef26f` 在通过后受控删除，日志与镜像保留。原手动练习 k8s-state.json 摘要前后相同，未接管旧环境。
- TiangZ `verify:quick` 31/31 通过；正式生成器随 build 运行，本次没有协议变更或手工更新协议锁。保留既有 LNK4098 警告。

尚未验证新机器、Linux 原生 Runner、远端 Git 平台、双版本制品共存、生产发布、长稳和故障恢复。不能把本轮同版本容器流水线通过当成这些能力也已完成。
