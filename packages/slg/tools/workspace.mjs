import { spawn, execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile, unlink, lstat, mkdtemp, cp } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { findCreator } from "./creator.mjs";
import { slgRuntimeEnvironment } from "./local_environment.mjs";

const root = path.resolve(import.meta.dirname, "..");
const engine = path.resolve(process.env.TIANGZ_ENGINE_ROOT ?? path.join(root, "../../../TiangZ"));
const modules = path.join(root, "modules");
const client = path.join(root, "client/cocos");
const dist = path.join(root, "dist");
const config = path.join(root, "configs/dev/all-in-one.json");
const binary = path.join(engine, "target/debug", process.platform === "win32" ? "TiangZ.exe" : "TiangZ");
const env = { ...process.env, TIANGZ_MODULES_DIR: modules };
if (process.platform === "win32") {
  for (const key of ["CC", "CXX"]) if (/(gcc|g\+\+)(\.exe)?$/i.test(env[key] ?? "")) delete env[key];
}
const action = process.argv[2] ?? "check";
const actions = ["setup", "check", "build", "dev", "start", "smoke", "protocol-update", "client-open", "client-build"];
if (!actions.includes(action)) throw new Error(`未知命令 ${action}`);
if (!existsSync(path.join(engine, "node_modules/typescript"))) {
  throw new Error(`缺少 TiangZ 开发依赖：请在 ${engine} 运行 npm install；可用 TIANGZ_ENGINE_ROOT 指定宿主。`);
}
const requireEngine = createRequire(path.join(engine, "package.json"));
const { build } = requireEngine("esbuild");

if (action === "setup" || action === "protocol-update") {
  await tool("codegen_module_protocol.mjs", "--modules-dir", modules, ...(action === "protocol-update" ? ["--update-locks"] : []));
  await tool("prepare_game_modules.mjs", "--modules-dir", modules);
  await syncSdk(false);
  await check({ prepared: true });
} else if (action === "check") {
  await check();
} else if (action === "build") {
  await buildServer();
} else if (action === "dev") {
  await checkHost();
  await checkServer();
  await bundleServer();
  await start();
} else if (action === "start") {
  await check();
  await start();
} else if (action === "smoke") {
  await check();
  await smoke();
} else {
  await syncSdk(true);
  const creator = await findCreator();
  await run(creator, ["--project", client, ...(action === "client-build" ? ["--build", "platform=web-desktop;debug=true;startScene=23aeb321-d8b4-497b-8652-b31fb8a14513"] : [])], root, action === "client-build" ? [0, 36] : [0]);
}

async function tool(name, ...args) {
  await run(process.execPath, [path.join(engine, "tools", name), ...args], engine);
}

async function checkServer({ prepared = false } = {}) {
  await tool("game_modules.mjs", "validate", "--modules-dir", modules);
  if (!prepared) {
    await tool("prepare_game_modules.mjs", "--modules-dir", modules, "--check");
    await tool("codegen_module_protocol.mjs", "--modules-dir", modules, "--check");
  }
  await tool("typecheck_game_modules.mjs", "--modules-dir", modules);
}

async function check(options) {
  await checkServer(options);
  await syncSdk(true);
  await run(process.execPath, [path.join(engine, "node_modules/typescript/bin/tsc"), "--noEmit", "--strict", "--skipLibCheck", "--target", "ES2022", "--module", "ES2022", "--moduleResolution", "Bundler", path.join(client, "assets/scripts/SlgConnection.ts")]);
  await build({ entryPoints: [path.join(client, "assets/scripts/SlgBootstrap.ts")], bundle: true, platform: "browser", format: "esm", target: "es2022", external: ["cc"], tsconfig: path.join(client, "tsconfig.bundle.json"), write: false, logLevel: "warning" });
  if (existsSync(path.join(client, "temp/tsconfig.cocos.json"))) {
    await run(process.execPath, [path.join(engine, "node_modules/typescript/bin/tsc"), "-p", path.join(client, "tsconfig.json"), "--noEmit"]);
  } else {
    console.log("[SLG] Cocos 编辑器类型尚未生成：已通过连接层类型检查与客户端打包检查；不是编辑器运行验收。");
  }
  const scene = JSON.parse(await readFile(path.join(client, "assets/scenes/Main.scene"), "utf8"));
  if (scene[3].__type__ !== "98facepkUNMkK0ZCqGBzD+I") throw new Error("Main 场景脚本引用失效");
  console.log("[SLG] 检查通过");
}

async function buildServer() {
  await tool("codegen_module_protocol.mjs", "--modules-dir", modules);
  await tool("prepare_game_modules.mjs", "--modules-dir", modules);
  await syncSdk(false);
  await check({ prepared: true });
  await bundleServer();
  await run(process.platform === "win32" ? "cargo.exe" : "cargo", ["build", "--bin", "TiangZ"], engine);
}

async function bundleServer() {
  await tool("build_runtime_bundles.mjs", "--modules-dir", modules, "--out-dir", dist);
  await tool("build_game_config_data.mjs", "--out-dir", dist, "--initial");
}

async function checkHost() {
  if (!existsSync(binary)) throw new Error("宿主未构建，请先运行 npm run build");
  const expected = JSON.parse(await readFile(path.join(engine, "package.json"), "utf8")).version;
  const actual = execFileSync(binary, ["--version"], { encoding: "utf8", windowsHide: true, timeout: 5000 }).trim();
  if (actual !== `TiangZ ${expected}`) throw new Error(`宿主版本不一致：${actual}，需要 ${expected}；请运行 npm run build`);
}

