# SLG 三类可靠性验收：热更、DBProxy故障、游戏崩溃恢复

D1修复后定向复测：run-wTYhCH/report.json为subset-passed，官方authoritative_reads真实PG/Redis测试1通过（11.42秒），SLG原子批量探针通过，游戏/代理/探针/存储全部停止。工具单测17通过；正式build/check通过。此证据仅覆盖D1，不代表H/J或整轮90分钟通过。

日期：2026-09-18。状态：**25个H/J子项均已分批实测通过，H3额外连续三轮通过，H8连续资源观察通过；八小时长稳最终因有效资源样本不足失败，采样已修正且10分钟实库回归通过；完整三轮矩阵仍待验收**。历史首轮90分钟在D1提前停止，后续已定向修复复测，不能把历史缺项当作当前状态。本文件是三类测试总清单，不替代实际报告，也不授予启动故障/容量/长稳的权限。保留原文件名以兼容现有链接。

D1定向复现 `run-TC9Bun` 的 `D1-1/sql-snapshot-probe.log` 确认失败来自夹具：独立存储测试共用SLG数据库，却注册了不同Redis地址的同名Publisher，初始化按契约拒绝。现改为本轮隔离PG容器内的专用 `authority_probe` 数据库；SLG原子批量探针仍针对SLG记录，官方存储测试独立验证SQL快照。子进程失败或超时也保存stdout/stderr日志。禁止删除Publisher注册记录或放宽校验；修复后的验收结果以新报告为准。

A4复测 `run-GCm8Ll` 又暴露了环境清理问题：每个用例只停止容器会留下默认网络，累计后耗尽Docker地址池，未进入业务断言。现已确认清理空的 `slg-acceptance-*` 网络，并将每轮收尾改为 `docker compose down --remove-orphans`，删除本轮容器和网络、保留命名卷；A4定向复测 `run-Y5p6QT` 已通过。 / The A4 rerun `run-GCm8Ll` exposed a cleanup issue: stopping containers alone retained one default network per case until Docker address pools were exhausted, before business assertions ran. Empty `slg-acceptance-*` networks were removed after verifying no running containers, and each case now uses `docker compose down --remove-orphans` to remove its containers and network while retaining named volumes; targeted A4 rerun `run-Y5p6QT` passed.

H3夹具已修正正式协议的 `writes[].record` 匹配、info日志可见性及短准备窗口下的受控流量。`run-gOw29M/report.json`连续三轮通过，准备阶段分别有3、4、3条客户端响应，仍要求实际收到回包后才能计入证据；没有修改Runtime。 / H3 now uses official commit fields, visible lifecycle logs and bounded preparation traffic. Three consecutive rounds passed with three, four and three client responses in the preparation window; runtime behavior is unchanged.

## 目标和边界

以 SLG 的建筑升级、定时产粮、抽卡/武将升级、行军占领为业务载体，验证 DBProxy [默认读取契约](../../../../TiangZ-DBProxy/docs/default-read-contract.md)：默认 Load/LoadMulti 读 PG 主库，失败不回旧缓存；缓存查询显式选择，可附加最低版本。PG 提交确认后，缓存失败不改变写成功；PG 提交结果未知必须保留原事务重试。

本轮不采用 MMORPG 作为 SLG 业务探针，不引入新玩法。SLG 仍是单世界、最多32个开发玩家、没有账号鉴权或独立 PlayerHost；下文“登录”指同一开发身份恢复，不等于真实登录协议验收。真实跨服所有权接管、Rust战斗结算、小程序真机、500玩家和24小时长稳另行安排。

三类测试均为必选主线，先分别通过，再编排联合场景；不是只测数据库：

| 主线 | 用例 | 验收目标 |
| --- | --- | --- |
| 热更 | H组 | 持续SLG业务下Hotfix＋配置原子切换、3秒暂停入口、失败恢复旧版、任务与资产不重复 |
| DBProxy故障 | B组，配合A/D组 | 默认权威读取、缓存故障隔离、节点故障和恢复一致性 |
| 游戏进程崩溃恢复 | C组，配合A组 | 建筑、抽卡、升级、产粮和行军的持久恢复与幂等 |

Hotfix/config底层机制沿用框架，不再造另一套热更。框架测试通过不代表SLG热更业务通过；正式SLG数值仍写在Hotfix，隔离夹具已使用正式Luban生成配置并核对代码/配置配对。

## 验收底线

1. 已确认提交的资产不回退；未知结果不能重新扣费、重新抽卡或重复返兵。
2. 默认恢复不依赖调用方提供 min_revision；旧正缓存、负缓存不能改变 PG 已提交事实。
3. PG 不可用或超时时明确失败，不能返回旧缓存、假不存在或创建初始资产。
4. 保活命中复用原权威内存，不调用存储 Load；按时间结算发生写入是合法的，不能把“不读库”误解为“不访问数据库”。
5. 默认 LoadMulti 共享同一 SQL 语句快照，保持输入顺序和缺失位置；多次独立 Load 没有共同快照保证。
6. 回收内存不删除持久任务。建筑/行军按截止时间幂等结算；产粮按完整分钟补算。
7. 运行期检查和最终对账都要通过。曾返回旧资产，即使最后修复一致，也判该用例失败。
8. 热更只允许同一Process内完整代码/配置配对生效；失败恢复整套旧版。发布回退不能撤销已确认数据库提交，不能重建玩家或重跑Awake来假装热更。

## 工具与执行范围

| 入口 | 已有范围 | 本计划中的限制 |
| --- | --- | --- |
| SLG `npm.cmd run test:gameplay` | 29条规则、假存储、模拟前台控制测试 | 不是实库故障或真机证据 |
| SLG `npm.cmd run smoke` | 无数据库真实RPC、断开11秒重连 | 不能证明新默认读PG或真实5分钟回收 |
| SLG `tools/authoritative_acceptance.mjs` | A1–A5、B1–B6、C组、D1–D5的独立环境编排，已有真实执行报告 | 尚无完整三轮通过报告；D5旧服务端为握手模拟器 |
| H/J隔离SLG热更夹具 | 25子项已接入，当前分批结果见文首及实际report.json | 不把分批、单轮、框架或构建证据冒充完整三轮 |
| SLG `tools/recovery.mjs` | 3玩家、7类游戏强杀/恢复场景，独立SQL对账，已在C组实跑 | 没有下面全部缓存/DBProxy故障编排 |
| DBProxy `tools/test_authoritative_reads.mjs` | TCP默认读取、栅栏、缓存写超时、PG阻塞、批量快照等 | 存储级证据；不是SLG业务链路或OS进程强杀 |
| Examples `--suite slg` | 现有SLG恢复脚本的统一入口 | `all`不包含slg；`game`仍是MMORPG，不能用它冒充SLG |

新增自动化已包含缓存故障夹具、按正式协议统计玩家Load、DBProxy双节点切换和进程重启、原始回执断言、逐用例报告及故障前后容器资源/PG参数/DBProxy指标快照。资源快照不是容量时序采样或P99报告。显式缓存/LoadMulti栅栏当前不经SLG Host暴露，使用正式Rust DBProxy客户端作为伴随探针验证，明确标为存储契约子项，不为测试绕过Host或伪造游戏协议。

