import { mkdtemp, mkdir, readFile, writeFile, cp } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { build } from "esbuild";
import { loadGameModuleCatalog } from "../../TiangZ/tools/game_module_catalog.mjs";
import { moduleNativeFingerprint } from "../../TiangZ/tools/module_native.mjs";

const examples = path.resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== "--project" || !args[1])) throw new Error("Use --project <example-package-root>");
const root = args.length ? path.resolve(args[1]) : examples;
const engine = path.resolve(process.env.TIANGZ_ENGINE_ROOT ?? path.join(examples, "../TiangZ"));
const catalog = await loadGameModuleCatalog({ projectRoot: engine, modulesDirectory: path.join(root, "modules") });
const builtRoot = path.join(engine, "temp/module-native-build", catalog.graphHash);
const manifest = JSON.parse(await readFile(path.join(builtRoot, "debug.manifest.json"), "utf8"));
const binary = path.resolve(builtRoot, manifest.binaryPath ?? path.join("target/debug", process.platform === "win32" ? "TiangZ.exe" : "TiangZ"));
if (!binary.startsWith(builtRoot + path.sep)) throw Error("Native binary escapes build directory");
if (manifest.nativeModuleHash !== await moduleNativeFingerprint(catalog)
  || manifest.binaryHash !== createHash("sha256").update(await readFile(binary)).digest("hex")) throw Error("Native build is stale; run server:native-build");
const temporary = await mkdtemp(path.join(os.tmpdir(), "tiangz-mmorpg-smoke-"));
await mkdir(path.join(temporary, "configs"));
await cp(path.join(root, "dist"), path.join(temporary, "dist"), { recursive: true, filter: source => !source.includes(`${path.sep}coverage`) });
await cp(path.join(root, "navigation"), path.join(temporary, "navigation"), { recursive: true });
const config = JSON.parse(await readFile(path.join(root, "configs/local/all-in-one.json"), "utf8"));
config.process.name = "mmorpg-extraction-smoke";
config.process.identity.workerId = 91;
config.process.logging.file.enabled = false;
delete config.process.debug;
config.process.observability = { health: { ip: "127.0.0.1", port: await freePort() } };
for (const scene of config.scenes) {
  scene.port = await freePort();
  if (scene.audience !== "inner") scene.protocol = "websocket";
}
const startup = path.join(temporary, "smoke.json");
await writeFile(startup, JSON.stringify(config));
await build({ entryPoints: [path.join(examples, "tools/client_sdk_smoke.ts")], bundle: true, platform: "node", format: "cjs", target: "node24", outfile: path.join(temporary, "client.cjs") });
let logs = "", exited = false;
const child = spawn(binary, [`--runtime-root=${temporary}`, startup], { cwd: temporary, windowsHide: true,
  env: { ...process.env, TIANGZ_WATCHER_CONTROL: "stdin" }, stdio: ["pipe", "pipe", "pipe"] });
const completion = new Promise(resolve => { child.once("exit", code => { exited = true; resolve(code); }); child.once("error", error => { logs += error.message; exited = true; resolve(-1); }); });
child.stdout.on("data", data => { logs += data; }); child.stderr.on("data", data => { logs += data; });
try {
  const deadline = Date.now() + 30000;
  while (true) {
    if (exited || Date.now() > deadline) throw Error(`Server failed to become ready\n${logs}`);
    try { const response = await fetch(`http://127.0.0.1:${config.process.observability.health.port}/ready`, { signal: AbortSignal.timeout(500) }); if (response.ok) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const probe = spawn(process.execPath, [path.join(temporary, "client.cjs"), "websocket", "127.0.0.1", String(config.scenes[0].port), "1", "10000"], { cwd: temporary, windowsHide: true, stdio: "inherit" });
  const timeout = setTimeout(() => probe.kill(), 45000);
  const result = await new Promise((resolve, reject) => { probe.once("exit", resolve); probe.once("error", reject); }).finally(() => clearTimeout(timeout));
  if (result !== 0) throw Error(`Client smoke failed (${result})\n${logs}`);
  console.log("MMORPG module real login/map/logout smoke passed; no existing process or DB was used.");
} finally {
  if (!exited) child.stdin.end("shutdown\n");
  const timeout = setTimeout(() => { if (!exited) child.kill(); }, 10000);
  await completion; clearTimeout(timeout);
  await writeFile(path.join(temporary, "runtime.log"), logs);
  console.log(`Isolated smoke artifacts: ${temporary}`);
}
async function freePort() {
  const socket = createServer();
  await new Promise(resolve => socket.listen(0, "127.0.0.1", resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  return port;
}
