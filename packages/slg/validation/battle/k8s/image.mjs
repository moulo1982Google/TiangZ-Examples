import { spawn } from "node:child_process";
import { cp, copyFile, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { stateDirectory } from "./paths.mjs";

const here = import.meta.dirname;
const lab = path.resolve(here, "..");
const engine = path.resolve(lab, "../../../../../TiangZ");
const { build } = createRequire(path.join(engine, "package.json"))("esbuild");
const { loadGameModuleCatalog } = await import(pathToFileURL(path.join(engine, "tools/game_module_catalog.mjs")));
const modules = path.join(lab, "modules");
for (const tool of ["prepare_game_modules.mjs", "codegen_module_protocol.mjs", "codegen_module_native.mjs"]) {
  await run(process.execPath, [path.join(engine, "tools", tool), "--modules-dir", modules]);
}
for (const tool of ["build_runtime_bundles.mjs", "build_game_config_data.mjs"]) {
  await run(process.execPath, [path.join(engine, "tools", tool), "--modules-dir", modules,
    "--out-dir", path.join(lab, "dist"), ...(tool.includes("config") ? ["--initial"] : [])]);
}
await mkdir(path.join(lab, "temp"), { recursive: true });
const stage = await mkdtemp(path.join(lab, "temp/k8s-image-"));
const catalog = await loadGameModuleCatalog({ projectRoot: engine, modulesDirectory: modules });
const engineStage = path.join(stage, "engine");
await mkdir(path.join(engineStage, "tools"), { recursive: true });
await mkdir(path.join(engineStage, ".cargo"));
await copyFile(path.join(here, "cargo-config.toml"), path.join(engineStage, ".cargo/config.toml"));
const dbproxy = path.resolve(engine, "../TiangZ-DBProxy");
await mkdir(path.join(stage, "dbproxy-source"));
for (const file of ["Cargo.toml", "src", "crates"]) {
  await cp(path.join(dbproxy, file), path.join(stage, "dbproxy-source", file), { recursive: true,
    filter: source => !path.relative(dbproxy, source).split(path.sep).some(part => ["target", ".git"].includes(part)) });
}
for (const file of ["Cargo.toml", "Cargo.lock", "rust-toolchain.toml", "package.json", "build.rs", "src", "third_party"]) {
  await cp(path.join(engine, file), path.join(engineStage, file), { recursive: true, filter: source => !source.split(path.sep).includes(".git") });
}
for (const file of ["build_module_native.mjs", "game_module_catalog.mjs", "module_native.mjs", "module_native_dependencies.mjs", "module_runtime_binary.mjs"]) {
  await copyFile(path.join(engine, "tools", file), path.join(engineStage, "tools", file));
}
// 相同组合的已解析锁跨平台复用；不把 Windows 二进制或 Cargo 缓存塞入镜像。
const lockDir = path.join("temp/module-native-build", catalog.graphHash);
await mkdir(path.join(engineStage, lockDir), { recursive: true });
await copyFile(path.join(engine, lockDir, "Cargo.lock"), path.join(engineStage, lockDir, "Cargo.lock"));
await cp(modules, path.join(stage, "modules"), { recursive: true,
  filter: source => !path.relative(modules, source).split(path.sep).some(part => ["target", ".tiangz", "node_modules"].includes(part)) });
await cp(path.join(lab, "dist"), path.join(stage, "dist"), { recursive: true });
await mkdir(path.join(stage, "runtime"));
for (const file of ["entry.mjs", "drain.mjs", "config.mjs"]) await copyFile(path.join(here, file), path.join(stage, "runtime", file));
await build({ entryPoints: [path.join(lab, "client.ts")], bundle: true, platform: "node", format: "esm", outfile: path.join(stage, "runtime/client.mjs") });
await copyFile(path.join(here, "export-binary.mjs"), path.join(stage, "export-binary.mjs"));
const tag = `tiangz-battle-lab:${path.basename(stage).toLowerCase()}`;
console.log(`[battle-k8s] isolated Docker context=${stage}`);
await run("docker", ["build", "--progress=plain", "-f", path.join(here, "Dockerfile"), "-t", tag, stage]);
const stateRoot = stateDirectory(lab);
await mkdir(stateRoot, { recursive: true });
await writeFile(path.join(stateRoot, "k8s-image.json"), JSON.stringify({ tag, stage, moduleGraphHash: catalog.graphHash }, null, 2));
console.log(`[battle-k8s] image=${tag}`);

async function run(command, args) {
  const child = spawn(command, args, { cwd: engine, stdio: "inherit", windowsHide: true });
  await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", code => code === 0 ? resolve() : reject(new Error(`${command} failed (${code})`))); });
}
