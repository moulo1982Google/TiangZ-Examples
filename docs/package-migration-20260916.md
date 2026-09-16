# 按包构建验收（2026-09-16）

SLG 完整迁入 `packages/slg`，包括 Cocos 3.8.8 工程、模块、协议锁、配置、工具、本地忽略文件和编辑器元数据。独立 Git 元数据移至工作区 `.build-tmp/slg-repository-before-package/.git` 保留，不作为嵌套仓库；未提交或推送。

`packages/mmorpg` 拥有独立启动配置、显式模块安装点和 dist；可复用 MMORPG/Bench 模块与六个客户端保留原根目录，避免破坏外部消费者。`tiangz.example.json` 声明包名和允许的操作。根 build/check/start/smoke 必须显式传 `--package slg|mmorpg`；未知、重复、路径逃逸参数及不支持的操作均报错。

## 本次实际验证

- `npm run build -- --package slg`、`check`、`smoke`：全部通过；快照内容和重复 RPC 一致。
- `npm run build -- --package mmorpg`、`check`、`smoke`：全部通过；真实登录、角色、进图/AOI、退出与立即切换角色通过。
- `npm run test:packages`：10 项通过；验证包选择、独立输出、非法参数、外部工作目录和只读 dry-run。
- `node tools/package_isolation_self_test.mjs`：完整重建 SLG 后，MMORPG 生成物与包制品的内容哈希和修改时间均未改变；SLG 构建清单只有 org.tiangz.slg。
- `npm run check:clients`：原六个客户端的现有静态检查与 SDK 一致性检查通过；不代表正式编辑器平台构建。
- Examples 生成清单校验通过；SDK、协议和编辑器路径经工具重新生成，没有手改协议锁。
- TiangZ `npm run verify:quick`：28/28 通过；`test:game-modules` 与嵌套联接安装/编辑器路径回归通过。
- SLG Compose `config --quiet` 校验通过；本地密钥和构建输出仍被 Git 忽略。

按后端开发规范修复了宿主发现层的真实路径处理：生成路径以源码真实目录为基准，安装位置保留为 installedRoot。相同模块经不同深度联接安装，不再反复改写错误的相对路径；ModuleGame/WoW335 的编辑器配置已用工具同步。

## 使用与边界

打开 Cocos 时请重新选择 `packages/slg/client/cocos`；VS Code 可打开 `packages/slg/TiangZ-SLG.code-workspace`。日常命令见 [根 README](../README.md)。构建只负责服务端制品，Cocos 正式构建使用 client:build -- --package slg。

两项联机冒烟都只使用自己的临时目录和随机本地端口，不连接既有数据库。未启动、重建或停止现有容器与服务；SLG Compose 项目名、端口、凭据和命名卷保持不变，下次显式部署才采用新的配置挂载位置。未执行 Creator 画面/正式平台构建、压测、长稳、数据库故障或生产发布。

MMORPG check 目前沿用生成后检查流程，SLG check 保持只读；共享模块生成应串行运行。原根目录 server:* 命令保留兼容用途，日常优先用带包名的入口，以免混淆根 dist 与包 dist。
