# 三类可靠性测试入口

七日测试发现及下一轮逐组验收要求见[七日问题复测清单](retest-7d-findings.md)。本地审计现要求新版soak独立报告最终状态和运行期一致性；务必重建测试二进制。缓存写超时回归已加入postgres_redis契约组，尚未执行真实故障，不能用随机故障无旧读代替该回归。

2026-09-17代码整理：入口、模块宿主路径、探针SDK解析和报告已整理；**只完成静态检查与控制器纯单测，尚未执行整理后的三套联合验收**。等用户明确指令后再运行，不以历史报告替代本次结果。24小时不在默认计划中。

## 分组和职责

新增显式选择的 `--suite slg`：[SLG小规模恢复](../../packages/slg/docs/recovery-test.md)。三个玩家，独立新建存储，不使用旧prepare清库；保留原game组，all仍只选原三组。先通过小规模正确性，再另行讨论500玩家长稳。

新增显式选择的 `--suite write-modes`：`.native`持久化写法（普通CAS、`@queued`、`@transactional`）长稳，控制器由引擎维护（`../TiangZ/tools/persistence_write_modes_soak.mjs`），本入口只编排，不进入all。控制器自己持有同一把`reliability.lock`；只重建专用PG中的`dbproxy_write_modes_soak`库并清空两只演练Redis的库号5，不触碰其他组的数据。注入PG、可靠Redis、缓存、AOF、首选/全部DBProxy节点、探针进程七类故障，每次故障后要求每个玩家每种写法再确认两次，最后排空排队积压并直接查PG对账。`--seconds`须在900..14400之间，它只约束负载窗口；排队写与其他写法同为250毫秒一次，20玩家实测一整轮约18分钟，控制器保证覆盖完整一轮而不截断；`build`只编译引擎宿主与DBProxy服务端，夹具模块在运行时从当前源码构建。不接触容器的`npm run test:write-modes-smoke`在引擎根目录执行。2026-09-19前两次`run`在可靠Redis故障后因排队写过载失败（账本0违例，原因见引擎AI手册失败教训表）；按最坏重试放大降低排队写负载后，第三次`run`（10玩家）通过完整一轮七类故障，0违例。这是正确性结论，不是容量结论。此后DBProxy入队改为组提交、TiangZ排队写仓库不再重试，第四次`run`在首次失败的负载（20玩家、排队写每250毫秒）下也通过，0违例。

| 组 | 实际执行内容 | 注入范围 |
| --- | --- | --- |
| `hotfix` | 引擎原有500客户端/180秒/每6秒热更负载，再20轮双进程故障矩阵；代码/配置配对、错误候选、排空超时、联合回滚 | 独立临时夹具，不停数据库；本入口未启用可选真实DB代理子项 |
| `dbproxy` | 真实存储契约回归；PG、cache、可靠Redis、AOF积压重启、两个DBProxy节点故障；最终快照/事务/SQL/Stream对账 | 仅专用本机演练容器和自有DBProxy进程；游戏负载用于验证端到端恢复 |
| `game` | MapHost两节点、长时间离线孤立会话、Location、两个独立Gate、动态副本宿主/管理器、整组游戏进程强杀恢复 | 故障阶段只杀自有游戏进程，不停数据库；同账号连续两轮业务检查、交易资产复核 |

`game`测试的是MMORPG验证模块，不表示SLG游戏业务已经实现。动态副本失效验证安全回退，不保证恢复原副本内存状态；整组恢复核对已持久业务，不承诺未保存状态不丢。当前Gate场景是有负载强杀单个Gate并同账号恢复，不等价于旧独立探针的每一项协议级接管断言。

详细Hotfix脚本仍由引擎维护；Examples只做编排，不复制框架实现。DBProxy Rust存储用例仍归DBProxy仓库。`legacy/tools`旧脚本不直接启动：本入口只复用手写交易探针，打包时将SDK输入解析到当前Examples生成物；动态副本探针复用引擎现有手写协议包装与当前正式codec，不手写opcode、不关闭访问校验。

## 命令（在Examples根目录）

