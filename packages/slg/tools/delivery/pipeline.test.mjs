import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { plan, execute } from "./plan.mjs";
import { stateDirectory } from "../../validation/battle/k8s/paths.mjs";

test("检查不启动服务，容器发布使用构建后的同一镜像且验收后才清理", () => {
  assert.deepEqual(plan("check"), ["routing-tests", "protocol-check", "module-typecheck"]);
  assert.deepEqual(plan("container").slice(-4), ["image", "deploy", "container-acceptance", "cleanup"]);
  assert.throws(() => plan("production"));
});
test("失败返回原错误，后续步骤和清理不执行，现场不会被掩盖", async () => {
  const record = { steps: [] }, calls = [];
  await assert.rejects(execute(["deploy", "verify", "cleanup"], async name => {
    calls.push(name); if (name === "verify") throw new Error("bad result");
  }, record), /bad result/);
  assert.deepEqual(calls, ["deploy", "verify"]);
  assert.deepEqual(record.steps.map(step => step.status), ["passed", "failed"]);
  assert(record.steps.every(step => step.finishedAt));
});
test("成功顺序执行并留下每步回执", async () => {
  const record = { steps: [] };
  await execute(["check", "build"], async () => {}, record);
  assert(record.steps.every(step => step.status === "passed"));
});
test("流水线状态限定在实验 temp 子目录，与手工练习分离", () => {
  const lab = path.resolve("lab");
  assert.equal(stateDirectory(lab, ""), path.join(lab, "temp"));
  assert.equal(stateDirectory(lab, path.join(lab, "temp/delivery-123")), path.join(lab, "temp/delivery-123"));
  for (const target of [lab, path.join(lab, "temp"), path.resolve("outside")]) assert.throws(() => stateDirectory(lab, target));
});