## 环境与执行纪律

- 新建本轮独享SLG游戏进程、DBProxy A/B、PG主库、Redis与私有网络。A/B连接同一主库；游戏世界始终只有一个权威拥有者。先逐项单故障，不叠加随机故障。
- 使用3个固定开发身份，地块按每用例独立新环境或已授权夹具初始化隔离，避免三个地块耗尽污染后续结果。不得清理现有开发/线上数据库。
- 重建游戏、SDK和全部DBProxy节点；保存源码提交号、未提交及新增源码文件清单和内容哈希、制品哈希、协议指纹、镜像ID和脱敏配置。仅有commit或哈希不能还原脏工作区测试制品，迁机复现前须另行保存源码或提交；报告不复制可能包含凭据的diff。
- 默认读取验收至少一轮将隔离配置 authoritativeReadNamespaces 设为空，证明不靠旧白名单才正确。保留该配置的兼容语义另测；不要修改日常开发配置。
- 注入前记录真实PG记录版本/资产、Redis缓存状态及操作序号；只允许在本轮隔离缓存中构造旧值/负缓存。PG业务状态通过正式游戏命令产生，SQL独立对账只读，不改资产来制造通过。
- 每项记录故障命中证据。暂停Redis但未实际触发缓存写超时，或计划丢ACK却未命中提交回包，只能标为“未有效执行”，不能通过。
- 等待以状态/记录证据和有界超时为准。预先写入场景时限及恢复预算；故障期允许明确错误，解除故障后须在预算内恢复。禁止无限重试或只等最终看起来正常。

## H. SLG业务持续运行下的热更（必选）

遵循[主工程热更设计](../../../../TiangZ/docs/design/typescript-hot-reload.md)：保持一个完整Hotfix发布包，与完整配置快照配对；在线准备阶段正常服务，准备完成后短暂停入口，在两次Update之间提交。使用已有方法名Timer，业务禁止await时间；数据库/RPC等待仍需按现有排空规则处理。

### 夹具准备

- 先为独立SLG测试模块接入真实Luban配置和稳定配对观测字段，再完整构建启动。准备代码/配置配对的V1、V2及错误候选，之后热更不改变Model、协议、模块图或配置schema；不得手改生成物或绕过指纹校验。
- 配置必须真正影响可对账业务，例如新建建筑的成本/工期，不能只在响应里拼一个版本号。明确已受理任务冻结的成本和dueAt；产粮如改变速率需先定义跨版本分段结算规则，不能拿新速率重算整个历史区间。该夹具不表示当前SLG已有这些能力。
- 首轮3个固定玩家，持续轮换建筑、抽卡、武将升级、行军和快照，保留一个未确认命令/玩家；确保更新前、暂停中、恢复后都有业务证据。每项独立基线，避免粮食耗尽、等级封顶或三个地块用完造成空转。
- 明确测试客户端RPC超时设为30000ms，并记录实际值，不把通用SDK默认值当成30秒。发布预算使用现有hotfixReloadTimeoutMs=3000，不改大超时掩盖失败。3秒是排空/提交控制预算，不是同步执行可强行中断的硬时限，也不能保证已等待很久的RPC不超时。

| 编号 | 场景与注入 | 必须断言 |
| --- | --- | --- |
| H1 | 持续业务中V1→V2，代码和热配置同时变化 | 每次操作只使用完整V1或V2配对；同一游戏PID、连接和玩家状态保留；发布身份/配置哈希一致，不能只看reload成功日志 |
| H2 | 分别只改代码、只改热配置 | 仍走完整联合候选；配置单改也有新发布身份；实际业务遵循对应配对，未改部分保持正确 |
| H3 | 正常负载下主动暂停新入口 | 记录准备、暂停、排空、同步提交及恢复时间；正常受控负载RPC不丢失/错配/重复，不因热更超时；不能把客户端重连掩盖为连接保持 |
| H4 | 从入口暂停起点起，保持真实DB/RPC在途超过排空预算 | 本次候选放弃，旧代码/配置继续服务，入口恢复；不强杀在途Promise。放行后原事务只确认一次；代理总扣包时间不能代替暂停窗口证据 |
| H5 | 配置校验失败、Hotfix求值失败、配对哈希损坏；受控提交阶段失败 | 拒绝候选或按现有机制恢复方法/Handler/配置，活动配对不混合，旧版仍可处理业务；提交失败注入若仅框架具备，明确分层报告，不冒充SLG覆盖 |
| H6 | V2已处理业务后主动回滚V1 | 代码/配置一起恢复，generation按框架推进；保留V2已确认扣费、卡和占领，不能“回滚资产”或重做命令 |
| H7 | H7a：抽卡在预算内完成排空后成功切换；H7b：持续在途导致候选放弃；两种窗口均覆盖任务到期与跨分钟 | 不要求未排空事务跨过成功切换。恢复后按截止状态结算一次；冻结成本/dueAt不重置；产粮不重复、原抽卡receipt不被战报覆盖 |
| H8 | 连续V1/V2切换和回滚，夹杂无效候选；小规模先做10次 | 每次均有有效业务；Timer/pending/队列回到预期基线，堆/RSS按预热后的增长门槛判断，不要求每次立即下降；具体门槛见下文 |
| H9 | 提交Model/协议/冷配置或schema不兼容候选 | 构建或加载明确拒绝，旧版可用；应完整重建重启的变更不能被算作在线热更成功 |

暂停期间断线、队列满或客户端本地超时属于另设故障变体：允许现有明确过载/断线语义，但不能默默丢掉已确认业务。客户端超时不等于服务器取消；重试必须携带原操作身份并核对回执。H3正常窗口与故障变体分别报告，不能用“故障允许错误”豁免正常窗口的超时。

每次发布记录候选releaseId、Hotfix/config哈希、前后generation、操作与任务ID、暂停/排空/预检耗时、RPC延迟及超时、失败原因和入口恢复证据；持续核对业务使用的配对与PG资产。机制原子性是Process内代码/配置原子性，不是数据库事务或全部Pod同时切换。

当前可执行H子项见文末实施清单，以具体子项如H2a、H3-F2传入--cases。框架热更回归只作前置证据。后续原定“1小时、约每10分钟热更、500客户端”作为容量/长稳阶段单独安排，当前SLG32玩家和有限玩法需先解决负载夹具限制；24小时暂不执行。

### H/J共同前置条件与判定口径

以下为完整验收规格；当前自动化覆盖与缺项以文末实施清单为准，不表示本轮已执行真实故障验收。每个子用例至少3轮独立环境；H8每轮包含完整10次候选尝试。不能仅跑一个代表子项就将整组标为通过。

