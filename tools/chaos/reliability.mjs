import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, writeFile, open } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { parseArguments, suites, confirmation } from "./reliability_plan.mjs";
import { root, engine, dbRoot, validationArtifacts } from "./validation_artifacts.mjs";

const options = parseArguments(process.argv.slice(2));
// SLG是显式选择的小规模恢复组；不进入旧MMORPG prepare/contracts清库控制器。
if (options.selected.length === 1 && options.selected[0] === "slg") {
  const packageRoot = path.join(root, "packages/slg");
  const args = options.action === "build" ? ["tools/workspace.mjs", "build"]
    : ["tools/recovery.mjs", options.action, ...(options.action === "run" ? ["--confirm", "isolated-slg-crash-test"] : [])];
  const child = spawn(process.execPath, args, { cwd: packageRoot, windowsHide: true, stdio: "inherit" });
  const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
  process.exit(code ?? 1);
}
const env = { ...process.env };
if (process.platform === "win32") for (const name of ["CC", "CXX"]) if (/(?:gcc|g\+\+)(?:\.exe)?$/i.test(env[name] ?? "")) delete env[name];
const plan = { ...options, suites: options.selected.map(id => ({ id, ...suites[id] })),
  retestChecklist: "tools/chaos/retest-7d-findings.md",
  unresolvedRegression: "cache-write timeout regression is included in postgres_redis contracts, compiled but not executed; service consistency defect not fixed",
  hotfix: { seconds: 180, clients: 500, reloadSeconds: 6, rounds: 20 },
  warning: "DB/game准备会重建dbproxy_local_validation、dbproxy_local_contracts并清空演练Redis；禁止连接业务环境。默认plan不访问Docker或凭据。game阶段不注入数据库停机，但准备仍需要专用存储。",
  evidence: "../.build-tmp/local-validation/reliability-*", status: "planned, not executed" };
