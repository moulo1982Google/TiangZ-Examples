import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";

const engine = path.resolve(import.meta.dirname, "../../../../../TiangZ");
const { build } = createRequire(path.join(engine, "package.json"))("esbuild");
// 仅替换框架、传输和 Native；执行实际 Hotfix 的准入、调度与幂等代码。
const result = await build({ stdin: { contents: `
  export { ManagerSystem } from "./modules/battle/src/hotfix/ManagerSystem";
  export { HostSystem } from "./modules/battle/src/hotfix/HostSystem";
  export { taskKey } from "./modules/battle/src/hotfix/Input";
  export { nativeCalls } from "#tiangz/module";
`, resolveDir: import.meta.dirname }, bundle: true, write: false, format: "esm", platform: "node",
  plugins: [{ name: "isolated-domain-test", setup(builder) {
    builder.onResolve({ filter: /^#tiangz\// }, args => ({ path: args.path, namespace: "test" }));
    builder.onLoad({ filter: /.*/, namespace: "test" }, () => ({ contents: `
      export const systemFor = () => value => value;
      export const BattleProtocol = { Execute: "execute", Poll: "poll", Register: "register", DrainHost: "drain" };
      export const BattleRelease = Object.freeze({ logicVersion: "lcg-v1", configVersion: "fixture-v1" });
      export class BattleManagerComponent { nodes = new Map(); tasks = new Map(); ticking = false; IsDisposed = false; owner; }
      export class BattleHostComponent { jobs = new Map(); draining = false; reporting = false; IsDisposed = false; owner; }
      export const nativeCalls = [];
      export const NativeOps = { Submit(...args) { nativeCalls.push(args); return nativeCalls.length; }, Poll(handle) { return handle; } };
    ` }));
  } }] });
const { ManagerSystem, HostSystem, taskKey, nativeCalls } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
const input = (patch = {}) => ({ realmId: "realm-1", battleId: "same-id", logicVersion: "lcg-v1", configVersion: "fixture-v1", seed: 1, rounds: 1, delayMs: 0, ...patch });
function register(manager, name = "worker-a", logic = "lcg-v1", config = "fixture-v1") {
  return manager.Register(name, 3000, "127.0.0.1", logic, config);
}

test("节点版本随身份冻结，旧心跳不能省略或改写版本", () => {
  const manager = new ManagerSystem();
  assert.equal(register(manager), true);
  assert.equal(register(manager), true);
  assert.equal(register(manager, "worker-a", "lcg-v2"), false);
  assert.equal(register(manager, "worker-a", "lcg-v1", "fixture-v2"), false);
  assert.equal(register(manager, "worker-b", ""), false);
  assert.equal(register(manager, "worker-b", "lcg-v1", ""), false);
  assert.equal(manager.Register("worker-b", 3000, "127.0.0.1"), false);
  assert.equal(manager.nodes.size, 1);
});

test("不同区服同号独立，重试必须保留版本和内容，不兼容不入账", () => {
  const manager = new ManagerSystem();
  assert.equal(manager.Submit(input()), "unavailable");
  register(manager);
  assert.equal(manager.Submit(input()), "queued");
  assert.equal(manager.Submit(input()), "queued");
  assert.equal(manager.Submit(input({ realmId: "realm-2", seed: 2 })), "queued");
  assert.equal(manager.tasks.size, 2);
  for (const patch of [{ seed: 2 }, { configVersion: "fixture-v2" }, { logicVersion: "lcg-v2" }]) {
    assert.equal(manager.Submit(input(patch)), "conflict");
  }
  for (const patch of [{ logicVersion: "lcg-v2" }, { configVersion: "fixture-v2" }]) {
    const request = input({ battleId: "unsupported", ...patch });
    assert.equal(manager.Submit(request), "unavailable");
    assert.equal(manager.Inspect(request).state, "missing");
  }
  assert.equal(manager.Inspect(input({ realmId: "realm-3" })).state, "missing");
  assert.equal(manager.tasks.size, 2);
});

test("逻辑和配置双重匹配，跳过不兼容队头，两区可使用同一节点", async () => {
  const manager = new ManagerSystem();
  register(manager, "worker-a");
  register(manager, "worker-b", "lcg-v2", "fixture-v2");
  const requests = [input({ logicVersion: "lcg-v2", configVersion: "fixture-v2" }),
    input({ realmId: "realm-2" }), input({ realmId: "realm-3" })];
  const executed = [];
  manager.owner = { scenes: { async call(endpoint, method, request) {
    if (method === "execute") {
      const node = manager.nodes.get(endpoint.name);
      assert.equal(request.logicVersion, node.logicVersion);
      assert.equal(request.configVersion, node.configVersion);
      executed.push({ node: endpoint.name, ...request });
      return { accepted: true };
    }
    assert.equal(method, "poll");
    assert(executed.some(item => item.realmId === request.realmId && item.battleId === request.battleId && item.node === endpoint.name));
    return { state: "done", result: request.realmId === "realm-2" ? 2 : 3 };
  } } };
  for (const request of requests) assert.equal(manager.Submit(request), "queued");
  await manager.Tick();
  assert.deepEqual(executed.map(item => [item.node, item.realmId]), [["worker-a", "realm-2"], ["worker-b", "realm-1"]]);
  await manager.Tick();
  await manager.Tick();
  assert.equal(manager.Overview().done, 3);
  assert.deepEqual(executed.filter(item => item.node === "worker-a").map(item => item.realmId), ["realm-2", "realm-3"]);
  for (const request of requests) {
    const receipt = manager.Inspect(request);
    assert.equal(receipt.realmId, request.realmId);
    assert.equal(receipt.logicVersion, request.logicVersion);
    assert.equal(receipt.configVersion, request.configVersion);
    assert.equal(receipt.state, "done");
  }
});

test("已受理任务失去兼容节点不转投其他版本；排空或失联节点不接新单", async () => {
  const manager = new ManagerSystem();
  register(manager);
  register(manager, "worker-b", "lcg-v2");
  assert.equal(manager.Submit(input()), "queued");
  manager.nodes.get("worker-a").draining = true;
  manager.owner = { scenes: { call() { assert.fail("must not dispatch to incompatible worker"); } } };
  await manager.Tick();
  assert.equal(manager.Inspect(input()).state, "queued");
  assert.equal(manager.Submit(input({ battleId: "new-id" })), "unavailable");
  assert.equal(manager.Submit(input()), "queued");
  manager.nodes.get("worker-a").draining = false;
  manager.nodes.get("worker-a").seen = Date.now() - 2000;
  await manager.Tick();
  assert.equal(manager.Submit(input({ battleId: "new-id" })), "unavailable");
});

test("同逻辑不同配置也能并存，不能只匹配其中一个版本", async () => {
  const manager = new ManagerSystem();
  register(manager, "worker-a", "lcg-v1", "fixture-v1");
  register(manager, "worker-b", "lcg-v1", "fixture-v2");
  const second = input({ configVersion: "fixture-v2" });
  assert.equal(manager.Submit(second), "queued");
  const calls = [];
  manager.owner = { scenes: { async call(endpoint, method, request) {
    calls.push({ node: endpoint.name, method, request });
    return { accepted: true };
  } } };
  await manager.Tick();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].node, "worker-b");
  assert.equal(calls[0].request.configVersion, "fixture-v2");
});

