import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";

const packageRoot = path.resolve(import.meta.dirname, "..");
const examples = path.resolve(packageRoot, "../..");
const args = process.argv.slice(2);
const options = new Map();
for (let index = 0; index < args.length; index++) {
  const flag = args[index];
  if (!["--input", "--output", "--check"].includes(flag) || options.has(flag)) throw new Error(`invalid map deployment option: ${flag}`);
  const value = flag === "--check" ? true : args[++index];
  if (!value || (typeof value === "string" && value.startsWith("--"))) throw new Error(`${flag} requires a path`);
  options.set(flag, value);
}
const input = path.resolve(options.get("--input") ?? path.join(packageRoot, "configs/local/map-deployment.json"));
const output = path.resolve(options.get("--output") ?? path.join(packageRoot, "configs/local/map-deployment/runtime.pack.json"));
if (input === output || path.basename(output) !== "runtime.pack.json") throw new Error("output must be a separate runtime.pack.json file, as required by the host");
// 直接构建模块纯校验器，避免维护第二份部署字段规则或执行游戏初始化。
// Bundle the module's pure validator without a second ruleset or game initialization.
const compiled = await build({ entryPoints: [path.join(examples, "modules/mmorpg/src/model/mapHost/MapHostDeployment.ts")], bundle: true, write: false, platform: "node", format: "esm", target: "node20", logLevel: "silent" });
const contracts = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].contents).toString("base64")}`);
const payload = contracts.ValidateMapHostDeploymentPayload(JSON.parse(await readFile(input, "utf8")));
const payloadText = JSON.stringify(payload);
const pack = { formatVersion: 1, id: contracts.MAP_DEPLOYMENT_PACK_ID, ownerModuleId: contracts.MAP_DEPLOYMENT_OWNER,
  contentHash: createHash("sha256").update(payloadText).digest("hex"), source: path.relative(examples, input).replaceAll("\\", "/"), payload };
const text = `${JSON.stringify(pack, null, 2)}\n`;
if (options.has("--check")) {
  const existing = await readFile(output, "utf8").catch(error => { throw new Error(`map deployment pack is unavailable; run MMORPG setup/build (${error.code})`); });
  if (existing.replaceAll("\r\n", "\n") !== text) throw new Error("map deployment pack is stale; run MMORPG setup/build");
} else {
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, text);
}
console.log(`[mmorpg-deployment] ${options.has("--check") ? "checked" : "generated"} ${pack.id} ${pack.contentHash.slice(0, 12)}`);
