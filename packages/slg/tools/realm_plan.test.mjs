import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";

test("SLG declares rebuild outside the engine; CLI only prints a pending plan", () => {
  const result = spawnSync(process.execPath, [path.join(import.meta.dirname, "realm_plan.mjs")], {
    encoding: "utf8", windowsHide: true, timeout: 10000,
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.formatVersion, 2);
  assert.equal(plan.executable, false);
  assert.equal(plan.modulePolicy.ownerModuleId, "org.tiangz.slg");
  assert.deepEqual(plan.modulePolicy.decisions.find(item => item.domain === "world-occupancy"), {
    domain: "world-occupancy", action: "discard-and-rebuild",
  });
  assert.ok(plan.blockers.includes("unresolved-domain:march-settlement"));
  assert.ok(plan.phases.every(phase => phase.status === "pending"));
});
