# SLG 基础玩法与复测

2026-09-17：这是一套用于检验模块开发和后续恢复测试的最小玩法，不是生产 SLG。全部规则在本包，不修改引擎游戏规则。

## 怎么玩

在本包执行 `npm.cmd run build`、`npm.cmd run dev`，再执行 `npm.cmd run client:open`，打开 Main 场景预览。持久模式需要先准备本包专用 DBProxy（README 的 setup/dbproxy:up）；不要复用其他游戏数据。默认仅本机访问，无登录鉴权，不可开放公网。

- 初始 3000 粮食、100 士兵、一名边军校尉。浏览器保存开发玩家名和未确认操作，刷新不会主动换号。
- 主城、农场、兵营：点击升级，花费当前等级 × 200 粮食，等待当前等级 × 10 秒，最高 10 级。本版建筑升级只验证等级、扣费、定时完成；尚无等级带来的产量或解锁加成。
- 每完整分钟自动增加 100 粮食，离线时间也按完整分钟补算，保留不足一分钟的余量，上限十亿。当前产量固定，农场等级不影响产量。
- 抽武将花费 300 粮食：边军校尉 60%、疾风女将 30%、玄甲统领 10%。重复获得增加张数。仅免费演示，不接支付。
- 点击武将切换选择；升级花费当前等级 × 100 粮食，最高 20 级，出征中的武将不能升级。征兵按钮每次购买 20 人，每人 10 粮食。
- 点击中立地块再出征：20 士兵、100 粮食，10 秒到达，每人同时一支队伍。出征即预留地块，其他人不能抢同一预留地块。战力为 `200 + 武将等级×50 + 武将编号×20`，防御为 `地块编号×100`；胜利占领并返还 18 人，失败返还 10 人。没有独立返程、采集、PvP；已占领地块不可再次攻击。

UI 每两秒刷新。服务端按建筑/行军截止时间登记一次性定时器，最多登记 32 个开发玩家；读取快照也会结算。资源以时间差计算，不以定时器触发次数计算。默认驻留 5 分钟，切前台同步当前快照，详见 [驻留与前台恢复](player-residency-and-foreground.md)。

## 从哪里看代码

| 手写文件 | 职责 |
| --- | --- |
| `modules/slg/src/model/SlgState.ts` | 玩家、世界、建筑、武将与行军数据 |
| `modules/slg/src/model/SlgWorldScene.ts` | 场景及组件状态、待确认事务 |
| `modules/slg/src/hotfix/Gameplay.ts` | 纯玩法规则、截止时间结算；数值暂在这里，尚未接 Luban |
| `modules/slg/src/hotfix/SlgGameSystem.ts` | 读取、幂等、结算、原子持久提交 |
| `modules/slg/src/hotfix/SlgWorldSystem.ts` | 挂载组件与方法名定时器 |
| `modules/slg/src/hotfix/handlers/GameHandler.ts` | 薄 RPC 入口 |
| `modules/slg/proto/Slg_C_32000.proto` | 客户端协议源；修改后显式 protocol:update |
| `client/cocos/assets/scripts/SlgBootstrap.ts` | 按钮、选择、快照展示、未确认操作重试 |
| `tools/gameplay*.test.mjs`、`tools/smoke.ts` | 规则、事务契约及真实 RPC 验证 |

协议 codec、SDK、generated/Generated/dist 都是生成物，不手改。Model 变化需要重建重启。

## 状态与重试约定

### 当前服务器帧做什么

Runtime Pump 与固定业务帧不同：宿主由网络/完成通知等事件驱动，推进时钟、到期 Timer、Scene mailbox，并收集出站回包和指标；Game 的固定 Update 默认 50ms，只调用已注册目标。当前 SLG 没有注册业务 Update，不逐帧模拟士兵移动，也没有业务 latest/Delta 广播。框架有通用出站队列，不等于游戏已产生可覆盖状态。

当前 SlgWorldSystem 通过一次性 Tick 启动任务索引恢复；SlgGameSystem 为任务截止、驻留到期和失败重试安排方法名 OnPlayerDue Timer，不再每秒扫描玩家。Timer 或 RPC 按截止时间补算，有变化才提交。客户端每 2 秒请求快照，Timer 结算没有主动推送；定时器不保证精确实时，失败重试有上限。