| 项目 | 固定要求 |
| --- | --- |
| 配对基线 | 在独立SLG副本先冻结Model、协议、模块图及Luban schema，再完整构建。准备P11=代码1/配置1、P21=代码2/配置1、P12=代码1/配置2、P22=代码2/配置2四个合法完整候选及各自启动包；代码行为标识、配置内容哈希和实际扣费/工期都必须可观测 |
| 首版业务变量 | 只改变新受理建筑升级的成本/工期；保持产粮速率、抽卡概率、行军战斗规则不变。V1/V2具体数值在制品清单中固定，事先计算3玩家可支撑的动作数，不用测试中途补粮或直接改PG延长测试 |
| 已受理任务 | 扣费在原事务中确认，持久dueAt固定；热更/回滚只能改变之后新受理任务的规则。重试已提交命令仍返回原receipt，不能按当前配置重新算成本或随机结果 |
| 客户端等待 | 测试客户端显式设置RPC timeout=30000ms并输出实际值；当前SlgConnection尚须补入口。单玩家最多一个未确认经济命令，保存原序号及参数；连接实例、连接代次、关闭/重连次数独立记录 |
| DB等待 | 游戏→DBProxy保持现有requestTimeoutMs=5000，单独记录；不能把客户端30秒当成DB请求30秒。H4必须证明候选因热更排空预算退出，而非DB请求先超时导致任务提前排空 |
| 热更时间轴 | 记录prepareStart、prepareEnd、pauseStart、drainEnd/abort、commitStart/End、resume，以及DB发送/到达/放行/完成时间。持续时间使用同一控制器单调时钟；跨进程日志只用于关联，不直接相减冒充精确耗时 |
| 有效命中 | 扣住明确操作的请求或成功回包，按连接/rpcId关联；必须看到相应未完成任务及暂停事件。没有命中、超时分支错误或任务未在目标窗口到期，标not-effective并保留证据，不算通过 |
| 恢复预算 | 解除故障/入口恢复后30秒内完成原命令确认及资产对账；已到期任务在入口恢复后10秒内结算。未到期任务等到持久dueAt后10秒。超预算失败，不无限重试；测试前固定预算，失败后不得追改为通过 |
| 业务证据 | 保存操作序号/参数、提交operationId、PG修订号、独立receipt、扣费前后资产、任务dueAt、代码/配置配对及连接代次。版本标识不能替代真实规则断言；Timer结算不得被重连请求代做后冒充自动完成 |

### H组子用例步骤与成功条件

| 子项 | 准备、操作及故障时点 | 判定与证据 |
| --- | --- | --- |
| H1 | P11先受理一个未到期建筑；持续发送快照和有预算的经济命令，发布P22；恢复后新建另一建筑任务 | 旧任务原扣费/dueAt不变，新任务按P22计费/计时；操作全过程只出现P11或P22，不出现P12/P21；PID、连接代次不变，玩家未重建 |
| H2a | 独立P11基线发布P21，只改代码 | 新releaseId且活动配置哈希不变，观察到代码2行为及配置1业务数值；不能只检查候选目录存在 |
| H2b | 独立P11基线发布P12，只改配置 | 新releaseId且代码行为仍为1，新任务使用配置2；完整Hotfix制品哈希可能因构建元数据变化，不能错误要求其字节哈希不变 |
| H3 | 候选准备期间持续发业务；观察到pauseStart后继续发有界请求；发布恢复后逐个关联回包 | 准备阶段仍有请求完成，暂停期间新业务未进入TS执行，恢复后队列请求各返回一次；正常窗口无RPC超时/断线/重连，PID不变。记录实际pauseMs，不把3000ms当同步执行硬上限 |
| H4 | 先准备候选；在正式业务提交回包处扣住成功ACK，立即发起发布。观察pauseStart，直到排空超时及resume都出现才放行ACK | pauseStart至abort之间原DB任务确实在途；活动releaseId/generation保持旧值，原因是排空超时。放行后原事务确认，重试原命令只返回原结果。若5秒DB超时先发生、或暂停开始太晚，则not-effective，重新从独立基线做，不放大超时 |
| H5a | 发布schema相同但业务validator不接受的配置值 | 拒绝候选，活动代码/配置/玩家状态不变，旧版继续处理有效命令 |
| H5b | 发布通过兼容性检查但求值失败的Hotfix | 拒绝候选并恢复入口，无新行为或配置泄漏；保留失败阶段和异常分类 |
| H5c | 在独立候选副本破坏配对manifest哈希 | 完整性校验拒绝，活动包不变；不得通过更新锁或关闭校验让坏包被接受 |
| H5d | 使用已有受控注入点触发同步提交中方法/Handler安装或配置交换前检查失败 | 恢复整套旧方法/Handler/配置，旧版继续业务。若仅能运行框架测试，报告framework-only，SLG对应覆盖仍为未完成；不声称能撤销配置交换后的任意副作用 |
| H6 | P22至少确认一次改变成本/工期的业务，再主动回滚P11，随后提交新任务并重试P22原命令 | generation推进，活动配对回到P11；P22已确认扣费和原receipt保留，新任务按P11计费；回滚不抵销资产、不重跑Awake |
| H7a | 预置建筑和行军，使至少一个持久dueAt及产粮分钟边界落在暂停窗口；扣住抽卡ACK，确认暂停后在排空预算内放行 | 原抽卡完成后才成功提交P22；暂停期间不提前结算Timer，恢复后不发玩家请求，先以只读SQL确认到期任务各结算一次；再读快照及重试抽卡，核对原receipt、粮食完整分钟、返兵与占领 |
| H7b | 与H7a相同，但扣住ACK直到排空超时 | 候选放弃，旧配对不变；放行后原抽卡确认，旧版Timer恢复，任务只结算一次。不能将本项记为热更成功；独立记录“安全退出通过” |
| H8 | 预热后按下述固定10次序列执行，每次夹入真实业务及稳定采样窗口 | 合法候选生效、无效候选拒绝均符合预期；每次至少一项经济操作确认或持久任务完成，纯快照或拒绝空转不计有效业务；满足资源门槛 |
| H9a–d | 独立测试Model字段、协议、冷配置、Luban schema变化；每种候选各自构建/尝试加载 | 在规定的构建或兼容检查阶段明确拒绝，记录具体原因。若在构建阶段已拒绝，不伪称运行期注入成功；旧进程继续业务，不自动重启后算热更通过 |

H7使用外部代理和控制器调度窗口，不在业务中加入等待时间。窗口很短时允许控制器在自然分钟边界前准备任务；不得直接改PG的producedAt/dueAt或修改机器时钟制造命中。建筑和行军可分成独立H7a/H7b轮次分别命中，不能漏测一种任务；正常版本规则需事先给出可复现的时间安排。

### H3故障变体：分别验收，不豁免正常窗口

| 子项 | 注入 | 必须断言 |
| --- | --- | --- |
| H3-F1 | pauseStart后主动断开一个客户端，再用原身份连接 | 明确记录连接已改变；已提交命令可按原身份恢复，不能丢已确认资产。未送达/未确认命令不能被错误宣称已执行 |
| H3-F2 | 仅在隔离环境用有界发送量触发现有队列容量限制 | 必须有队列达到边界及实际过载/断线证据；允许已有明确拒绝语义，不允许无界增长。负载上限、队列类型和满载阈值先写入本项计划；无法命中记not-effective，不改容量掩盖 |
| H3-F3 | 单独将一个测试客户端RPC超时缩短，保持请求仍在服务端执行直至客户端超时，再解除故障 | 客户端超时不等于服务端撤销；最终SQL及原receipt确定唯一结果，同序号同参数重试不重复扣费。此变体的实际客户端超时值单独记录，不混入正常30秒统计 |

