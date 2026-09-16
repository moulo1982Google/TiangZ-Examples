import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile, open } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { manifest, ownershipLabel } from "./manifest.mjs";
import { stateDirectory } from "./paths.mjs";

const lab = path.resolve(import.meta.dirname, "..");
const temp = stateDirectory(lab);
const kubeconfig = path.join(lab, "temp/k8s-tools/kubeconfig");
const kind = path.join(lab, "temp/k8s-tools", process.platform === "win32" ? "kind.exe" : "kind");
const context = "kind-tiangz-battle-lab";
const requestScope = { realmId: "realm-1", logicVersion: "lcg-v1", configVersion: "fixture-v1" };
const stateFile = path.join(temp, "k8s-state.json");
const action = process.argv[2] ?? "status";
if (!["up", "status", "verify", "scale", "down"].includes(action)) throw new Error("use up/status/verify/scale 2|3/down");
if (action === "scale" && !["2", "3"].includes(process.argv[3])) throw new Error("only scale 2 or 3 is allowed");
await mkdir(temp, { recursive: true });
// 防止两个练习命令同时缩容或覆盖证据；崩溃留下的锁需确认旧进程退出后手工处理。
const lock = await open(path.join(temp, "k8s-command.lock"), "wx");
let state;
try {
  try { state = JSON.parse(await readFile(stateFile, "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; }
  if (action === "up") {
    if (state && !state.deleted) throw new Error("lab already recorded; use status/down before a fresh up");
    const image = JSON.parse(await readFile(path.join(temp, "k8s-image.json"), "utf8"));
    await base("get", "nodes");
    await run(kind, ["load", "docker-image", image.tag, "--name", "tiangz-battle-lab"]);
    const owner = randomBytes(4).toString("hex");
    state = { namespace: `tiangz-battle-${owner}`, owner, image: image.tag, stage: image.stage, context, deleted: false };
    const file = path.join(temp, `${state.namespace}.json`);
    await writeFile(file, JSON.stringify(manifest(state.namespace, state.image, owner), null, 2));
    await writeFile(stateFile, JSON.stringify(state, null, 2));
    // create 不接管/覆盖任何同名既有资源。
    console.log(await base("create", "-f", file));
    await k("rollout", "status", "deployment/battle-manager", "--timeout=120s");
    await waitForWorkers(2);
    await withClient(async manager => {
      await until(async () => available(await manager.overview({})).length === 2, 30000);
      console.log("[battle-k8s] 一个管理器、两个战斗服已经就绪并注册");
    });
  } else {
    if (!state || state.deleted) throw new Error("no active lab; run up first");
    assert.equal(state.context, context);
    if (!/^tiangz-battle-[a-f0-9]{8}$/.test(state.namespace)) throw new Error("invalid namespace");
    const ns = JSON.parse(await base("get", "namespace", state.namespace, "-o", "json"));
    assert.equal(ns.metadata.labels?.[ownershipLabel], state.owner, "namespace ownership mismatch");
    if (action === "status") {
      console.log(await k("get", "pods", "-o", "wide"));
      await withClient(async manager => console.log(JSON.stringify(await manager.overview({}), null, 2)));
    } else if (action === "scale") {
      await withClient(manager => scale(manager, Number(process.argv[3])));
    } else if (action === "verify") {
      await withClient(verify);
    } else {
      // 先确保没有排队/执行中/未知结果，再移除本次实验命名空间。
      await withClient(async manager => {
        const view = await manager.overview({});
        assert.equal(view.queued + view.running + view.unknown, 0, "pending or unknown work; refusing cleanup");
        for (const worker of available(view)) await until(async () => (await manager.drain({ node: worker.node })).idle);
      });
      // 停完执行节点再停管理器，保证 preStop 能取得排空确认。
      await k("scale", "statefulset/battle-worker", "--replicas=0");
      await until(async () => JSON.parse(await k("get", "pods", "-l", "app=battle-worker", "-o", "json")).items.length === 0, 60000);
      console.log(await base("delete", "namespace", state.namespace, "--wait=true", "--timeout=60s"));
      state.deleted = true;
      await writeFile(stateFile, JSON.stringify(state, null, 2));
    }
  }
} catch (error) {
  if (state && !state.deleted) {
    for (const [file, args] of [["pods", ["get", "pods", "-o", "json"]], ["events", ["get", "events", "-o", "json"]]]) {
      try { await writeFile(path.join(temp, `${state.namespace}-${file}.json`), await k(...args)); } catch { /* 保留原始错误。 */ }
    }
  }
  throw error;
} finally {
  await lock.close();
  // 只删除本命令独占创建的零字节锁，不清理用户文件。
  const { unlink } = await import("node:fs/promises");
  await unlink(path.join(temp, "k8s-command.lock"));
}

function base(...args) { return run("kubectl", ["--kubeconfig", kubeconfig, "--context", context, "--request-timeout=15s", ...args]); }
function k(...args) { return base("--namespace", state.namespace, ...args); }
function available(view) { return view.workers.filter(worker => worker.live && !worker.draining); }
async function scale(manager, count) {
  const deployment = JSON.parse(await k("get", "statefulset", "battle-worker", "-o", "json"));
  assert([2, 3].includes(count));
  if (count < deployment.spec.replicas) {
    const pod = JSON.parse(await k("get", "pod", "battle-worker-2", "-o", "json"));
    const node = `worker-2-${pod.metadata.uid}`;
    await until(async () => (await manager.drain({ node })).idle);
    const confirmedPod = JSON.parse(await k("get", "pod", "battle-worker-2", "-o", "json"));
    assert.equal(confirmedPod.metadata.uid, pod.metadata.uid, "Pod changed during drain; refusing scale");
    // 取得确认后才允许 Kubernetes 删除 Pod；失败不修改副本数。
    console.log(`[battle-k8s] drain confirmed before scale: ${node}`);
  }
  console.log(await k("scale", "statefulset/battle-worker", `--replicas=${count}`, `--current-replicas=${deployment.spec.replicas}`));
  await waitForWorkers(count);
  await until(async () => available(await manager.overview({})).length === count, 30000);
}
async function waitForWorkers(count) {
  // OnDelete 不支持 kubectl rollout status；直接检查目标 Pod 数与 Ready。
  await until(async () => {
    const pods = JSON.parse(await k("get", "pods", "-l", "app=battle-worker", "-o", "json")).items;
    return pods.length === count && pods.every(pod => !pod.metadata.deletionTimestamp && pod.status.containerStatuses?.every(item => item.ready));
  }, 120000);
}
async function verify(manager) {
  const before = await manager.overview({});
  assert.equal(before.queued + before.running + before.unknown, 0);
  assert.equal(before.done, 0, "verify needs a fresh lab (bounded memory ledger); down/up first");
  assert.equal(available(before).length, 2);
  await scale(manager, 3);
  const inputs = Array.from({ length: 24 }, (_, i) => ({ ...requestScope, battleId: `k8s-${i}`, seed: i + 1, rounds: 200000, delayMs: 250 }));
  for (const input of inputs) assert.equal((await manager.submit(input)).state, "queued");
  assert.notEqual((await manager.submit(inputs[0])).state, "conflict");
  assert.equal((await manager.submit({ ...inputs[0], seed: 99 })).state, "conflict");
  await until(async () => (await manager.overview({})).done === 24, 30000);
  const used = new Set();
  for (const input of inputs) {
    const result = await manager.inspect({ realmId: input.realmId, battleId: input.battleId });
    assert.equal(result.state, "done"); assert.equal(result.result, simulate(input.seed, input.rounds)); used.add(result.node);
  }
  assert.equal(used.size, 3);
  const third = JSON.parse(await k("get", "pod", "battle-worker-2", "-o", "json"));
  const node = `worker-2-${third.metadata.uid}`;
  const follower = followLogs("battle-worker-2");
  try {
  await until(() => follower.output().length > 0);
  for (let i = 24; i < 48; i++) assert.equal((await manager.submit({ ...requestScope, battleId: `k8s-${i}`, seed: i, rounds: 200000, delayMs: 250 })).state, "queued");
  await until(async () => (await manager.overview({})).workers.some(worker => worker.node === node && worker.busy));
  const firstDrain = await manager.drain({ node });
  assert.equal(firstDrain.idle, false, "exercise must observe in-flight work, not just an already idle Pod");
  // Pod 尚未收到删除请求；排空期间仍继续提交现有结果。
  const stillThere = JSON.parse(await k("get", "pod", "battle-worker-2", "-o", "json"));
  assert.equal(stillThere.metadata.uid, third.metadata.uid);
  assert.equal(stillThere.metadata.deletionTimestamp, undefined);
  await scale(manager, 2);
  await until(() => follower.output().includes("runtime exit code=0 signal=null"));
  await writeFile(path.join(temp, `${state.namespace}-worker-2.log`), follower.output());
  await until(async () => (await manager.overview({})).done === 48, 30000);
  for (let i = 24; i < 48; i++) {
    const result = await manager.inspect({ realmId: requestScope.realmId, battleId: `k8s-${i}` });
    assert.equal(result.state, "done"); assert.equal(result.result, simulate(i, 200000));
  }
  assert.equal((await manager.overview({})).unknown, 0);
  const pods = JSON.parse(await k("get", "pods", "-o", "json"));
  assert(pods.items.every(pod => pod.status.containerStatuses?.every(item => item.restartCount === 0)));
  const report = { passed: true, namespace: state.namespace, image: state.image, completed: 48,
    workersUsed: [...used], scale: [2, 3, 2], drainStartedWhileBusy: true, firstDrainIdle: firstDrain.idle,
    unknown: 0, workerExitCode: 0, pods, limitations: ["manual scaling", "memory-only ledger", "no crash recovery", "no durable settlement", "single-machine kind"] };
  const file = path.join(temp, `${state.namespace}-report.json`);
  await writeFile(file, JSON.stringify(report, null, 2));
  console.log(`[battle-k8s] PASS: 48 Rust results, 2→3→2, drain before removal; evidence=${file}`);
  } finally { await follower.close(); }
}
function followLogs(pod) {
  const child = spawn("kubectl", ["--kubeconfig", kubeconfig, "--context", context, "-n", state.namespace,
    "logs", "-f", pod], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  const done = new Promise(resolve => child.once("close", resolve));
  child.on("error", error => { output += error.message; });
  for (const stream of [child.stdout, child.stderr]) stream.on("data", data => { output = (output + data).slice(-100000); });
  return { output: () => output, close: async () => { child.kill(); await done; } };
}
async function withClient(callback) {
  const server = createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  const args = ["--kubeconfig", kubeconfig, "--context", context, "-n", state.namespace, "port-forward", "svc/battle-manager", `${port}:3000`, "--address=127.0.0.1"];
  const forward = spawn("kubectl", args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let logs = "";
  let failed;
  const done = new Promise(resolve => forward.once("close", resolve));
  forward.once("error", error => { failed = error; });
  forward.once("exit", code => { failed = new Error(`port-forward exited ${code}: ${logs}`); });
  for (const stream of [forward.stdout, forward.stderr]) stream.on("data", data => { logs = (logs + data).slice(-8000); });
  let connection;
  try {
    await until(() => { if (failed) throw failed; return logs.includes("Forwarding from"); }, 15000);
    const { connect } = await import(pathToFileURL(path.join(state.stage, "runtime/client.mjs")));
    connection = await connect(port);
    await callback(connection.client);
  } finally {
    connection?.close();
    forward.kill(); // 只停止本次创建的端口转发，不触碰游戏或其他 kubectl。
    await done;
  }
}
async function run(command, args) {
  const child = spawn(command, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  child.stdout.on("data", data => { stdout += data; });
  child.stderr.on("data", data => { stderr = (stderr + data).slice(-16000); });
  await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", code => code === 0 ? resolve() : reject(new Error(`${command} ${args.join(" ")}: ${stderr}`))); });
  return stdout;
}
async function until(check, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 60)); }
  throw new Error("Kubernetes battle lab timed out; inspect pods/events in temp");
}
function simulate(value, rounds) { for (let i = 0; i < rounds; i++) value = (Math.imul(value, 1664525) + 1013904223) >>> 0; return value; }
