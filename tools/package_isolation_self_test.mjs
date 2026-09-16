import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
async function snapshot(directory) {
  const files = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) Object.assign(files, await snapshot(file));
    else if (entry.isFile()) files[file] = { hash: createHash("sha256").update(await readFile(file)).digest("hex"), modified: (await stat(file)).mtimeMs };
  }
  return files;
}
// 显式运行完整 SLG 构建，验证不会写 MMORPG 制品或生成物。
// Explicit full SLG build; MMORPG artifacts and generated source must stay untouched.
const roots = ["modules/mmorpg/generated", "modules/mmorpg/src/model/generated", "packages/mmorpg/dist"];
const before = await Promise.all(roots.map(file => snapshot(path.join(root, file))));
const result = spawnSync(process.execPath, [path.join(root, "tools/example_package.mjs"), "build", "--package", "slg"],
  { cwd: root, stdio: "inherit", windowsHide: true });
assert.equal(result.status, 0, result.error?.message);
const after = await Promise.all(roots.map(file => snapshot(path.join(root, file))));
assert.deepEqual(after, before);
const slg = JSON.parse(await readFile(path.join(root, "packages/slg/dist/model.manifest.json"), "utf8"));
assert.deepEqual(slg.modules.map(module => module.id), ["org.tiangz.slg"]);
console.log("SLG isolated build passed: MMORPG bytes/mtimes unchanged; only SLG is in the module graph.");