### H8资源门槛与采样

- 每轮先做2次不计入正式10次的成功配对切换，完成任务后采样30秒作为预热基线。10次序列固定为：P22、回滚P11、无效配置、P21、P12、损坏哈希、P22、回滚P12、求值失败、P22；回滚恢复上一活动配对，不能把此前P12误记为P11。每项保留预期发布身份及成功/拒绝结果。
- 每秒采样Timer、pending、入口/出站队列深度、JS堆和RSS；每次任务完成且停止发新命令后稳定采样75秒，结束再观察90秒。Timer基线允许每个驻留玩家的合法回收Timer及已知框架常驻Timer，逐项列出，不能粗暴要求总Timer为0。
- 解除阻塞、已到期任务完成并停止新请求后10秒内，业务pending和本轮请求队列应归零；业务任务Timer应等于未到期任务/驻留回收的预期数量。非零残留必须能对应具体合法任务，不能仅以低于进程总容量判通过。
- JS堆/RSS不要求立即下降或回到启动值。首版小规模检查采用：每个稳定窗口中位数相对预热基线的增长不得超过`max(64 MiB, 基线的25%)`；最后5个稳定窗口的中位数不得连续递增且累计增长超过16 MiB。JS堆和RSS分别判断，原始样本留档；这是夹具预设筛查门槛，不是生产容量承诺或泄漏证明。
- 必需指标无采集接口时先补稳定观测；缺采样、采样中断、业务动作不足或无法维持固定工作量均不得通过。所有门槛随运行清单冻结，失败后调整门槛必须新开报告，不改写旧结果。

## J. 三条主线通过后的联合场景

前置：H、B、C主线及A/D支撑项完成，附覆盖清单；J1–J3每个子项至少3轮独立基线。J阶段允许明确规划的组合故障，除此之外不叠加随机故障。

| 子项 | 操作顺序与故障边界 | 必须断言 |
| --- | --- | --- |
| J1a | P11下抽卡PG提交成功，代理扣ACK；发起P22热更，命中暂停后持续扣住，等排空放弃再放行 | 证明PG已提交但游戏未确认；旧配对恢复入口，原操作只确认一次。重复原请求，资产/卡种/张数/receipt均不变；不能因热更失败换操作号 |
| J1b | 在PG收到提交前扣住请求，再触发同样排空超时，退出后才放行 | 扣住期间SQL无该次资产变化；放行后仅一次提交。分别记录“提交前”与“提交后ACK丢失”，不能以一个替代另一个 |
| J2 | P11→P22成功并完成一项P22经济操作，同时保留一个未到期任务；记录正确P22启动包，再强杀游戏，显式用该配对启动新进程 | PID变化且启动配对是P22；PG确认资产、任务成本/dueAt、原receipt保留；离线到期任务恢复后只结算一次。使用预先构建的启动包，不改启动包生成物；运行期generation可能重置，不要求跨进程数字连续 |
| J3a | P22业务提交成功，游戏已收到DB确认，但在游戏→客户端回包处扣住原响应；回滚P11，随后强杀并从P11包启动，客户端重试原序号/参数 | 用客户端回包代理保持“客户端未知、服务端已排空”，不能让未完成DB任务阻止预期的成功回滚；保留P22已提交资产和原receipt，不按P11再扣费或重抽。冷热恢复均检查，不只比较最后余额 |
| J3b | P22下经济请求尚未到达游戏时由客户端侧代理扣住；完成回滚并从P11冷启动后，以原序号/参数发送一次 | SQL证明此前未受理/未提交，最终仅一次P11规则执行；不要求恢复从未持久产生的随机结果，也不承诺旧版成本。与J3a分别报告 |

J2/J3必须记录启动包releaseId、代码/配置哈希和部署动作；不能假定在线安装的版本会被重启自动记住。J3客户端代理须通过正式SLG协议解码关联请求/响应，不能复用DBProxy帧codec猜测游戏回包。

### 覆盖汇总与失败分层

后续总报告逐项列出H子项、H3故障变体、J子项及每轮结果，并引用A/B/C/D报告。允许的状态为not-run、not-effective、passed、failed、framework-only；仅passed计入对应层完成。H5d只有框架证据时单独说明该分层限制，不自动换算SLG覆盖。

总报告同时给出`scope`、必选清单、缺失清单、制品/配置身份、门槛版本和证据路径；H/J未完成时整体状态只能为incomplete或failed，不能沿用当前A/B/C/D脚本的passed作为全计划结果。首次失败、恢复后成功及重新运行均保留独立记录。

## A. 玩家驻留与冷恢复

| 编号 | 操作与注入 | 预期与必要证据 | 自动化现状 |
| --- | --- | --- | --- |
| A1 | 创建并持久化玩家，建立驻留后断线，在5分钟内原身份重连 | 返回确认内存；测量窗口内该玩家Load增量为0。启动扫描与对账SQL单独计数 | 已实现按玩家键计数，未实跑 |
| A2 | 最后请求后停止全部客户端轮询，超过keepAliveMs并确认回收，再重连 | 恢复同一资产、截止时间和回执；有实际冷Load证据，不仅是连接重建 | 已实现301秒无请求等待与冷Load断言，未实跑 |
| A3 | 保留Redis旧玩家资产，PG通过游戏推进到新版本；杀掉游戏并启动新进程，无版本下限恢复 | 新进程返回PG已确认资产，不返回旧缓存；记录启动扫描和请求加载 | 已实现旧缓存注入与新进程恢复，未实跑 |
| A4 | PG已有玩家，Redis放该键负缓存；冷恢复 | 角色仍存在且资产正确，不重新发初始3000粮食/100兵 | 已实现有效负缓存探针与冷恢复，未实跑 |
| A5 | 玩家离线期间建筑/行军到期，缓存回收；保持客户端不发请求并独立查PG，再重连 | 建筑/占领确在重连前完成且只结算一次；粮食按需完整分钟补算 | 已实现独立1秒TTL构建与重连前SQL对账，未实跑 |

A2以真实时间及再次读取触发的冷Load证明恢复路径，不声称直接测量JS对象回收或RSS释放。A5以截止回调期间的冷Load与重连前SQL证明离线处理。

默认keepAliveMs为构建期Model配置。快速轮可用独立构建的缩短TTL夹具，但必须另跑真实默认5分钟一轮；记录不同制品哈希，不能临时改JSON却不重建。默认重试耗尽会停止自动Timer：测试必须区分“自动恢复”与“玩家请求触发恢复”，不可悄悄重连救活后算自动恢复成功。

## B. DBProxy、Redis与PG故障

