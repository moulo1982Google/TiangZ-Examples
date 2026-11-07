# cocos_client3D

这是 TiangZ 的 Cocos Creator 3.8.8 3D 导航、动态障碍和 TypeScript Client SDK 演示工程。

## 编辑器预览

在同级 `TiangZ` 宿主和 `TiangZ-Examples` 分别执行 `npm ci`。然后在 Examples 根目录执行：

```powershell
npm.cmd run build -- --package mmorpg
npm.cmd run codegen:sdk
npm.cmd run sdk:sync
npm.cmd run start -- --package mmorpg
```

用 Cocos Creator 3.8.8 打开本目录，再打开 `assets/scene.scene` 并点击 Preview。首次使用先在登录界面注册账号；服务端使用内存状态，重启后需重新注册。输入 `shutdown` 并回车可停止服务端。

Windows 上完成首次构建后，也可以双击 Examples 根目录的 `start-mmorpg.bat` 启动服务端。

编辑器预览使用 `assets/resources/Config/tiangz-local.json`，默认连接本机 `127.0.0.1:7000`。发布包读取 `tiangz-external.json`，不要为了预览修改发布配置。服务端普通启动使用固定端口，运行前确认端口空闲。

## Web 构建

以下命令在 `TiangZ-Examples` 仓库根目录执行，先将 `COCOS_CREATOR_388` 设置为 Creator 3.8.8 的可执行文件：

```powershell
$env:COCOS_CREATOR_388 = "<CocosCreator.exe 的完整路径>"

# 桌面 Web Release
npm run build:cocos3d:web

# 手机横屏 Web Release
npm run build:cocos3d:mobile

# 外网双入口 Release：一次构建桌面根路径和手机 /m/ 路径
npm run build:cocos3d:external
```

输出分别是：

```text
build/standard-web/
build/standard-mobile/
```

外网发布使用统一命令后，还会整理出不会混淆路径的目录：

```text
build/external/desktop/  -> 网站根路径 /
build/external/m/        -> 网站 /m/，仅此入口使用横屏移动版
build/external/manifest.json
```

`standard-web`始终是`web-desktop`，根路径保持桌面版正常布局；`standard-mobile`始终是
`web-mobile`并传入`landscape`，不能把`build/external/m`的内容复制到网站根目录。

手机包会自动加入`viewport-fit=cover`、安全区适配、PWA manifest，以及支持Fullscreen API的浏览器首次触摸沉浸模式。
普通iOS Safari不允许网页强制隐藏地址栏；要获得真正的无浏览器抬头体验，需要在Safari中选择“添加到主屏幕”，再从主屏幕启动`/m/`。

Debug 构建只使用带 `:debug` 后缀的 npm 命令。统一脚本会固定 Creator 3.8.8、清除
`ELECTRON_RUN_AS_NODE`、清理自己的标准输出目录，并检查 `index.html`、`application.js`
和 `assets` 是否完整；不要手工拼接 `CocosCreator.exe --build`。

修改 MMORPG 协议或游戏配置后，在 Examples 根目录重新运行 `npm run build -- --package mmorpg`、`npm run codegen:sdk` 和 `npm run sdk:sync`，再构建客户端；不要手改生成的 SDK 或协议锁。
第一次迁移到新机器可先执行 `npm run check:cocos-build` 做无构建预检。Cocos Native
需要先生成原生工程，再用 CMake/Visual Studio 编译，不属于 Web 构建产物。

## 本地验证

`npm run check:clients` 在存在 Creator 类型声明时会检查完整 Cocos 类型。旧客户端曾因任务领奖缺少 `rewardChoiceId`、方向移动缺少位置快照字段而报 TS2345；本 Demo 的任务没有奖励分支，使用 `rewardChoiceId: 0`，普通移动显式设置 `hasPositionSnapshot: false`。不要修改生成类型或把位置快照用于普通客户端以绕过检查。

`npm run smoke -- --package mmorpg` 使用临时目录、随机端口和内存数据验证登录、Map 1 和本客户端使用的 Map 100、方向移动与停止、角色切换和正常停机；它不替代 Creator 画面交互验收或真实数据库验证。