if (options.action === "plan") { console.log(JSON.stringify(plan, null, 2)); process.exit(0); }
if (options.action === "check") {
  if (options.selected.includes("hotfix")) await access(path.join(engine, "target/debug", process.platform === "win32" ? "TiangZ.exe" : "TiangZ"));
  if (options.selected.some(id => id !== "hotfix")) await validationArtifacts();
  console.log("制品路径/组合指纹检查通过；未连接数据库、未验证运行时、未启动测试。"); process.exit(0);
}
if (process.platform !== "win32" && options.selected.some(id => id !== "hotfix")) throw Error("DB/game controller currently requires Windows; do not silently use a different test plan");
const base = path.resolve(root, "../.build-tmp/local-validation");
await mkdir(base, { recursive: true });
// 所有新入口串行占用同一演练资源；进程异常退出留下锁时需人工确认，没有自动抢锁。
const lock = await open(path.join(base, "reliability.lock"), "wx");
await lock.writeFile(JSON.stringify({ pid: process.pid, action: options.action, at: new Date().toISOString() }));
let active, cancelled = false, evidence, logIndex = 0;
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => { cancelled = true; void requestStop(); });
async function requestStop() {
  // 不强杀控制器，允许它恢复本轮依赖并回收子进程。
  if (active?.runDirectory) await writeFile(path.join(active.runDirectory, "STOP"), "requested\n");
  else if (active) console.error("已请求停止；等待当前有界构建/热更子步骤自行收尾，不强杀其控制器。");
}
async function command(file, args, cwd, extra = {}, runDirectory) {
  if (cancelled) throw Error("cancelled");
  const child = spawn(file, args, { cwd, env: { ...env, ...extra }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  active = { child, runDirectory };
  const logPath = path.join(evidence, `${String(++logIndex).padStart(2, "0")}.log`);
  const log = createWriteStream(logPath); let tail = "";
  log.on("error", error => { console.error(error.message); cancelled = true; void requestStop(); });
  for (const stream of [child.stdout, child.stderr]) stream.on("data", bytes => { process.stdout.write(bytes); log.write(bytes); tail = (tail + bytes).slice(-65536); });
  let code;
  try { code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); }); }
  finally { active = undefined; await new Promise(resolve => log.end(resolve)); }
  if (code !== 0 || cancelled) throw Error(`step failed/cancelled (${code}); ${logPath}`);
  return tail;
}
const node = (args, cwd = root, extra, runDirectory) => command(process.execPath, args, cwd, extra, runDirectory);
let report;
try {
  evidence = await mkdtemp(path.join(base, "reliability-"));
  report = { status: "running", startedAt: new Date().toISOString(), plan, stages: [] };
  const save = () => writeFile(path.join(evidence, "summary.json"), JSON.stringify(report, null, 2));
  await save();
  if (options.action === "build") {
    if (options.selected.includes("hotfix")) {
      await command(process.platform === "win32" ? "cmd.exe" : "npm", process.platform === "win32" ? ["/d", "/c", "npm.cmd run build"] : ["run", "build"], engine);
      await command("cargo", ["build", "--bin", "TiangZ"], engine);
    }
    if (options.selected.some(id => id !== "hotfix")) {
      await node(["tools/server.mjs", "build"]); await node(["tools/server.mjs", "native-build"]);
      await node(["tools/codegen_sdk.mjs"]); await node(["tools/chaos/build_validation_probes.mjs"]);
      await command("cargo", ["build", "--release", "--locked", "--bin", "map_probe_load", "--bin", "validation_resource_snapshot", "-j1"], engine);
      await command("cargo", ["build", "--release", "--locked", "--workspace", "--bins", "-j1"], dbRoot);
      await validationArtifacts();
    }
    report.status = "built-not-tested";
  } else {
    // 所有前置制品先检查，不能跑完热更后才发现DB/game没有构建。
    if (options.selected.some(id => id !== "hotfix")) await validationArtifacts();
    for (const id of options.selected) {
      const stage = { id, status: "running", startedAt: new Date().toISOString() }; report.stages.push(stage); await save();
      if (id === "hotfix") {
        const load = await node(["tools/hotfix_load_soak.mjs", "--seconds", "180", "--clients", "500", "--reload-seconds", "6", "--rpc-timeout-ms", "30000"], engine);
        const faults = await node(["tools/hotfix_fault_matrix.mjs", "--rounds", "20"], engine);
        const paths = [load.match(/\[hotfix-load\] passed: (.+)/)?.[1]?.trim(), faults.match(/\[hotfix-faults\] passed: (.+)/)?.[1]?.trim()];
        if (paths.some(file => !file)) throw Error("missing hotfix evidence");
        const results = await Promise.all(paths.map(async file => JSON.parse(await readFile(file, "utf8"))));
        if (results.some(result => result.status !== "passed") || results[0].binarySha256 !== results[1].binarySha256) throw Error("hotfix reports/hash mismatch");
        stage.reports = paths; stage.binarySha256 = results[0].binarySha256;
      } else {
        const directory = path.join(evidence, id); await mkdir(directory);
        const extra = { TIANGZ_LOCAL_VALIDATION_CONFIRM: confirmation, TIANGZ_VALIDATION_SUITE: id };
        for (const mode of ["--prepare", "--contracts"]) await node(["tools/chaos/run_local_validation.mjs", mode, directory], root, extra, directory);
        await node(["tools/chaos/run_local_validation.mjs", "--run", directory, String(options.seconds), String(options.players), suites[id].actions.join(","), "10000"], root, extra, directory);
        await node(["tools/chaos/audit_local_validation.mjs", directory]);
        stage.report = path.join(directory, "final.json");
      }
      stage.status = "passed"; stage.finishedAt = new Date().toISOString(); await save();
    }
    report.status = "passed";
  }
} catch (error) {
  if (report) { report.status = cancelled ? "cancelled" : "failed"; report.error = String(error);
    for (const stage of report.stages) if (stage.status === "running") { stage.status = report.status; stage.error = String(error); }
  }
  console.error(error); process.exitCode = 1;
} finally {
  if (report) { report.finishedAt = new Date().toISOString(); await writeFile(path.join(evidence, "summary.json"), JSON.stringify(report, null, 2)); console.log(`可靠性报告：${evidence}/summary.json`); }
  await lock.close();
  const { unlink } = await import("node:fs/promises"); await unlink(path.join(base, "reliability.lock"));
}