| 编号 | 操作与注入 | 预期与必要证据 | 自动化现状 |
| --- | --- | --- | --- |
| B1 | 建筑/抽卡提交时暂停缓存写，确认PG提交及缓存超时；随后冷恢复 | 写入按PG确认成功；新玩家状态正确，缓存修复尚未完成也不影响严格读取 | 已实现写失败指标、旧缓存和待修复行断言，未实跑 |
| B2 | 完成写入后停止本轮Redis，冷恢复玩家 | 默认读可读到PG资产；若其他启动依赖Redis导致进程无法就绪，单独报告可用性缺口，不能伪称默认读失败或通过 | 已实现独立缓存Redis停机，未实跑 |
| B3 | Redis保留可读旧值，阻塞PG读/停PG；分别执行冷恢复、默认单条和批量读 | 明确超时/错误，不能退缓存或创建新角色；解除后恢复。驻留命中不属于本项 | 已实现停止PG、严格读取3001错误与恢复，未实跑 |
| B4 | 游戏经A提交后强杀A，切到已升级B并冷恢复；再做A进程重启 | 不靠A内存版本记忆，资产/原回执不回退；记录PID退出、新PID/endpoint及切换时间 | 已实现容器内DBProxy主进程强杀、B冷读与A启动时间变化，未实跑 |
| B5 | 已确认写入后重启本轮Redis或构造旧缓存，再冷恢复 | 默认读不受缓存丢失/回退影响；不要求缓存路径具有同样强语义 | 已实现缓存重启及旧值恢复，未实跑 |
| B6 | 先制造旧修复任务，再由游戏提交更高版本，放行修复 | PG不变，缓存修复不能把较新缓存覆盖为旧值；保留修复队列、重试/死信证据 | 已实现观察领取、抬高目标及旧缓存写防回退，未实跑 |

B2将快照缓存Redis与可靠队列Redis拆开，停止前者；整台共享Redis故障引发的启动依赖不可用另行测试。B6覆盖真实待修复行及旧版本写保护；租约过期、死信、同名worker重领等完整并发矩阵仍属于DBProxy存储测试，不由这一项替代。

## C. SLG业务提交与游戏强杀

复用 [现有7项恢复矩阵](recovery-test.md)，全部用新默认读取制品复跑。以下断言已补入控制器，但尚未执行新一轮实库故障验收。

| 编号 | 业务与故障边界 | 对账要求 |
| --- | --- | --- |
| C1 | 建筑请求提交前杀游戏；重试确认后再杀 | 前者无扣费；后者只扣一次，截止时间保留，到期只升一级 |
| C2 | 抽卡PG已提交、ACK未交给游戏时杀进程 | 原序号/参数重试不重抽；粮食、卡种、张数和独立receipt一致。再让战报变化，原回执仍可恢复 |
| C3 | 武将升级提交ACK丢失后杀进程 | 粮食和等级一起提交，重试不再扣费/升级 |
| C4 | 出征提交前、提交确认后分别杀进程 | 粮食、预留兵力、队伍与地块预留同生共死，dueAt不重置 |
| C5 | 到达结算已提交但ACK丢失时杀进程 | 占领、行军清除和幸存兵返还一致，恢复不重复返兵 |
| C6 | 两玩家并发占同一中立地块 | 仅一个预留成功；失败方粮食和兵力不损失；无关第三玩家操作不被整个世界串行阻塞 |
| C7 | 停游戏超过一分钟再恢复，多次读取 | 按producedAt和完整分钟计算粮食，保留余量；跨新的分钟合法增产不误判为重复 |

扣费、收益要以该次操作前状态、时间和业务规则推导，不能仅比较“最后余额没变”。抽卡不做新随机抽样碰巧相同的判断，核对已提交回执及卡张数。PG版本按记录分别比较，不要求玩家版本和世界版本数值相等。

## D. 默认批量与显式缓存契约（伴随探针）

使用正式Rust客户端和本轮独享记录；测试记录与SLG玩家/世界记录分开，不用真实玩家资产做SQL压力更新。

- D1：默认LoadMulti读两条事务一起推进的记录，并发更新/读取；不出现混合事务版本，顺序、缺失位置正确。统计实际SQL操作，不能只看一次RPC。
- D2：显式缓存单条读取，无下限允许旧值；有下限时旧值/负缓存回源PG，未达到下限返回可重试错误。
- D3：批量下限逐项对应；任一不满足整批回源，不拼接两次读取结果；覆盖空下限、0、长度错误、缺失、PG故障。
- D4：两个DBProxy节点、重启后重复栅栏用例；缺失版本下限不能被宣传为“最新”。保留namespace策略时验证它可禁止显式缓存。
- D5：旧客户端到新服务端默认PG，新客户端到旧服务端拒绝不兼容握手；备用endpoint也必须升级。缓存SDK未适配的Host明确报不支持。

D1同时运行正式客户端并发原子写/批量读，以及本轮构建的`authoritative_reads`实库测试二进制，后者验证实际PG操作次数。D5的旧客户端方向发送正式旧fingerprint及未携带新字段的请求；旧服务端方向使用旧fingerprint握手模拟器，**不等于历史旧二进制部署验收**。未适配Host的显式缓存拒绝由SDK单测覆盖，本控制器不伪造Host接口。

这些是配合SLG验收的通用DBProxy子项，不代表SLG业务已经调用LoadMulti或LoadCached，也不代表跨服接管完成。

## 执行顺序、命令与报告

1. 先review已有A/B/C/D夹具并补H组SLG配置/热更夹具、断言及隔离目标；不要直接启动现有all流程。
2. 运行纯单测、检查、重建制品。分别验证H热更、B数据库故障、C游戏恢复三条主线，并完成A/D支撑场景；现有C组可先小规模复跑，但不能因此跳过H组。正式完整验收每项至少3次独立重复；acceptance90先做全项目单轮，每次恢复到明确基线，不自动扩大负载。
3. 正确性全部通过后另行制定PG并发阶梯：分开驻留重连、冷加载、进程启动扫描。记录CPU/内存/磁盘、PG参数和连接预算、QPS、P50/P95/P99、连接等待、超时/错误和恢复总耗时。当前32玩家上限不是3000在线模型，不能直接启动500玩家。
4. 容量与长稳的时长/人数另行确认，24小时本轮不执行。

三条主线分别通过后，按上文J组子用例执行联合场景；J1区分DB提交前后，J2验证正确启动配对，J3区分已提交但客户端未知与尚未送达的命令。H/J子项已接入当前脚本；完整三轮矩阵尚未执行，见实施清单。smoke30允许先运行联合场景进行诊断，不替代本节规定的完整验收前置。

在SLG包运行：

```powershell
# 只看计划/检查工具，不连接数据库或Docker / Plan and tool tests only.
npm.cmd run test:acceptance
npm.cmd run test:acceptance-tools
npm.cmd run test:gameplay
npm.cmd run check
# 重建宿主、正常/短TTL模块、正式探针、实库测试二进制及Docker镜像；不启动测试服务
# Build artifacts and image without starting test services.
npm.cmd run test:acceptance -- build
npm.cmd run test:acceptance -- check
# 获准执行故障验收后，先运行C组；不是整轮通过 / Authorized subset, not full acceptance.
npm.cmd run test:acceptance -- run --cases C --rounds 1 --confirm isolated-slg-authoritative-test
# 当前已实现矩阵，每项独立环境重复3次；缺项另列 / Repeat implemented cases; retain coverage gaps.
npm.cmd run test:acceptance -- run --confirm isolated-slg-authoritative-test
```

