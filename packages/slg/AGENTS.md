# SLG 协作入口

- SLG三类复测（热更、DBProxy故障、游戏崩溃恢复）先读 docs/authoritative-read-acceptance.md，区分已有脚本、待补夹具和历史通过报告。当前脚本包含A/B/C/D及25个H/J子项；smoke30为20项目关键路径，acceptance90为42项目全量单轮及观察窗口，两种profile通过均不等于完整三轮矩阵通过。文档更新不自动启动故障/容量/长稳；game组仍是MMORPG，不能替代SLG验收。

- 接续交付/CI/CD 工作先读 docs/delivery-handoff.md。delivery 脚本只面向本地隔离验收，不自动发布生产；换机先保存未提交源码并重建生成物，不迁移 temp 凭据。

- 开发体验第一优先级。优先完成可操作业务闭环，减少手工登记、路径配置、重复命令和等待。
- 本包为独立 TiangZ 模块 + Cocos Creator 3.8.8 TypeScript 客户端。先读 README.md、docs/architecture.md；开发流程统一以 README 为准，框架接入遵循 ../../../TiangZ/AGENTS.md。
- 保留已有修改。游戏规则留在 modules/slg；不要复制引擎、复用其他游戏数据或修改 Core 特例。
- Model 稳定状态与类型、Hotfix 行为与薄 Handler；禁止 Hotfix 可变模块级状态。协议与 SDK 必须生成，锁仅经显式 protocol:update 修改。
- 当前已有单服基础玩法，先读 docs/gameplay-demo.md。玩家/世界分记录提交，但仍共用一个 SlgWorldScene；不要声称已实现独立 PlayerHost、登录鉴权或跨进程战斗结算。真实数据库下的游戏强杀验收范围见 docs/recovery-test.md，不等于数据库自身故障或长稳。业务延迟使用持久截止时间与方法名定时器，禁止 await 时间。
- 默认验收 npm run check、npm run build、npm run smoke；Creator 画面和真实 DBProxy 验证单独说明。不启动长稳/大规模测试或操作生产环境。
