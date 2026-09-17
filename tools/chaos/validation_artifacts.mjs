import path from "node:path";
import { access, readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export const root = path.resolve(import.meta.dirname, "../..");
export const engine = path.resolve(root, "../TiangZ");
export const dbRoot = path.resolve(root, "../TiangZ-DBProxy");

// 只读检查必须在任何演练数据清理之前完成；普通宿主不能冒充MMORPG组合宿主。
export async function validationArtifacts() {
  const { resolveModuleRuntimeBinary } = await import(pathToFileURL(path.join(engine, "tools/module_runtime_binary.mjs")));
  const binary = await resolveModuleRuntimeBinary({ engineRoot: engine, modulesDirectory: path.join(root, "modules") });
  const files = new Map([["bin/TiangZ.exe", binary]]);
  for (const name of ["map_probe_load", "validation_resource_snapshot"]) files.set(`bin/${name}.exe`, path.join(engine, `target/release/${name}.exe`));
  for (const name of ["tiangz-dbproxy-server", "dbproxy_fault_soak", "dbproxy_relay_soak", "dbproxy_aof_probe"]) files.set(`bin/${name}.exe`, path.join(dbRoot, `target/release/${name}.exe`));
  for (const name of ["model.js", "model.manifest.json", "hotfix.js", "hotfix.manifest.json"]) files.set(`dist/${name}`, path.join(root, "dist", name));
  for (const name of ["player_trade_persistence_probe", "dynamic_map_fallback_probe"]) files.set(`dist/${name}.cjs`, path.join(root, `dist/reliability/${name}.cjs`));
  for (const source of files.values()) await access(source);
  for (const source of ["dist/game-config/game-config.manifest.json", "configs/deploy/external-2process/login-gate.json", "configs/deploy/external-2process/world.json"]) JSON.parse(await readFile(path.join(root, source), "utf8"));
  await access(path.join(root, "navigation"));
  return files;
}
