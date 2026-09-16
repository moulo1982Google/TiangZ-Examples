# SLG 独立 DBProxy

本目录现位于 Examples/packages/slg/infra/dbproxy；命令在 packages/slg 执行。迁移保留原 .env、Compose 项目名和命名卷，不自动重建运行中的容器。下次显式运行 dbproxy:up 会使用新的配置挂载位置；不要继续使用旧 TiangZ-SLG 路径启动或重建。

Compose 项目名 `tiangz-slg-dbproxy`，包括 DBProxy、PostgreSQL 和 Redis。所有存储卷与默认网络由该项目独占，不使用 Wasteland 或其他工程的容器、凭据、数据卷。

- DBProxy：`127.0.0.1:18700`
- 健康接口：`http://127.0.0.1:18900/ready`、`/dependencies`
- PostgreSQL/Redis：仅容器网络可达，不发布宿主端口。
- Redis AOF 开启、noeviction；PostgreSQL 保存权威数据。命名卷保留数据，但不是备份或高可用。

在游戏根目录运行 `npm run dbproxy:up`。首次随机生成 `.env` 中的三个独立密钥，之后保留，不覆盖；该文件被 Git 忽略。游戏启动脚本只把认证令牌注入服务端进程，不复制数据库密码到客户端。

`dbproxy:check` 检查依赖，`dbproxy:smoke` 使用 TiangZ 现有 SDK/Repository 验收脚本，在本独立库的 `org.tiangz.module-migration.acceptance` namespace 留下一条唯一测试记录，验证写入、迁移、跨进程重读及旧写入拒绝。它不是 SLG 账号存档功能，也不测试容量或故障恢复。

`dbproxy:stop` 只停止本组服务，不删卷。禁止无授权执行 `down -v`。不要删除密钥文件后直接为已有数据库卷重新生成密码；已有卷凭据不会随环境变量自动轮换。

镜像从同级 TiangZ-DBProxy 的 Dockerfile.dev 构建，独立标签 `tiangz-slg-dbproxy:dev`；不改动 DBProxy 源码。首次需要下载 Rust 依赖并编译，后续复用 Docker 缓存。容器内观测接口显式允许非回环绑定，宿主只发布到回环，禁止公网反代。
