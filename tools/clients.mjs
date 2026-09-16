import path from "node:path";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const root = path.resolve(import.meta.dirname, "..");
const engine = path.resolve(process.env.TIANGZ_ENGINE_ROOT ?? path.join(root, "../TiangZ"));
const command = process.argv[2];
function run(file, args = [], cwd = root) {
  const result = spawnSync(process.execPath, [file, ...args], { cwd, stdio: "inherit", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${path.basename(file)} failed: ${result.status}`);
}
function tool(name, args) { run(path.join(root, "node_modules", name, "bin", name === "typescript" ? "tsc" : name), args); }

if (command === "sdk:sync" || command === "sdk:check") {
  run(path.join(engine, "tools/publish_client_sdk.mjs"), ["--project", root, ...(command === "sdk:check" ? ["--check"] : [])]);
} else if (command === "check") {
  const externalConfig = JSON.parse(await readFile(path.join(root, "clients/cocos_client3D_3.8.8/assets/resources/Config/tiangz-external.json"), "utf8"));
  if (externalConfig.secure !== true) throw new Error("external Cocos3D must use WSS");
  run(path.join(import.meta.dirname, "clients.mjs"), ["sdk:check"]);
  tool("typescript", ["-p", "clients/cocos_client2D_3.8.6/tsconfig.protocol.json"]);
  tool("typescript", ["-p", "clients/pixi_client_8.19.0/tsconfig.json"]);
  for (const script of ["typecheck_cocos_demo.mjs", "typecheck_cocos3d_demo.mjs", "check_godot_demo.mjs"]) run(path.join(import.meta.dirname, script));
  tool("esbuild", ["tools/movement_prediction_self_test.ts", "--bundle", "--platform=node", "--format=cjs", "--tsconfig=clients/cocos_client2D_3.8.6/tsconfig.bundle.json", "--outfile=dist/movement_prediction.cjs"]);
  run(path.join(root, "dist/movement_prediction.cjs"));
} else if (command === "build:pixi") {
  tool("esbuild", ["clients/pixi_client_8.19.0/src/main.ts", "--bundle", "--platform=browser", "--format=esm", "--target=es2022", "--sourcemap", "--outfile=clients/pixi_client_8.19.0/dist/app.js"]);
} else {
  throw new Error("expected sdk:sync, sdk:check, check or build:pixi");
}