async function start() {
  await checkHost();
  await freePorts();
  if (!existsSync(binary) || !existsSync(path.join(dist, "model.js"))) throw new Error("尚未构建，请先运行 npm run build");
  console.log("[SLG] 启动只读世界 ws://127.0.0.1:18001；输入 shutdown 后回车停止。源码变更后重启 npm run dev。");
  await run(binary, [`--runtime-root=${root}`, config]);
}

async function freePorts() {
  const settings = JSON.parse(await readFile(config, "utf8"));
  for (const port of [settings.scenes[0].port, settings.process.observability.health.port]) {
    await new Promise((resolve, reject) => {
      const server = createServer();
      server.once("error", () => reject(new Error(`端口 ${port} 已占用；不会停止其他进程。请先退出已有 SLG 服务。`)));
      server.listen(port, "127.0.0.1", () => server.close(resolve));
    });
  }
}

async function smoke() {
  await checkHost();
  if (!existsSync(binary) || !existsSync(path.join(dist, "model.js"))) throw new Error("请先运行 npm run build");
  await mkdir(dist, { recursive: true });
  const probe = path.join(dist, "connection-smoke.mjs");
  await build({ entryPoints: [path.join(root, "tools/smoke.ts")], bundle: true, platform: "node", format: "esm", target: "node22", tsconfig: path.join(client, "tsconfig.bundle.json"), outfile: probe });
  const temporary = await mkdtemp(path.join(os.tmpdir(), "tiangz-slg-smoke-"));
  await mkdir(path.join(temporary, "configs"));
  await cp(dist, path.join(temporary, "dist"), { recursive: true });
  const settings = JSON.parse(await readFile(config, "utf8"));
  delete settings.process.persistence;
  settings.process.observability.health.port = await availablePort();
  do { settings.scenes[0].port = await availablePort(); }
  while (settings.scenes[0].port === settings.process.observability.health.port);
  const startup = path.join(temporary, "smoke.json");
  await writeFile(startup, JSON.stringify(settings));
  const child = spawn(binary, [`--runtime-root=${temporary}`, startup], { cwd: temporary, env: { ...env, TIANGZ_WATCHER_CONTROL: "stdin" }, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  let launchError;
  child.once("error", error => { launchError = error; });
  child.stdout.on("data", bytes => process.stdout.write(bytes));
  child.stderr.on("data", bytes => process.stderr.write(bytes));
  const exited = new Promise(resolve => child.once("close", resolve));
  try {
    const { verify } = await import(pathToFileURL(probe).href);
    await verify(() => { if (launchError) throw launchError; if (child.exitCode !== null) throw new Error(`SLG 提前退出 ${child.exitCode}`); }, settings.scenes[0].port);
  } finally {
    if (child.stdin.writable) child.stdin.end("shutdown\n");
    let forced = false;
    const timeout = setTimeout(() => { if (child.exitCode === null) { forced = true; child.kill(); } }, 8000);
    await exited;
    clearTimeout(timeout);
    if (forced || child.exitCode !== 0) throw new Error(`SLG 测试进程未正常停机：${forced ? "超时强制退出" : child.exitCode}`);
  }
  console.log("[SLG] 真实 WebSocket 世界快照联调通过；测试进程已退出");
}

async function availablePort() {
  return new Promise((resolve, reject) => {
    const server = createServer(); server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

async function files(directory, prefix = "") {
  if (!existsSync(directory)) return [];
  if ((await lstat(directory)).isSymbolicLink()) throw new Error(`拒绝 SDK 符号链接：${directory}`);
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error(`拒绝 SDK 符号链接：${entry.name}`);
    if (entry.isDirectory()) result.push(...await files(path.join(directory, entry.name), `${prefix}${entry.name}/`));
    else result.push(`${prefix}${entry.name}`);
  }
  return result;
}

// 只同步生成器专属目录中的 TS；保留 Creator 的 meta，拒绝未知业务文件。
async function syncSdk(checkOnly) {
  const source = path.join(modules, "slg/generated/typescript");
  const target = path.join(client, "assets/scripts/Generated/SDK");
  const expected = (await files(source)).filter(file => file.endsWith(".ts"));
  if (!expected.length) throw new Error("模块 SDK 缺失，请先运行 npm run setup");
  const present = await files(target);
  if (present.some(file => !file.endsWith(".ts") && !file.endsWith(".meta"))) throw new Error("SDK 专属目录包含未知文件，拒绝覆盖");
  const stale = present.filter(file => file.endsWith(".ts") && !expected.includes(file));
  const changes = [];
  for (const file of expected) {
    const bytes = await readFile(path.join(source, file));
    const output = path.join(target, file);
    if (!existsSync(output) || !bytes.equals(await readFile(output))) changes.push({ output, bytes });
  }
  if (checkOnly && (changes.length || stale.length)) throw new Error("Cocos SDK 过期，请运行 npm run setup；检查不会修复文件");
  if (!checkOnly) {
    for (const { output, bytes } of changes) { await mkdir(path.dirname(output), { recursive: true }); await writeFile(output, bytes); }
    for (const file of stale) { await unlink(path.join(target, file)); }
    if (stale.length) console.log(`[SLG] 移除 ${stale.length} 个过期生成 TS 文件，可通过协议生成恢复`);
  }
}

async function run(command, args, cwd = root, successCodes = [0]) {
  const childEnv = command === binary ? { ...await slgRuntimeEnvironment(env), TIANGZ_WATCHER_CONTROL: "stdin" } : env;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: childEnv, stdio: "inherit", windowsHide: true });
    child.once("error", reject);
    child.once("exit", (code, signal) => successCodes.includes(code) ? resolve() : reject(new Error(`${path.basename(command)} 失败：${signal ?? code}`)));
  });
}
