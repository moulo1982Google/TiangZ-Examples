# SLG 小规模崩溃恢复测试

新版默认PG读取的SLG联合验收以 [权威读取验收计划](authoritative-read-acceptance.md) 为总清单。本页保留现有7项游戏强杀脚本与历史证据；新计划的缓存、冷恢复、DBProxy节点故障并未全部接入本脚本。

2026-09-17 后续代码已加入 [玩家驻留、独立回执和截止任务](player-residency-and-foreground.md)。下文真实数据库强杀报告是此前实现的基线，不是这些修改的验收结果。本轮仅运行29条针对性测试、2条恢复工具计划检查和无数据库真实RPC冒烟。下一轮需先重建当前制品及隔离DBProxy，再经授权执行故障测试，不能沿用旧制品或旧通过结论。

目标：验证真实游戏进程强杀后，真实 DBProxy/PostgreSQL 中已提交的玩家与世界状态可恢复；不是500玩家容量、热更、数据库故障或24小时长稳。保留原 MMORPG game 组，不替换它。

## 运行

推荐使用总清单的 `npm.cmd run test:acceptance -- build` 重建全部制品及镜像，再由该入口运行C组。单独使用旧入口时，除本包 `npm.cmd run build` 外，还需在DBProxy仓库执行 `cargo build --bin dbproxy_acceptance_probe`，并重建下述默认镜像标签；不能仅有宿主制品。需要 Docker 运行，且本机已存在 `tiangz-slg-dbproxy:dev`、`postgres:18.4-bookworm`、`redis:8.8.1-trixie` 镜像。脚本固定记录实际 DBProxy 镜像ID，不因标签存在就声称它是最新源码。

```powershell
# 只看计划，无数据库或Docker操作
npm.cmd run test:recovery
# 经用户授权后执行：新建隔离存储、强杀本轮游戏子进程
npm.cmd run test:recovery -- run --confirm isolated-slg-crash-test
```

Examples 统一入口：`npm.cmd run reliability -- plan --suite slg`，以及 `build/check/run --suite slg`。run 使用该入口原有的 `--confirm reset-local-validation-data-and-inject-faults` 确认，但 SLG 分支**不调用旧prepare/contracts，不清理旧演练库**。slg 不随 all 自动加入；拒绝 players/seconds 参数，防止误作长稳。

## 隔离与证据

- 每次新建随机名称 `slg-recovery-*` 的Compose项目、私有网络、PG/Redis命名卷和DBProxy；不访问现有SLG开发数据库，不停现有容器。
- DBProxy只绑定随机回环端口；PG/Redis不发布宿主端口。仅终止由当前脚本spawn并持有句柄的游戏进程。
- 复制当前游戏制品到 `temp/recovery/run-*`，记录宿主、Model、Hotfix哈希、DBProxy镜像ID、自有PID、故障边界和SQL快照。
- 结束后停止本轮容器，**不删除**容器/卷，便于复核。目录包含测试专用凭据，受Git忽略；不要把compose.json或目录整体上传公开平台。报告不包含令牌。
- 每项失败即停止，report.json为failed，收尾失败也不能通过。Ctrl+C请求有界收尾，不要强杀控制器；进程外强制结束无法保证清理，需按report中的项目名/PID核对。

## 用例矩阵

| 用例 | 注入点 | 关键断言 |
| --- | --- | --- |
| 建筑 | 提交送达DB前强杀；重试受理后再次强杀 | 未提交无扣费；重试只扣一次；恢复保留截止时间；到期只升一级 |
| 抽卡 | 提交响应到达代理、未交给游戏时强杀 | SQL中卡与扣费已提交；原命令重试不重抽、不重复扣费 |
| 武将升级 | 提交响应丢失并强杀 | 等级与粮食一起提交，恢复重试不重复升级 |
| 出征 | 提交前强杀；成功受理后再次强杀 | 兵力与地块预留同生共死，恢复保留队伍与截止时间 |
| 占领结算 | 到期事务响应丢失并强杀 | 玩家行军清除、幸存兵力、世界占领一致，重读不重复返兵 |
| 抢地 | 两玩家并发请求同一地块 | 仅一个预留成功，失败方不损失兵力 |
| 离线产粮 | 游戏停机65秒再恢复 | 按完整分钟补产、保留余数；重复读取不重复补产 |

使用正式生成的客户端SDK；故障代理读取DB公开长度帧，调用正式Rust protobuf解码，按连接/rpcId关联提交内已有操作号和JSON标记；丢ACK必须确认对应回包无错误，提交前故障收尾丢弃被扣住的请求，不编造opcode或绕过鉴权。SQL只读用于独立对账，不直接修改业务存档来模拟成功。已提交的判定依赖SQL记录，不仅凭代理看到响应。当前是关键边界矩阵，不声称每种操作的所有指令时点都穷举。

## 本次夹具补强（尚未实库复跑）

抽卡增加“战报随后变化，仍恢复原独立回执”；武将升级检查回执与按分钟扣费；抢地时扣住世界提交，使用第三条独立客户端连接验证无关驻留玩家2秒内返回；离线产粮容许合法跨分钟增产。`rpc-events.json`保留正式解码事件，不记录Hello令牌。下文8次强杀是历史轮次，新脚本增加回执场景后以实际报告计数为准。

## 失败教训

2026-09-17 首次隔离启动在 `run-0zuOOr` 失败：DBProxy连接PG被拒绝。PG初始化临时服务器可以响应Unix socket的pg_isready，但最终TCP尚未就绪。已改为 `pg_isready -h 127.0.0.1`，不靠固定睡眠掩盖。构建前还发现并修正测试Compose对象漏括号；以后先 node --check，再启动环境。失败记录保留，不计为游戏恢复通过。

最终状态以每次 `report.json` 为准；未运行的用例不得因脚本存在而标为已验收。

## 2026-09-17 验收结果

两轮业务矩阵均7/7通过，各8次游戏进程强杀（共16次），真实DBProxy/PostgreSQL读写与SQL独立对账；游戏进程和本轮演练容器均正常收尾。第一轮 `temp/recovery/run-PrX04d/report.json`；补强抢地粮食/兵力与最终预留清理断言后，经统一入口运行的最终轮为 `temp/recovery/run-iaAz8o/report.json`。最终报告包含控制器、宿主、Model、Hotfix、配置、协议锁哈希及镜像ID，已核对控制器哈希与最终源码一致。

另有15条玩法/假存储单测、7条统一计划测试、2条恢复入口安全测试通过；完整SLG build通过（保留原有LNK4098警告）。本轮没有新增或改动玩法规则/协议，build仅重建已有生成产物。

启动夹具的两次失败仍保留，上述“两轮通过”不包含它们。所有演练容器/卷保留但已停止，当前开发库容器持续运行未被改动。未验证500玩家、24小时、独立PlayerHost接管、Rust战斗服务持久结算；未执行原hotfix/dbproxy/MMORPG三组完整联合演练，不能把本结果替代它们。

第二次启动 `run-FygS2j` 被宿主拒绝：显式 runtime-root 必须同时包含 dist/ 与 configs/，即使启动JSON使用绝对路径也不能省略configs目录。已补目录，并让代理清理独立于游戏停止结果执行，防止启动失败时遗留监听句柄。此类夹具启动错误不能删宿主校验来绕过。
