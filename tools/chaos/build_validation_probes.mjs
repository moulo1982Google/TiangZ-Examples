import path from "node:path";
import { build } from "esbuild";
import { root, engine } from "./validation_artifacts.mjs";
const args = process.argv.slice(2);
if (args.length && (args.length !== 1 || args[0] !== "--check")) throw Error("use --check for no-output bundling validation");

// 历史手写探针继续复用正式生成的SDK/codec；只修正迁移后的输入解析，不修改生成物。
const sdkPaths = { name: "current-example-sdk", setup(context) {
  context.onResolve({ filter: /client_sdk\/typescript\// }, args => {
    const suffix = args.path.split("client_sdk/typescript/")[1];
    if (!suffix || suffix.includes("..")) throw Error("invalid SDK import");
    return { path: path.join(root, "client_sdk/typescript", `${suffix}.ts`) };
  });
} };
for (const [name, entry] of [
  ["player_trade_persistence_probe", path.join(root, "legacy/tools/player_trade_persistence_probe.ts")],
  ["dynamic_map_fallback_probe", path.join(engine, "tools/dynamic_map_fallback_probe.ts")],
]) await build({ entryPoints: [entry], outfile: path.join(root, `dist/reliability/${name}.cjs`), bundle: true,
  platform: "node", format: "cjs", target: "node24", plugins: [sdkPaths], write: !args.includes("--check") });
console.log(args.includes("--check") ? "探针静态打包检查通过；未写产物、未运行探针。" : "探针构建完成；未运行探针。");
