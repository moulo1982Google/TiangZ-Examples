import path from "node:path";
import { spawnSync } from "node:child_process";
const root = path.resolve(import.meta.dirname, "..");
const engine = path.resolve(process.env.TIANGZ_ENGINE_ROOT ?? path.join(root, "../../../TiangZ"));
const result = spawnSync(process.execPath, [path.join(engine, "tools/realm_merge_plan.mjs"), "--catalog", path.join(root, "configs/realms/catalog.example.json"),
  "--request", path.join(root, "configs/realms/merge.example.json"),
  "--policy", path.join(root, "modules/slg/policies/realm-merge.json")], { stdio: "inherit", windowsHide: true });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