`plan`默认无I/O，`check`仅检查构建清单中的源码及制品哈希，不查询Docker。源码变化须重新`build`；短TTL只修改独立源码副本并走正式生成器，不更改日常Model配置。新入口固定3玩家，拒绝人数/长稳参数。原统一`--suite slg`仍只执行C组。

构建清单在`temp/authoritative-acceptance/build.json`，报告在`temp/authoritative-acceptance/run-*/report.json`，每项有单独目录及`rpc-events.json`、游戏日志。报告记录场景、轮次、基线/最终SQL、故障证据、制品/源码哈希、协议指纹、PG参数、容器资源快照和收尾结果。单轮profile输出`acceptance90-passed`或`smoke30-passed`，**不是本文三轮完整验收通过**；只有全部42项目各三轮通过才输出`passed`。报告逐项保留结果；这些结果也不包含真实历史服务端、容量或长稳认证。失败、未命中和未运行不得算通过。

每个A/B/D/H/J项使用新项目、PG、队列Redis、缓存Redis及两个DBProxy，PG/缓存和业务端口仅发布随机回环地址。C组每轮单独项目内部顺序执行7项业务场景。结束停止本轮资源并保留卷，不清理其他项目。Ctrl+C请求有界收尾；父控制器通过IPC要求C子控制器收尾，超时强制退出或进程外杀控制器仍需按报告项目名/PID复核。目录含隔离凭据，不能整体公开上传；仅复制脱敏报告及必要日志。

历史证据：SLG两轮7项强杀为驻留改造前基线；DBProxy target/authority-read-W2M1FK 为默认读取存储级证据；29条单测与无DB重连冒烟是另一层。三者不能相加冒充本计划已完成的SLG实库联合验收。

## 本次夹具验证记录

2026-09-17：9条控制器/断言/代理工具测试、29条SLG玩法与驻留测试、3条Rust探针测试通过；`npm.cmd run check`、`cargo test --workspace`（实库ignored项未执行）、探针Clippy与Rust格式化检查通过。额外用真实探针子进程验证JSON-lines通信及旧fingerprint握手拒绝模拟，无PG/Redis连接。

本次未执行整套`test:acceptance build`，未重建游戏或Docker镜像，未启动A/B/C/D实库环境、外网、容量或长稳。没有修改SLG业务协议或手工编辑生成代码；SLG codegen仅check。正式实跑前必须执行上述完整构建和哈希检查，不能使用旧恢复报告作为结果。

此前文档轮次只补充验收规格。当前实施与验证见下节；上面的历史测试结果不自动适用于新热更夹具。

## H/J夹具实施与30分钟入口（2026-09-17）

所有新文件位于包内tools/acceptance。build-hotfix复制SLG模块到独立temp目录，经正式协议、Luban、类型检查和Bundle生成器构建；日常SLG模块及协议不改。冻结基线一次增加诊断字段，随后P11/P21/P12/P22保持同一Model/协议/schema，分别代表代码1/2、配置1/2。建筑基础成本/工期为配置1的200粮/10秒、配置2的240粮/12秒，再乘当前等级。响应捕获await前代码版本、await后配置版本及实际配置指纹，以检测混合配对。

每份合法配对都有完整启动包；J2明确从P22重启，J3明确从P11重启。客户端使用正式生成的SLG codec控制请求/响应，正常RPC超时30秒；DB超时仍为5秒，热更窗口3秒。H4/J1必须捕获真实pauseStart与abort，原RPC仍未结束且DB未先超时；不满足标not-effective。H7控制器等待自然分钟边界，不改时钟或数据库时间字段，恢复后先SQL核验Timer再发玩家请求。

### 当前覆盖边界

- 可执行H子项：H1、H2a/b、H3及H3-F1/F2/F3、H4、H5a/b/c/d、H6、H7a/b、H8、H9a/b/c/d。
- 可执行J子项：J1a/b、J2、J3a/b。H4与J1a复用相同机制，但分别报告、独立环境。
- H5a使用冻结Model中的正式gameConfig.validator，拒绝schema相同但建筑成本为负的候选；通过正式Luban生成，不破坏哈希伪装业务校验。
- H3使用最多4条并行只读请求链，要求准备阶段至少一条客户端业务响应完成，再证明真实暂停期间有界新请求排队、恢复后响应及连接保持；准备过快未采到该证据也标not-effective。发送/收包/服务器生成时间分别保存，不以服务器生成时间替代客户端回包证据。H3-F1/F2/F3分别覆盖断线、队列饱和及客户端短超时，单独报告。
- H5d在冻结Model设置不可替换的FixtureCommitGuard，坏候选把该方法排在已有方法之后，触发提交中途失败；核对旧配对继续处理业务，再验证合法候选仍可安装。H8使用已有outbound_lanes自定义指标和隔离Model的只读计数，不修改Core。
- H/J已开始真实PG/Redis验收：此前H1/H2a/H2b与H3定向通过，run-8KTtrc的H4、H5a/b/c/d、H3-F1通过，H3-F2因周期指标取样时序标not-effective；后续结果以新报告为准。新增coverage已接入不代表运行已通过；完整passed仍要求全部项目三轮通过。

### 30分钟关键路径

固定3玩家、1轮、20项目；C内部为7个独立恢复子场景，非500玩家容量测试。

| 顺序 | 项目 | 重点 |
| --- | --- | --- |
| 1 | A2、A3 | 真5分钟驻留过期、旧正缓存下冷恢复 |
| 2 | B1、B3、B4 | 缓存写超时、PG不可用不回退缓存、DBProxy切换 |
| 3 | C | 七种游戏崩溃恢复，核对资产与原回执 |
| 4 | H1、H2a、H2b、H3 | 联合发布、代码单改、配置单改、暂停排队 |
| 5 | H4、H5c、H6、H7a、H7b | 排空超时安全退出、坏哈希、回滚、任务/分钟边界 |
| 6 | J1a、J1b、J2、J3a、J3b | 提交前后扣包、正确启动配对、客户端未知结果重试 |
| 7 | 剩余窗口 | 三玩家每秒快照对账、每30秒一笔募兵，记录宿主指标 |

1800秒从首个隔离环境完成初始化后开始，**包括后续环境启动和项目切换**。首次准备及最后清理耗时另记，不承诺整个命令墙钟恰好30分钟。关键用例跑不完、窗口未命中、必需断言失败均不通过；不会删用例或延长窗口凑通过。结束前2秒停止新负载，正常清理可超出测量截止时间。尚未执行/未选项目及缺项保留在report.json，失败即停止；不复用日常开发数据库。

在packages/slg下：

```powershell
# 仅查看计划，不启动服务。 / Inspect only; no services.
npm run test:acceptance -- plan --profile smoke30
# 仅构建H/J正式候选，不启动Docker。 / Build H/J candidates without Docker.
npm run test:acceptance -- build-hotfix
# 控制器及正式客户端codec检查，不启动游戏/数据库。 / Controller and codec checks only.
npm run test:acceptance-tools
# 获准执行隔离验收后，构建完整制品并运行。 / Build and run after isolated acceptance is authorized.
npm run test:acceptance -- build
npm run test:acceptance -- check
npm run test:acceptance -- run --profile smoke30 --confirm isolated-slg-authoritative-test
```

