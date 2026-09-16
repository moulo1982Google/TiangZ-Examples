import path from "node:path";
import { spawnSync } from "node:child_process";
import { readFile, cp, access } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

const root = path.resolve(import.meta.dirname, "..");
const engine = path.resolve(process.env.TIANGZ_ENGINE_ROOT ?? path.join(root, "../TiangZ"));
const args = process.argv.slice(2), action = args.shift() ?? "check";
for (let index = 0; index < args.length; index++) {
  const value = args[index];
  if (["--debug", "--offline"].includes(value)) continue;
  if (!["--modules-dir", "--out-dir", "--runtime-root", "--config"].includes(value)) throw new Error(`unknown server option: ${value}`);
  if (!args[index + 1] || args[index + 1].startsWith("--")) throw new Error(`${value} requires a path`);
  if (args.indexOf(value) !== index) throw new Error(`duplicate server option: ${value}`);
  index++;
}
const option = (name, fallback) => { const i = args.indexOf(name); return i < 0 ? fallback : path.resolve(args[i + 1]); };
const modules = option("--modules-dir", path.join(root, "modules"));
const output = option("--out-dir", path.join(root, "dist"));
const runtimeRoot = option("--runtime-root", root);
const config = option("--config", path.join(runtimeRoot, "configs/local/all-in-one.json"));
const tool = (file, ...parameters) => run(process.execPath, [path.join(engine, "tools", file), ...parameters], engine);
function run(file, parameters, cwd) {
  const env = { ...process.env };
  if (process.platform === "win32") for (const key of ["CC", "CXX"]) if (/(?:gcc|g\+\+)(?:\.exe)?$/i.test(env[key] ?? "")) delete env[key];
  const result = spawnSync(file, parameters, { cwd, env, stdio: "inherit", windowsHide: true });
  if (result.error || result.status !== 0) throw result.error ?? new Error(`${file} failed (${result.status})`);
}
const host = ["--modules-dir", modules, "--host-profile", "modules"];
const { loadGameModuleCatalog } = await import(pathToFileURL(path.join(engine, "tools/game_module_catalog.mjs")));
const catalog = await loadGameModuleCatalog({ projectRoot: engine, modulesDirectory: modules });
const hasMmorpg = catalog.modules.some(module => module.id === "org.tiangz.mmorpg");
if (["prepare", "build", "check"].includes(action)) {
  tool("prepare_game_modules.mjs", ...host);
  tool("codegen_module_protocol.mjs", ...host);
  tool("codegen_module_configs.mjs", ...host);
  tool("codegen_module_native.mjs", ...host);
  if (hasMmorpg) {
    run(process.execPath, [path.join(root, "modules/mmorpg/tools/config_artifacts.mjs")], root);
    run(process.execPath, [path.join(root, "modules/mmorpg/tools/codegen_game_config.mjs")], root);
    tool("codegen_module_systems.mjs", ...host, "--module", "org.tiangz.mmorpg");
  }
  if (action !== "prepare") tool("typecheck_game_modules.mjs", ...host);
  if (action === "build") {
    tool("build_runtime_bundles.mjs", ...host, "--out-dir", output, ...(args.includes("--debug") ? ["--debug"] : []));
    tool("build_game_config_data.mjs", ...host, "--out-dir", output, "--initial");
    if (hasMmorpg && runtimeRoot !== root) {
      const navigation = path.join(runtimeRoot, "navigation");
      const exists = await access(navigation).then(() => true, error => { if (error.code === "ENOENT") return false; throw error; });
      // 只初始化缺少的示例资源，不覆盖游戏已经拥有的地图。
      // Seed missing example assets only; never overwrite game-owned maps.
      if (!exists) await cp(path.join(root, "navigation"), navigation, { recursive: true, force: false, errorOnExist: true });
    }
  }
} else if (action === "native-build") {
  tool("build_module_native.mjs", "--modules-dir", modules, ...(args.includes("--offline") ? ["--offline"] : []));
} else if (action === "start") {
  const { loadGameModuleCatalog } = await import(pathToFileURL(path.join(engine, "tools/game_module_catalog.mjs")));
  const { moduleNativeFingerprint } = await import(pathToFileURL(path.join(engine, "tools/module_native.mjs")));
  const catalog = await loadGameModuleCatalog({ projectRoot: engine, modulesDirectory: modules });
  const directory = path.join(engine, "temp/module-native-build", catalog.graphHash);
  const built = JSON.parse(await readFile(path.join(directory, "debug.manifest.json"), "utf8"));
  if (built.nativeModuleHash !== await moduleNativeFingerprint(catalog)) throw new Error("Native source changed; run native-build before starting");
  const binary = path.resolve(directory, built.binaryPath ?? path.join("target/debug", process.platform === "win32" ? "TiangZ.exe" : "TiangZ"));
  if (!binary.startsWith(directory + path.sep) || createHash("sha256").update(await readFile(binary)).digest("hex") !== built.binaryHash) throw new Error("Native binary path/hash mismatch; rebuild before starting");
  run(binary, [`--runtime-root=${runtimeRoot}`, config], runtimeRoot);
} else throw new Error("expected prepare, check, build, native-build or start");