```powershell
# 默认只看计划：不读凭据、不访问Docker、不生成或启动服务
npm.cmd run reliability
npm.cmd run reliability -- plan --suite game

# 纯控制器测试与探针静态打包；不运行游戏/数据库
npm.cmd run test:reliability-plan
node tools/chaos/build_validation_probes.mjs --check

# 准备制品（不运行验收、不启动容器；会编译及生成正式SDK）
npm.cmd run reliability -- build --suite all
# 只读制品检查；不等于运行时验收，也不检查Docker健康
npm.cmd run reliability -- check --suite all

# 以下必须等用户明确指令；会清理专用演练数据、启动负载并注入故障
npm.cmd run reliability -- run --suite all --seconds 3600 --players 100 --confirm reset-local-validation-data-and-inject-faults
```

`--suite`为`hotfix/dbproxy/game/all`，all串行执行。`--seconds`是DB和game**每组**的时长（默认各3600秒），`--players`是每组游戏探针人数，持久化探针仍100人；不改变hotfix固定500客户端/180秒。故障间隔为10秒，但单个故障包含停机和两轮业务恢复，实际会更长；还需构建、契约和最终对账时间。时长不足以覆盖全部所选故障时明确失败，不缩减用例凑绿灯。运行前应按用户要求确认时长，而不是把默认值当用户同意。

当前DB/game执行器是Windows本机版，拒绝在其他平台悄悄换测试。三仓库同级，先安装各仓库开发依赖；普通TiangZ宿主用于Hotfix，MMORPG必须通过`server:native-build`获取指纹匹配的模块组合宿主。地图/资源Rust探针从引擎release目录获取，不再从Examples旧target目录取引擎。

## 安全边界

- 仅支持`tiangz-dbproxy-local`演练项目的PG、可靠Redis、cache三容器，回环绑定。需要人工提前准备该专用环境，**不能复用SLG运营/开发数据库容器**。预检要求缓存无AOF/RDB、使用tmpfs。
- DB/game每组prepare都会删除并重建`dbproxy_local_validation`、`dbproxy_local_contracts`两库，并清空演练的两只Redis；契约用例之间也会清理。game组虽然不注入DB停机，仍有这些准备写入。
- 普通`plan/check`不会进入清理；run和底层控制器均检查显式确认。源码确认字符串不替代用户授权。
- 独占锁`../.build-tmp/local-validation/reliability.lock`防止新入口并发抢用演练存储；锁残留时先确认旧控制器和其子进程已退出，不自动抢锁。不能与手工运行旧控制器并行。
- 缺失宿主/探针产物在清库前失败；仍需检查制品是本次源码构建。报告冻结实际二进制/配置/包和控制器哈希，并分别记录三个仓库版本。
- 运行中不要杀控制器。在活动组目录创建`STOP`，控制器在检查点停止并尝试恢复依赖、清理自有进程。总入口Ctrl+C也请求STOP，但Windows控制台退出不能保证清理完成；异常中断保留锁和证据，人工核对容器及PID后再处理。
- 已有文件和失败报告不覆盖，每次独立证据目录。没有自动删除演练记录/报告的“清理所有”功能。

## 报告及通过条件

总入口打印`../.build-tmp/local-validation/reliability-*/summary.json`。包含计划、分组开始/结束、真实报告路径、各步骤原始日志。build标记`built-not-tested`，不能当passed；运行出错即停止后续组。

Hotfix读取实际`report.json`和`fault-report.json`，要求都passed且二进制hash一致。DB/game各自目录保留manifest、started、events、resources、final、cleanup及失败现场；之后运行只读`audit_local_validation.mjs`。审计必须核对全部计划动作至少完成一次、每个故障恢复两轮原账号业务、持久化/消息对账，不能仅看进程退出0或端口恢复。游戏正常收尾被迫强杀会留下failure并判失败。

本轮整理发现：旧脚本路径仍指向拆分前产物；旧审计的证据根少了一层目录；原先短时运行可能未覆盖全部动作却写final。现在分别修正模块组合宿主/SDK路径、证据根及覆盖断言。新增Gate独立进程与整组强杀场景仅完成静态检查，必须在下一次正式运行中实测。

历史证据与失败原因见[引擎AI手册](../../../TiangZ/docs/ai/business-development-manual.md#失败教训与复测流程)和[热更验收](../../../TiangZ/docs/design/hotfix-fault-acceptance-20260917.md)。这些链接从本文件需跨至同级仓库；历史测试通过不升级为当前代码通过。