build-hotfix产物不能代替完整build.json：运行入口检查宿主、DB探针、镜像、全部候选文件和源码哈希。源码改变必须重建。报告位置为temp/authoritative-acceptance/run-*/report.json，含配置、启动包身份、DB帧证据、客户端帧/连接状态、暂停日志与清理结果。故障候选损坏只发生在隔离副本，绝不修改正式生成源、关闭指纹检查或手改协议锁。

本轮验证：上一轮完成四配对及七种异常候选构建，14项工具测试通过。当前新增H5d候选、资源门槛、故障变体和90分钟入口的验证见下节；历史结果不代表当前真实故障通过。

## 完整单轮夹具与90分钟预算

`acceptance90`固定3玩家、全部42项目各一轮（C内部仍有7个恢复子场景）。90分钟是从首个环境就绪起计算的**预算上限**，包括后续环境切换；完成必需观察及对账后立即结束，不用空等凑90分钟。首次构建/镜像准备和最终清理另计。估计60～90分钟，尚无整轮实测耗时，超过预算或故障未命中不得通过。

- B1～B6故障解除后各继续观察3分钟：每2秒核对三玩家已确认资产和回执，每30秒一笔募兵，保留DBProxy指标。
- H8维持同一PID和客户端：两次预热各30秒；10次正式候选尝试，每次有效经济操作后稳定采样75秒；其中三次安排建筑任务并等自然结算，末尾再观察90秒。预计约16～18分钟，不属于500玩家容量测试。
- H8每秒读取宿主指标并保存resource-metrics.jsonl。出站取`tiangz_scene_custom_metric_gauge{name="outbound_lanes",key="outbound_total_depth"}`，不能只搜索固定指标名判定缺失。隔离Model通过已有metricsSnapshot扩展只读pending/Timer/驻留/截止任务计数；指标缺失、采样断档、未收敛、增长越界均不能通过。
- H8稳定窗口要求三名合法驻留对应三个回收Timer、零业务pending/截止任务/请求队列；全局Timer与预热基线比较，报告额外常驻Timer数。堆和RSS按上文中位数门槛，不要求主动GC或每次回落。
- H3-F1在pauseStart后关闭原客户端，用新连接重放同一业务身份；H3-F3客户端1800毫秒超时，DB仍5秒，候选按3秒排空预算退出，确认SQL和原回执没有重复。
- H3-F2保持默认总队列4096、数据通道3072，单独连接发送至多4096个正式SLG只读快照，客户端1200毫秒超时。必须同时看到frame队列峰值达到3072、背压计数增长和明确超时/断线；不能仅凭请求失败判定饱和。未命中记not-effective，绝不调小容量或无界加压凑通过。
- H5d只检验方法安装失败时旧方法/Handler/配置保持完整及后续可发布；不宣称能撤销配置交换后的任意外部副作用。
- H9b的真实协议变更也会改变Model包哈希；服务器可能先报modelFingerprint不兼容。夹具必须证明候选protocolFingerprint确实变化，并精确匹配首个被拒字段及双方哈希；此用例证明协议变更不能在线安装，不宣称单独覆盖越过Model检查后的协议检查分支。H3-F2饱和指标按周期发布，开始等待完整基线，结束有界等待本次突发的累计峰值/背压刷新，不能重复突发或把缺值当零。

```powershell
# 查看完整单轮预算，不启动服务。 / Inspect the full single-round budget without starting services.
npm run test:acceptance -- plan --profile acceptance90
# 获准执行隔离故障验收后运行；先完成完整build/check。 / Run after authorization and full build/check.
npm run test:acceptance -- run --profile acceptance90 --confirm isolated-slg-authoritative-test
```

历史构建验证：H5d候选、冻结Model指标、SLG检查及框架回滚自测已通过；此前的18项工具测试是历史数量，当前以工具输出为准。真实轮次已运行，不能再将其概括为“尚未启动”。2026-09-17完整轮次在H3夹具处停止，修复后H3定向通过；后续H/J以各自报告为准，不等于90分钟整轮通过。

## 八小时功能长稳 / Eight-hour functional endurance

固定3名角色、同一套隔离PG/队列Redis/缓存Redis、两个DBProxy和一个游戏进程。不是500玩家容量测试；不修改日常开发或外网服务。测量从环境就绪后开始，准备、最终冷恢复和清理另记。

| 时间 | 内容 |
| --- | --- |
| 0～30分钟 | 持续经济操作和基线采样 |
| 30～210分钟 | 每15分钟一次合法配对、回滚或坏候选拒绝，核对配置指纹、generation和资产 |
| 210～330分钟 | 每25分钟依次注入缓存写暂停、缓存停机、DBProxy A强杀、PG停机、游戏进程重启；每次必须恢复并对账 |
| 330～450分钟 | 同进程继续业务，检查恢复后的资源增长和队列收敛 |
| 450～480分钟 | 停止新经济操作，继续读取、产粮及对账；测量结束再做冷恢复核对 |

每10秒三角色快照，每分钟各募兵1名，每15分钟各抽卡一次；Alice每15分钟对四号地块派遣一级一号武将，固定战败返兵，保持地块可重复使用。建筑每30分钟尝试升级，达到5级停止，避免有限玩法耗尽使长稳伪失败。所有已接受命令立即使用同序号/同参数重放，未知结果也保留原命令；按整分钟核对产粮，独立验证回执、扣费、武将、行军返兵与建筑到期。至少1200笔成功操作、12次候选尝试及5次故障才可能通过。

每5分钟将SQL记录、宿主堆/RSS/Timer/队列、容器资源及DBProxy指标写入observations.jsonl，并原子更新report.json；报告包含PID和最近采样时间，不能只凭status=running判定活跃。修复队列恢复限时60秒，磁盘至少保留5GiB，观察证据最多512MiB，单游戏日志最多256MiB，容器日志各10MiB×3。恢复期至少20个空闲资源样本，同一PID比较Timer与内存增长；不通过重启隐藏该阶段增长。此处资源样本是5分钟点采样，不能冒充H8每秒连续稳定窗口。

```powershell
# 源码变更后重新正式构建，再做五分钟实库自检。 / Rebuild changed sources, then run the five-minute real-storage preflight.
npm run test:acceptance -- build
npm run test:soak -- --profile smoke5 --confirm isolated-slg-authoritative-test
# 提供覆盖全部H/J通过项的报告；程序检查覆盖并记录文件哈希。 / Supply reports covering all passed H/J cases; the runner records report hashes.
npm run test:soak -- --profile soak8h --confirm isolated-slg-authoritative-test --hj-reports "<report1.json>,<report2.json>"
```

报告位于temp/authoritative-acceptance/soak8h-*/report.json，自检位于smoke5-*。需要停止时在对应目录创建空文件STOP，控制器会协作退出、收尾并标记cancelled；Windows不要靠强杀Node冒充正常停止。首次失败报告和数据库卷保留，不覆盖历史结果。H/J报告覆盖门禁只检查实际passed项目，制品来源仍需结合报告artifacts核对，不能拿其他版本报告冒充当前验证。

