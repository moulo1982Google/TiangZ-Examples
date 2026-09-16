import test from "node:test";
import assert from "node:assert/strict";
import { runtimeConfig } from "./config.mjs";
import { manifest } from "./manifest.mjs";
import { createRequire } from "node:module";
import path from "node:path";

const env = { BATTLE_ROLE: "worker", POD_IP: "10.244.0.3", POD_NAME: "battle-worker-2", POD_UID: "12345678-1234-1234-1234-123456789012" };
test("Pod 地址、监听地址、注册身份和进程编号各自独立", () => {
  const config = runtimeConfig(env, "10.96.0.5");
  assert.equal(config.process.identity.workerId, 3);
  assert.equal(config.scenes[0].innerIp, env.POD_IP);
  assert.equal(config.scenes[0].bindIp, "0.0.0.0");
  assert.equal(config.scenes[0].name, `worker-2-${env.POD_UID}`);
  assert.equal(config.knownScenes[0].innerIp, "10.96.0.5");
  assert.notEqual(runtimeConfig({ ...env, POD_UID: env.POD_UID.replace("12345678", "87654321") }, "10.96.0.5").scenes[0].name, config.scenes[0].name);
  const manager = runtimeConfig({ BATTLE_ROLE: "manager", POD_IP: "10.244.0.2" });
  assert.equal(manager.process.identity.workerId, 0);
  assert.deepEqual(manager.knownScenes, []);
});
test("拒绝缺失地址、错误角色和超过三节点的配置", () => {
  for (const patch of [{ POD_IP: "" }, { BATTLE_ROLE: "map" }, { POD_NAME: "battle-worker-3" }, { POD_UID: "" }]) {
    assert.throws(() => runtimeConfig({ ...env, ...patch }, "10.96.0.5"));
  }
  assert.throws(() => runtimeConfig(env, "battle-manager"));
});
test("部署仅拥有独立命名空间，无公网入口、无集群凭据和数据库", () => {
  const result = manifest("tiangz-battle-1234abcd", "tiangz-battle-lab:k8s-image-123abc", "1234abcd");
  const manager = result.items.find(item => item.kind === "Deployment");
  const workers = result.items.find(item => item.kind === "StatefulSet");
  assert.equal(manager.spec.replicas, 1);
  assert.equal(manager.spec.strategy.type, "Recreate");
  assert.equal(workers.spec.replicas, 2);
  assert.equal(workers.spec.updateStrategy.type, "OnDelete");
  for (const workload of [manager, workers]) {
    const spec = workload.spec.template.spec;
    assert.equal(spec.automountServiceAccountToken, false);
    assert.equal(spec.securityContext.runAsNonRoot, true);
    assert.equal(spec.containers[0].imagePullPolicy, "Never");
  }
  assert.deepEqual(workers.spec.template.spec.containers[0].lifecycle.preStop.exec.command, ["node", "/game/drain.mjs"]);
  assert(result.items.filter(item => item.kind === "Service").every(item => item.spec.type === "ClusterIP"));
  assert.throws(() => manifest("default", "tiangz-battle-lab:k8s-image-123abc", "1234abcd"));
  assert.throws(() => manifest("tiangz-battle-1234abcd", "nginx:latest", "1234abcd"));
});

test("注册只接受实验内网地址，同名节点不能更换地址或端口", async () => {
  const engine = path.resolve(import.meta.dirname, "../../../../../../TiangZ");
  const { build } = createRequire(path.join(engine, "package.json"))("esbuild");
  const result = await build({ entryPoints: [path.resolve(import.meta.dirname, "../modules/battle/src/hotfix/ManagerSystem.ts")],
    bundle: true, write: false, format: "esm", platform: "node", plugins: [{ name: "test-scene-owner", setup(builder) {
      builder.onResolve({ filter: /^#tiangz\// }, args => ({ path: args.path, namespace: "stub" }));
      builder.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents:
        "export const systemFor = () => value => value; export const BattleProtocol = {}; export class BattleManagerComponent { nodes = new Map(); tasks = new Map(); }" }));
    } }] });
  const { ManagerSystem } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
  const manager = new ManagerSystem();
  const register = manager.Register.bind(manager);
  manager.Register = (node, port, ip) => register(node, port, ip, "lcg-v1", "fixture-v1");
  assert.equal(manager.Register("worker-local", 3000, ""), true);
  assert.equal(manager.Register("worker-pod", 3000, "10.244.0.3"), true);
  assert.equal(manager.nodes.get("worker-pod").endpoint.innerIp, "10.244.0.3");
  assert.equal(manager.Register("worker-pod", 3000, "10.244.0.3"), true);
  assert.equal(manager.Register("worker-pod", 3001, "10.244.0.3"), false);
  assert.equal(manager.Register("worker-pod", 3000, "10.244.0.4"), false);
  for (const ip of ["0.0.0.0", "8.8.8.8", "169.254.169.254", "10.244.0.999", "10.01.0.1", "localhost", "::1"]) {
    assert.equal(manager.Register("worker-invalid", 3000, ip), false, ip);
  }
  assert.equal(manager.Register("worker-invalid", 3000.5, "127.0.0.1"), false);
});