test("同号跨区在途查询失败保留原任务归属，不重复下发", async () => {
  const manager = new ManagerSystem();
  register(manager, "worker-a");
  register(manager, "worker-b");
  for (const realmId of ["realm-1", "realm-2"]) manager.Submit(input({ realmId }));
  const sent = [];
  manager.owner = { scenes: { async call(endpoint, method, request) {
    sent.push({ node: endpoint.name, method, realmId: request.realmId });
    if (method === "execute") return { accepted: true };
    throw new Error("simulated uncertain query");
  } } };
  await manager.Tick();
  await manager.Tick();
  assert.equal(sent.filter(item => item.method === "execute").length, 2);
  assert.deepEqual(sent.filter(item => item.method === "poll").map(item => [item.node, item.realmId]), [["worker-a", "realm-1"], ["worker-b", "realm-2"]]);
  assert.equal(manager.Overview().running, 2);
  assert.equal(manager.Submit(input()), "running");
});

test("执行端独立拒绝错误版本；跨区同号可执行，重复不重复进入 Rust", () => {
  nativeCalls.length = 0;
  const host = new HostSystem();
  assert.equal(host.Execute(input({ logicVersion: "lcg-v2" })), false);
  assert.equal(host.Execute(input({ configVersion: "fixture-v2" })), false);
  assert.equal(nativeCalls.length, 0);
  const first = input();
  assert.equal(host.Execute(first), true);
  first.seed = 99;
  assert.equal(host.Execute(input()), true);
  assert.equal(host.Execute(first), false);
  assert.equal(nativeCalls.length, 1);
  assert.equal(host.Poll(taskKey(input())).state, "done");
  assert.equal(host.Execute(input({ realmId: "realm-2", seed: 2 })), true);
  assert.equal(nativeCalls.length, 2);
  assert.equal(host.Poll(taskKey(input({ realmId: "realm-2" }))).result, 2);
  assert.equal(host.Poll(taskKey(input())).result, 1);
  host.draining = true;
  assert.equal(host.Execute(input()), true);
  assert.equal(host.Execute(input({ realmId: "realm-3" })), false);
});

test("旧请求、非法版本及非整数输入失败关闭", () => {
  const manager = new ManagerSystem();
  register(manager);
  for (const patch of [{ realmId: "" }, { realmId: undefined }, { logicVersion: "" }, { configVersion: "" },
    { logicVersion: "latest/anything" }, { battleId: "a:b" }, { seed: -1 }, { rounds: 1.5 }, { delayMs: -1 }]) {
    assert.equal(manager.Submit(input(patch)), "invalid");
    assert.equal(new HostSystem().Execute(input(patch)), false);
  }
  assert.equal(manager.tasks.size, 0);
});
