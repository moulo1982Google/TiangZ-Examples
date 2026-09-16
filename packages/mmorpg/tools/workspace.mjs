import path from "node:path";
import { spawnSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const examples = path.resolve(root, "../..");
const engine = path.resolve(process.env.TIANGZ_ENGINE_ROOT ?? path.join(examples, "../TiangZ"));
const action = process.argv[2];
if (!["setup", "build", "check", "start", "smoke"].includes(action)) throw new Error(`Unknown MMORPG action: ${action}`);
const modules = path.join(root, "modules");
const args = ["--modules-dir", modules, "--out-dir", path.join(root, "dist"), "--runtime-root", root,
  "--config", path.join(root, "configs/local/all-in-one.json")];
const env = { ...process.env, TIANGZ_MODULES_DIR: modules };
function run(file, parameters) {
  const result = spawnSync(process.execPath, [file, ...parameters], { cwd: root, env, stdio: "inherit", windowsHide: true });
  if (result.error || result.status !== 0) throw result.error ?? new Error(`${file} failed (${result.status})`);
}
function server(command) { run(path.join(examples, "tools/server.mjs"), [command, ...args]); }
if (action === "setup" || action === "build") {
  for (const name of ["mmorpg", "bench"]) run(path.join(engine, "tools/link_game_module.mjs"),
    ["--source", path.join(examples, "modules", name), "--modules-dir", modules, "--name", name]);
  server(action === "setup" ? "prepare" : "build");
  if (action === "build") server("native-build");
} else if (action === "smoke") {
  run(path.join(examples, "tools/runtime_smoke.mjs"), ["--project", root]);
} else server(action);
