# SLG 协作入口

- 接续交付/CI/CD 工作先读 docs/delivery-handoff.md。delivery 脚本只面向本地隔离验收，不自动发布生产；换机先保存未提交源码并重建生成物，不迁移 temp 凭据。

- 开发体验第一优先级。优先完成可操作业务闭环，减少手工登记、路径配置、重复命令和等待。
- 本包为独立 TiangZ 模块 + Cocos Creator 3.8.8 TypeScript 客户端。先读 README.md、docs/architecture.md；开发流程统一以 README 为准，框架接入遵循 ../../../TiangZ/AGENTS.md。
- 保留已有修改。游戏规则留在 modules/slg；不要复制引擎、复用其他游戏数据或修改 Core 特例。
- Model 稳定状态与类型、Hotfix 行为与薄 Handler；禁止 Hotfix 可变模块级状态。协议与 SDK 必须生成，锁仅经显式 protocol:update 修改。
- 当前是只读快照底座，不要把登录、采集、持久化、自动热更标记为完成。
- 默认验收 npm run check、npm run build、npm run smoke；Creator 画面和真实 DBProxy 验证单独说明。不启动长稳/大规模测试或操作生产环境。