2026-09-18短时实测：`smoke5-GUPRFU/report.json`为`smoke5-passed`，137次快照、20笔业务、20次原命令重放、13次对账、1次热更和1次实际缓存写故障，最终冷恢复与全部清理成功。计时302464ms包含当时脚本末尾冷恢复；新版已单列测量结束和冷恢复结束时间。此自检只跑一次P22发布和缓存暂停，不冒充八小时五种故障及内存增长验收。当前工具测试20项、恢复工具2项、游戏及持久化规则29项和SLG check通过。

### 2026-09-18 H/J前置结果 / H/J preflight results

下列目录均位于`temp/authoritative-acceptance`，以各目录`report.json`逐项状态为证据。前几批因其他子项首次失败而整体停止，其已通过项仍有完整清理记录；不覆盖失败报告，也不把这些分批记录说成一次完整矩阵通过。

| 报告目录 | 通过范围 |
| --- | --- |
| run-8KTtrc | H4、H5a/b/c/d、H3-F1 |
| run-JP9R5Z | H3-F2/F3、H6、H7a/b、H9a |
| run-0YDqnf | H9b/c/d、J1a/b、J2、J3a/b、H1、H2a/b |
| run-gOw29M | H3连续三轮；准备阶段客户端回包分别3/4/3条 |
| run-xSvyRq | H8：10次正式候选尝试、992个连续样本、清理全部成功 |

H8预热基线窗口RSS中位数55472128字节、堆4301872字节；最终90秒窗口RSS中位数58359808字节、堆4835248字节；Timer均为3，稳定窗口及增长门槛通过。各批源码指纹已逐文件比较：宿主、DBProxy、SLG业务源码一致，差异仅为验收工具与package.json脚本入口。

八小时控制器已于北京时间2026-09-18 01:05:42后台启动，PID 27472，报告`soak8h-Bkzmwd/report.json`，日志启动索引`launch8h-20260918-010542.json`。实际测量起止以报告measurementStartedAt/measurementDeadline为准，准备时间不算八小时。每5分钟自动对账与采样，遇断言失败即收尾并保留证据；当前不能宣称八小时通过。

实际测量窗口：北京时间2026-09-18 01:06:31至09:06:31，随后冷恢复及清理另计。首个样本于01:06:39写入，3笔已确认业务与原命令重放通过，状态running；最终结论必须读取结束后的report.json。

### 八小时结束后的采样回归 / Post-soak sampling regression

2026-09-18三小时验收已通过：`temp/authoritative-acceptance/soak3h-ArIYAT/report.json`，控制器PID 3108，测量窗口北京时间10:56:39至13:56:40，实测180.019分钟；冷恢复13:56:41完成，13:57:04清理完成。 / The three-hour acceptance passed: controller PID 3108 measured 10:56:39–13:56:40 China time for 180.019 minutes; cold recovery completed at 13:56:41 and cleanup at 13:57:04.

结果：`soak3h-passed`；534笔业务及原命令重放、109次对账、12次热更、5类故障全部恢复、30个恢复资源样本（门槛20），同一游戏PID、定时器恒为3、恢复窗口无非空闲样本；缓存暂停/停止、节点终止、PostgreSQL停止、游戏重启的恢复耗时分别为2592/12190/6498/20701/1784ms，清理状态为game/proxies/probe/storage全部stopped。25项工具测试、正式构建和H/J覆盖门禁在启动前通过。 / Result: `soak3h-passed`; 534 operations and replays, 109 reconciliations, 12 hotfix candidates, all five fault recoveries, and 30 recovery resource samples against the unchanged threshold of 20. The same game PID and three timers were retained, with no non-idle recovery samples. Recovery elapsed times for cache pause/stop, node kill, PostgreSQL stop and game restart were 2592/12190/6498/20701/1784 ms; all cleanup targets stopped. The 25 tool tests, official build and H/J coverage gate passed before launch.

三小时方案 `soak3h`：0–10分钟基线、10–70分钟热更（每5分钟一次，至少12次）、70–110分钟五类故障（每8分钟一次）、110–170分钟同进程恢复观察、170–180分钟收敛，结束后冷恢复及清理另计。每2分钟对账采样；恢复期计划30个时隙，仍要求至少20个有效样本、同PID和原增长上限；至少450笔业务且全部五类故障成功恢复。保持全部H/J通过报告前置检查，使用3名角色的本地隔离环境。运行命令为 `node tools/soak_acceptance.mjs --profile soak3h --confirm isolated-slg-authoritative-test --hj-reports "<report1.json>,<report2.json>"`。 / The three-hour profile preserves twelve hotfix attempts, all five faults, a continuous one-hour recovery window and the unchanged twenty-sample growth gate, with two-minute sampling and at least 450 operations. Final cold recovery and cleanup follow the measured duration; H/J preflight evidence remains required.

2026-09-18短时采样回归已通过：`sampling10-rd6WDP/report.json`为`sampling10-passed`，北京时间10:36:32开始测量，实测601201ms，10:46:54完成清理；21个有效资源样本通过原20个门槛、同PID及增长检查，26笔业务及26次原命令重放、29次对账、233次快照，最终冷重启恢复通过，游戏/代理/探针/存储全部停止。正式构建与24项工具测试通过；历史样本回放确定复现原18/20失败。本轮仅验证采样修复，未执行热更和五种故障，未启动新八小时测试，原八小时失败报告保持不变。 / The ten-minute sampling regression passed with 21 valid samples against the unchanged 20-sample threshold, same-process growth checks, 26 operations and replays, 29 reconciliations, 233 snapshots, final cold recovery and complete cleanup. The official build and all 24 tool tests passed, including replay of the original 18/20 failure. This verifies sampling only; no new eight-hour soak was started.

`soak8h-Bkzmwd/report.json`最终为failed，09:06:53完成全部清理。1428笔操作及原命令重放、113次对账、12次候选尝试和5种故障恢复已执行，失败点是恢复期23个点样本被过滤为18个，未达20个门槛；资源增长断言与末尾冷恢复尚未执行。旧报告不修改为通过。

修复后基线/恢复采样每次最多等待60秒，要求两个不同发布周期的指标连续空闲；全部观察写入resource-settling证据，持续忙碌、指标不刷新或缺失均失败。保持原20个有效样本门槛，按固定时隙推进，并在运行中核对剩余时隙是否足够；恢复期结束立即验证数量、同PID及增长，不再拖至整轮结束。报告包含recoverySampling进度与resourceWindows。

`sampling10`为专门的10分钟实库回归：同一隔离环境前8分钟每20秒安排采样，仍要求至少20个有效样本；用真实建筑倒计时证明存在非空闲指标，等待自然收敛；后2分钟停止新经济操作，结束后执行冷恢复和清理。它不运行五种故障，也不替代八小时耐久证据。原23样本另保存在tools/acceptance/fixtures/soak-resource-20260918.json，工具测试直接复现18/20失败，同时覆盖持续忙碌、冻结指标、重复快照、数量不足和PID变化。

```powershell
# 获准短时实库回归后执行。 / Run the authorized short real-storage regression.
node --test tools/acceptance/*.test.mjs
node tools/authoritative_acceptance.mjs build
node tools/soak_acceptance.mjs --profile sampling10 --confirm isolated-slg-authoritative-test
```
