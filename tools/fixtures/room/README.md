# 单进程房间消费方

从 Examples 运行 `npm run test:room`，可用 `TIANGZ_ENGINE_ROOT` 选择宿主；宿主须已安装匹配依赖并完成 debug 构建。工具创建独立临时工程，通过正式模块脚手架、协议生成器和工程构建/检查/运行入口验收。生成物与日志保留在 `dist/room-consumer-*`，不使用既有端口、进程或数据库。

一个 RoomScene 的 ordered mailbox 处理同步操作，RoomStoreComponent 持有最多 16 个房间、每房 8 名成员，Hotfix System 实现行为，四个 Handler 仅适配生成协议。客户端直连已知 Scene 地址，再按 roomId 访问该 Scene 内的房间，不需要 Location/MapHost 或全局寻址服务。

验证创建、加入、离开、断线后新 Socket 读取快照、错误凭据不改状态、重复加入、并发加入版本顺序和容量拒绝，最后由宿主工具检查正常停机。源码按状态、行为、协议入口拆分；没有额外服务层。

这是内存演示：断线保留成员，空房删除，重启全部丢失。resumeKey 由测试客户端提供，仅演示重连流程，不是生产鉴权或单会话接管；持相同凭据的旧连接仍可请求。没有持久化、过期清理、账号系统、跨进程迁移或故障恢复。
