import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdir, mkdtemp, writeFile, cp } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname);
const engine = path.resolve(root, "../../../../../TiangZ");
const require = createRequire(path.join(engine, "package.json"));
const { build } = require("esbuild");
const { resolveModuleRuntimeBinary } = await import(pathToFileURL(path.join(engine, "tools/module_runtime_binary.mjs")));
const { LocalReplicaController } = await import(pathToFileURL(path.join(engine, "tools/local_replica_controller.mjs")));
const action = process.argv[2] ?? "verify";
const requestScope = { realmId: "realm-1", logicVersion: "lcg-v1", configVersion: "fixture-v1" };
if (!["build", "verify"].includes(action)) throw new Error("use build or verify");
const modules = path.join(root, "modules");
async function tool(name, ...args) {
  const child = spawn(process.execPath, [path.join(engine, "tools", name), "--modules-dir", modules, ...args], { cwd: engine, stdio: "inherit", windowsHide: true });
  await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", code => code === 0 ? resolve() : reject(new Error(`${name}: ${code}`))); });
}
if (action === "build") {
  for (const name of ["prepare_game_modules.mjs", "codegen_module_protocol.mjs", "codegen_module_native.mjs"]) await tool(name);
  await tool("build_runtime_bundles.mjs", "--out-dir", path.join(root, "dist"));
  await tool("build_game_config_data.mjs", "--out-dir", path.join(root, "dist"), "--initial");
  await tool("build_module_native.mjs");
} else {
  const binary = await resolveModuleRuntimeBinary({ engineRoot: engine, modulesDirectory: modules });
  await mkdir(path.join(root, "temp"), { recursive: true });
  const runRoot = await mkdtemp(path.join(root, "temp", "run-"));
  await mkdir(path.join(runRoot, "configs"));
  await cp(path.join(root, "dist"), path.join(runRoot, "dist"), { recursive: true });
  await build({ entryPoints: [path.join(root, "client.ts")], bundle: true, platform: "node", format: "esm", outfile: path.join(runRoot, "client.mjs") });
  const { connect } = await import(pathToFileURL(path.join(runRoot, "client.mjs")));
  const managerPort = await freePort();
  const managerScene = { name: "manager", sceneType: "BattleManager", ip: "127.0.0.1", port: managerPort, protocol: "auto", audience: "mixed" };
  const owned = [];
  const events = [];
  let managerConnection;
  let controller;
  let report;
  async function start(name, type, worker) {
    const port = worker ? await freePort() : managerPort;
    const health = await freePort();
    const config = path.join(runRoot, "configs", `${name}.json`);
    await writeFile(config, JSON.stringify({ process: { name, identity: { originServerId: 93, workerId: worker }, observability: { health: { ip: "127.0.0.1", port: health } } },
      scenes: [{ name, sceneType: type, ip: "127.0.0.1", port, protocol: "auto", audience: "mixed" }], knownScenes: worker ? [managerScene] : [] }));
    const child = spawn(binary, [`--runtime-root=${runRoot}`, config], { cwd: runRoot, env: { ...process.env, TIANGZ_WATCHER_CONTROL: "stdin" }, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    const item = { child, name, port, logs: "", exited: false, code: undefined };
    item.done = new Promise(resolve => child.once("close", code => { item.exited = true; item.code = code; resolve(code); }));
    child.on("error", error => { item.logs += error.message; });
    child.stdin.on("error", error => { item.logs += error.message; });
    for (const stream of [child.stdout, child.stderr]) stream.on("data", data => { item.logs = (item.logs + data).slice(-40000); });
    owned.push(item);
    try { await until(async () => { if (item.exited) throw new Error(`${name} exited: ${item.logs}`); try { return (await fetch(`http://127.0.0.1:${health}/ready`, { signal: AbortSignal.timeout(300) })).ok; } catch { return false; } }, 15000); }
    catch (error) { await stop(item); throw error; }
    events.push({ event: "started", name });
    return item;
  }
  async function stop(item) {
    if (item.exited) { if (item.code !== 0) throw new Error(`${item.name} exited abnormally: ${item.logs}`); return; }
    if (item.child.stdin.writable) item.child.stdin.end("shutdown\n");
    let forced = false;
    const timer = setTimeout(() => { forced = true; item.child.kill(); }, 8000);
    try { const code = await item.done; if (forced || code !== 0) throw new Error(`${item.name} stop failed: ${item.logs}`); }
    finally { clearTimeout(timer); await writeFile(path.join(runRoot, `${item.name}.log`), item.logs); }
    events.push({ event: "stopped", name: item.name });
  }
  try {
    await start("manager", "BattleManager", 0);
    managerConnection = await connect(managerPort);
    const manager = managerConnection.client;
    controller = new LocalReplicaController({ min: 2, max: 3,
      start: id => start(`worker-${path.basename(runRoot).toLowerCase()}-${id}`, "BattleHost", id),
      drain: async item => (await manager.drain({ node: item.name })).idle, stop });
    await until(async () => { await controller.reconcile(2); return (await manager.overview({})).workers.filter(w => w.live).length === 2; });
    console.log("[battle] 2 个执行进程已注册");
    const inputs = Array.from({ length: 24 }, (_, i) => ({ ...requestScope, battleId: `battle-${i}`, seed: i + 1, rounds: 200000, delayMs: 250 }));
    for (const input of inputs) assert.equal((await manager.submit(input)).state, "queued");
    assert.notEqual((await manager.submit(inputs[0])).state, "conflict");
    assert.equal((await manager.submit({ ...inputs[0], seed: 99 })).state, "conflict");
    let pressureSince = 0;
    let peak = 2;
    await until(async () => {
      const view = await manager.overview({});
      if (view.queued > 0) pressureSince ||= Date.now(); else pressureSince = 0;
      const desired = pressureSince && Date.now() - pressureSince >= 150 ? 3 : 2;
      if (desired === 3) await controller.reconcile(3);
      peak = Math.max(peak, view.workers.filter(w => w.live).length);
      return view.done === inputs.length;
    }, 20000);
    assert.equal(peak, 3);
    const used = new Set();
    for (const input of inputs) {
      const result = await manager.inspect({ realmId: input.realmId, battleId: input.battleId });
      assert.equal(result.state, "done"); assert.equal(result.result, simulate(input.seed, input.rounds)); used.add(result.node);
    }
    assert.equal(used.size, 3);
    console.log("[battle] 队列触发 2→3，24 场确定性 Rust 结果正确，重复请求未增加任务");
    // 对仍在执行的节点先排空，检查排空确认前未停止。 / Drain an active node before allowing process stop.
    for (let i = 24; i < 30; i++) await manager.submit({ ...requestScope, battleId: `battle-${i}`, seed: i, rounds: 200000, delayMs: 250 });
    const last = [...controller.instances.values()].at(-1).resource;
    await until(async () => (await manager.overview({})).workers.some(w => w.node === last.name && w.busy));
    await controller.reconcile(2);
    assert.equal(last.exited, false);
    await until(async () => { await controller.reconcile(2); return controller.instances.size === 2; });
    await until(async () => (await manager.overview({})).done === 30);
    assert.equal(last.exited, true);
    assert.equal((await manager.overview({})).unknown, 0);
    console.log("[battle] 3→2：停止接单、完成在途任务、确认排空、正常退出");
    // 再验证无人为缩容命令的空闲策略。 / Also exercise idle-driven downscaling without a manual target change.
    await until(async () => { await controller.reconcile(3); return (await manager.overview({})).workers.filter(w => w.live && !w.draining).length === 3; });
    let idleSince = 0;
    await until(async () => {
      const view = await manager.overview({});
      if (!view.queued && !view.running) idleSince ||= Date.now(); else idleSince = 0;
      if (idleSince && Date.now() - idleSince >= 500) await controller.reconcile(2);
      return controller.instances.size === 2;
    });
    console.log("[battle] 连续空闲触发自动缩容，未超过 3 个执行进程上限");
    assert.equal((await manager.submit({ ...requestScope, battleId: "invalid", seed: 1, rounds: 0, delayMs: 0 })).state, "invalid");
    const admissions = await Promise.all(Array.from({ length: 64 }, (_, i) => manager.submit({ ...requestScope, battleId: `capacity-${i}`, seed: i, rounds: 1, delayMs: 250 })));
    assert(admissions.some(result => result.state === "full"));
    assert(admissions.every(result => ["queued", "full"].includes(result.state)));
    assert((await manager.overview({})).queued <= 32);
    let completed = 30 + admissions.filter(result => result.state === "queued").length;
    await until(async () => (await manager.overview({})).done === completed, 20000);
    for (let i = 24; i < 30; i++) assert.equal((await manager.inspect({ realmId: requestScope.realmId, battleId: `battle-${i}` })).result, simulate(i, 200000));
    for (let i = 0; i < admissions.length; i++) {
      const result = await manager.inspect({ realmId: requestScope.realmId, battleId: `capacity-${i}` });
      if (admissions[i].state === "queued") { assert.equal(result.state, "done"); assert.equal(result.result, simulate(i, 1)); }
      else assert.equal(result.state, "missing");
    }
    console.log("[battle] 有界队列满载明确拒绝；已接收任务全部完成");
    const otherRealm = { ...inputs[0], realmId: "realm-2", seed: 777 };
    assert.equal((await manager.submit(otherRealm)).state, "queued");
    await until(async () => (await manager.inspect(otherRealm)).state === "done");
    const receipt = await manager.inspect(otherRealm);
    assert.equal(receipt.result, simulate(777, otherRealm.rounds));
    assert.equal(receipt.realmId, "realm-2");
    assert.equal(receipt.logicVersion, requestScope.logicVersion);
    assert.equal(receipt.configVersion, requestScope.configVersion);
    assert.equal((await manager.inspect(inputs[0])).result, simulate(1, inputs[0].rounds));
    assert.equal((await manager.submit({ ...otherRealm, configVersion: "fixture-v2" })).state, "conflict");
    for (const patch of [{ logicVersion: "lcg-v2" }, { configVersion: "fixture-v2" }]) {
      const unsupported = { ...inputs[0], battleId: "unsupported", ...patch };
      assert.equal((await manager.submit(unsupported)).state, "unavailable");
      assert.equal((await manager.inspect(unsupported)).state, "missing");
    }
    assert.equal((await manager.submit({ ...inputs[0], battleId: "legacy", realmId: "" })).state, "invalid");
    assert.equal((await manager.inspect({ realmId: "realm-3", battleId: inputs[0].battleId })).state, "missing");
    completed++;
    assert.equal((await manager.overview({})).done, completed);
    assert.equal((await manager.overview({})).unknown, 0);
    console.log("[battle] 两区共用入口、同号战斗隔离、版本冲突/不兼容拒绝，Rust 回执正确");
    report = { passed: true, peak, completed, realmIsolation: true, incompatibleRejected: true, rejected: admissions.filter(result => result.state === "full").length, idleDownscale: true, events, limitations: ["memory-only ledger", "trusted realm labels, not authentication", "single artifact runtime; mixed-version scheduling unit tested", "single local controller", "no crash recovery or settlement", "no Kubernetes"] };
  } finally {
    const errors = [];
    try { await controller?.close(); } catch (error) { errors.push(error); }
    managerConnection?.close();
    for (const item of [...owned].reverse()) { try { await stop(item); } catch (error) { errors.push(error); } }
    console.log(`[battle] evidence=${runRoot}`);
    if (errors.length) throw new AggregateError(errors, "owned processes cleanup failed");
  }
  await writeFile(path.join(runRoot, "report.json"), JSON.stringify(report, null, 2));
}
function simulate(value, rounds) { for (let i = 0; i < rounds; i++) value = (Math.imul(value, 1664525) + 1013904223) >>> 0; return value; }
async function until(check, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 40)); }
  throw new Error("battle validation timed out");
}
async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve)); return port;
}
