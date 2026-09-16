import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { selectExample } from "./example_package.mjs";

const root = path.resolve(import.meta.dirname, "..");
test("SLG selects only its own entry and output", async () => {
  const value = await selectExample("build", ["--package", "slg"]);
  assert.equal(value.entry, path.join(root, "packages/slg/tools/workspace.mjs"));
  assert.equal(value.output, path.join(root, "packages/slg/dist"));
});
test("MMORPG output is separate", async () => {
  const value = await selectExample("build", ["--package", "mmorpg"]);
  assert.equal(value.output, path.join(root, "packages/mmorpg/dist"));
});
for (const args of [[], ["--package", "../slg"], ["--package", "unknown"],
  ["--package", "slg", "--package", "mmorpg"], ["--package", "slg", "--all"],
  ["--package", "slg", "--out-dir", "../dist"]]) {
  test(`invalid selection is rejected: ${args.join(" ")}`, async () => {
    await assert.rejects(selectExample("build", args));
  });
}
test("unsupported action does not fall back to another package", async () => {
  await assert.rejects(selectExample("client-build", ["--package", "mmorpg"]), /不支持/u);
});
test("dry-run works outside the repository without executing the entry", () => {
  const result = spawnSync(process.execPath, [path.join(root, "tools/example_package.mjs"), "start", "--package", "slg", "--dry-run"],
    { cwd: path.dirname(root), encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  const selected = JSON.parse(result.stdout);
  assert.equal(selected.dryRun, true);
  assert.equal(selected.name, "slg");
});
