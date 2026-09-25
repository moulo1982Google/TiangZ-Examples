import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, cp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { createHash } from "node:crypto";
import path from "node:path";

const examples = path.resolve(import.meta.dirname, "..");
const engine = path.resolve(process.env.TIANGZ_ENGINE_ROOT ?? path.join(examples, "../TiangZ"));
const fixtures = path.join(examples, "tools/fixtures/room");

test("scaffolded room consumer uses one Scene without Location or MapHost", { timeout: 180_000 }, async () => {
  await mkdir(path.join(examples, "dist"), { recursive: true });
  const project = await mkdtemp(path.join(examples, "dist/room-consumer-"));
  const moduleRoot = path.join(project, "modules/room");
  let sequence = 0;
  async function run(tool, args) {
    const result = spawnSync(process.execPath, [path.join(engine, "tools", tool), ...args], { cwd: engine, encoding: "utf8", windowsHide: true, timeout: 120_000, maxBuffer: 4 * 1024 * 1024 });
    await writeFile(path.join(project, `${++sequence}-${tool}.log`), `${result.stdout ?? ""}\n${result.stderr ?? ""}`);
    assert.equal(result.status, 0, `${tool}: ${result.error ?? ""}\n${result.stdout}\n${result.stderr}`);
    return result.stdout;
  }
  const action = name => run("game_project.mjs", [name, "--project", project]);
  console.log(`Room consumer artifacts: ${project}`);
  await run("create_game_module.mjs", ["--id", "org.example.room", "--path", moduleRoot, "--host-profile", "modules"]);
  await cp(path.join(fixtures, "module"), moduleRoot, { recursive: true });
  const moduleFile = path.join(moduleRoot, "tiangz.module.json");
  const module = JSON.parse(await readFile(moduleFile, "utf8"));
  module.protocol = { source: "proto", generateGodot: false };
  await writeFile(moduleFile, JSON.stringify(module, null, 2) + "\n");
  await mkdir(path.join(project, "tools"));
  await cp(path.join(fixtures, "smoke.ts"), path.join(project, "tools/smoke.ts"));
  await mkdir(path.join(project, "configs/local"), { recursive: true });
  const port = await freePort();
  let healthPort = await freePort();
  while (healthPort === port) healthPort = await freePort();
  const settings = { process: { name: "room-consumer", identity: { originServerId: 93, workerId: 0 }, observability: { health: { ip: "127.0.0.1", port: healthPort } } },
    scenes: [{ name: "rooms", sceneType: "Room", ip: "127.0.0.1", port, protocol: "websocket", audience: "outer" }] };
  await writeFile(path.join(project, "configs/local/room.json"), JSON.stringify(settings, null, 2));
  await writeFile(path.join(project, "configs/local/StartMachine.json"), JSON.stringify({ machines: [{ name: "local", innerIp: "127.0.0.1", processes: ["room.json"] }] }));
  await writeFile(path.join(project, "tiangz.project.json"), JSON.stringify({ formatVersion: 1, engineRoot: engine, hostProfile: "modules", modulesDirectory: "modules", processConfig: "configs/local/room.json", machineConfig: "configs/local/StartMachine.json" }));
  // 全新夹具没有已有协议锁；只由正式工具创建，不改任何业务仓库的锁。
  // Only the official generator creates this fresh fixture's locks.
  await action("protocol-update");
  await action("setup");
  await action("check");
  await action("build");
  const manifest = JSON.parse(await readFile(path.join(project, "dist/model.manifest.json"), "utf8"));
  assert.equal(manifest.buildMode, "modules");
  const output = await action("smoke");
  assert.match(output, /create\/join\/leave\/reconnect.*passed/);
  assert.match(output, /真实请求验收通过，测试进程已停止/);
  const binary = path.join(engine, "target/debug", process.platform === "win32" ? "TiangZ.exe" : "TiangZ");
  await writeFile(path.join(project, "acceptance.json"), JSON.stringify({ status: "passed", engine, binarySha256: createHash("sha256").update(await readFile(binary)).digest("hex"), moduleId: module.id, sceneTypes: settings.scenes.map(scene => scene.sceneType), persistence: "memory-only", runtime: true }, null, 2) + "\n");
});

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
