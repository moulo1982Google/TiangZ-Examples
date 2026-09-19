import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { parseArguments, confirmation, suites, assertCoverage, assertRunDirectory } from "./reliability_plan.mjs";

test("default is a side-effect-free three-suite plan", () => {
  assert.deepEqual(parseArguments([]).selected, ["hotfix", "dbproxy", "game"]);
  assert.equal(parseArguments([]).action, "plan");
  const run = spawnSync(process.execPath, [path.join(import.meta.dirname, "reliability.mjs"), "plan"], { encoding: "utf8", cwd: path.parse(process.cwd()).root });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(JSON.parse(run.stdout).status, "planned, not executed");
});
test("execution requires explicit destructive-scope confirmation", () => {
  assert.throws(() => parseArguments(["run"]), /confirmation|confirm/);
  assert.throws(() => parseArguments(["run", "--confirm", "yes"]));
  assert.equal(parseArguments(["run", "--suite", "game", "--confirm", confirmation]).action, "run");
  const run = spawnSync(process.execPath, [path.join(import.meta.dirname, "run_local_validation.mjs"), "--prepare", "invalid"], {
    encoding: "utf8", env: { ...process.env, TIANGZ_LOCAL_VALIDATION_CONFIRM: "" },
  });
  assert.notEqual(run.status, 0); assert.match(run.stderr, /explicit local destructive-test confirmation/);
});
test("invalid options, duplicates and budgets fail closed", () => {
  for (const args of [["start"], ["plan", "--suite", "typo"], ["run", "--confirm"], ["plan", "--seconds", "1"],
    ["plan", "--players", "201"], ["plan", "--suite", "game", "--suite", "dbproxy"], ["plan", "--unknown", "x"]]) assert.throws(() => parseArguments(args));
});
test("game faults cannot accidentally include storage shutdown", () => {
  assert.equal(suites.game.actions.some(action => suites.dbproxy.actions.includes(action)), false);
  assert.ok(suites.game.actions.includes("gate1")); assert.ok(suites.game.actions.includes("game-all"));
});
test("SLG is explicit and cannot silently become a load test", () => {
  assert.deepEqual(parseArguments(["plan", "--suite", "slg"]).selected, ["slg"]);
  assert.throws(() => parseArguments(["plan", "--suite", "slg", "--players", "100"]));
  const result = spawnSync(process.execPath, [path.join(import.meta.dirname, "reliability.mjs"), "plan", "--suite", "slg"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr); assert.equal(JSON.parse(result.stdout).players, 3);
});
test("write-mode soak is explicit, engine-owned and budgeted for a full fault cycle", () => {
  assert.deepEqual(parseArguments(["plan", "--suite", "write-modes"]).selected, ["write-modes"]);
  assert.equal(parseArguments(["plan", "--suite", "write-modes"]).players, 10);
  assert.equal(parseArguments(["plan", "--suite", "game"]).players, 100);
  assert.equal(parseArguments([]).selected.includes("write-modes"), false);
  assert.throws(() => parseArguments(["plan", "--suite", "write-modes", "--seconds", "600"]), /900/);
  assert.throws(() => parseArguments(["plan", "--suite", "write-modes", "--players", "150"]), /100/);
  assert.equal(suites["write-modes"].actions.includes("probe-restart"), true);
  const result = spawnSync(process.execPath, [path.join(import.meta.dirname, "reliability.mjs"), "plan", "--suite", "write-modes"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.status, "planned, not executed");
  assert.deepEqual(plan.schedule.order, suites["write-modes"].actions);
});
test("partial coverage cannot pass even with a completed time window", () => {
  assert.throws(() => assertCoverage(suites.game.actions, ["map1"]), /coverage incomplete/);
  assert.doesNotThrow(() => assertCoverage(suites.dbproxy.actions, [...suites.dbproxy.actions, "postgres"]));
});
test("evidence paths cannot escape the dedicated root or equal it", () => {
  const base = path.resolve("temporary-evidence");
  for (const target of [base, path.resolve(base, ".."), `${base}-other/run`]) assert.throws(() => assertRunDirectory(base, target));
  assert.doesNotThrow(() => assertRunDirectory(base, path.join(base, "run", "game")));
});