后续需要推送时，资源/等级等当前值可按脏数据合并发给本人；地块所有权按观察范围推送，倒计时发送截止时间即可。战报、抽卡与结算事实必须定义可靠恢复和幂等，不能只放可覆盖 latest。实时战斗或动态副本若确需连续模拟，再在对应节点注册 Update，不要求整个 SLG 每帧扫描玩家和地图。

当前单个 SlgWorldScene 协调玩法，不是独立 PlayerHost/World 部署。DBProxy 中玩家和世界分别存储在 `slg.demo.player.v1`、`slg.demo.world.v1`，键前缀固定 `realm-41`。CommitRecords 仅提交受影响记录：玩家操作只写玩家，地图变更才将玩家与世界原子提交。玩家各自互斥，地图变更单独协调；仍有单世界争用，不能多进程共同持有权威世界缓存。

客户端每人只允许一个未确认命令，重试同一序号和参数。最新命令回执避免重复扣费；业务拒绝也记录序号，不让无效请求无限重放。只保留最新回执，不支持任意历史请求重放或同玩家多标签并发操作。服务端忙时返回可重试错误。

持久提交丢失回包时，Model 保存完整待确认事务，下次先重试同一事务，不能换操作号重新扣款。版本冲突要求重读；未知 schema 拒绝加载，不重置资产。建筑、生产和行军保存时间戳，由方法名 OnPlayerDue 或快照读取驱动，不使用业务 await sleep。独立 receipt 保存最新操作结果，不随战报覆盖。

是否持久取决于进程 `persistence.dbProxy` 配置，响应/UI 明示模式。配置数据库后故障必须报错，禁止悄悄降级成内存。无配置内存模式只供隔离 smoke，进程退出数据丢失。

独立 Rust 战斗服务练习仍在 validation/battle；本版地块使用可重算的简单战斗规则，尚未接入该服务的持久任务和结算。

## 测试步骤和当前证据

在本包依次运行：

```powershell
npm.cmd run test:gameplay
npm.cmd run build
npm.cmd run smoke
```

- 单测共 29 条：原规则与事务检查，加上驻留零 Load、到期重读、离线任务恢复、独立回执、受影响记录提交、玩家并发/地图协调、容量和有界重试、前台连接代次隔离；明细见驻留说明。
- smoke 启动独立临时目录和随机端口的真实游戏进程，明确删除数据库配置。经 WebSocket 和生成 SDK 验证快照、升级、重复命令、抽卡、武将升级、出征、拒绝第二次出征，等待约 10 秒验证完成及占领，最后正常停机。
- 本次 29 条单测、build 和内存 RPC smoke 已通过；smoke 新增断开 11 秒后重连与回执恢复，临时目录标识为 tiangz-slg-smoke-EwiOLc。另有 2 条 recovery 工具只读计划测试通过，不等于执行故障。构建仍有原有 LNK4098 警告。
- **后续恢复验收**：新增独立 slg 组验证真实DBProxy/PostgreSQL下游戏强杀，具体记录见 [恢复测试](recovery-test.md)。假存储测试本身不等于真实崩溃恢复；原 game 组仍为MMORPG，未替换。
- **仍未验收**：新增 Cocos 画面、三类完整联合故障、500玩家及24小时长稳；本次小规模游戏强杀不扩展为这些项目的授权或通过结论。

### 本次失败教训：桥存在不等于数据库已配置

首次 smoke 报 `DBProxy is not configured for this Process`。原因是把 IsHostDbProxyAvailable 当成数据库配置/连通性判断；它只能说明宿主安装了桥。已改为从进程配置决定持久模式，有配置时由真实调用暴露故障，禁止捕获故障后改用内存。修复后重建、重跑 smoke 通过。旧失败目录为 `tiangz-slg-smoke-Lipipu`，首次修复通过目录为 `tiangz-slg-smoke-1lYi0J`（系统临时目录，可能被清理）；长期证据以本节命令和覆盖边界为准。
