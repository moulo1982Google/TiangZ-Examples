import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { access, mkdir, mkdtemp, open, readFile, writeFile, unlink } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { plan, execute } from "./plan.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const lab = path.join(root, "validation/battle");
const engine = path.resolve(root, "../../../TiangZ");
const examples = path.resolve(root, "../..");
const dbproxy = path.resolve(engine, "../TiangZ-DBProxy");
const [profile = "check", ...flags] = process.argv.slice(2);
if (flags.some(flag => !["--plan", "--ci"].includes(flag))) throw new Error("usage: pipeline.mjs check|local|container [--plan] [--ci]");
const steps = plan(profile);
if (flags.includes("--plan")) {
  console.log(JSON.stringify({ profile, steps, target: "isolated local lab only", production: false }, null, 2));
} else {
  try { await main(); }
  catch (error) {
    console.error(`[delivery] ${error.code === "EEXIST" ? "delivery.lock exists: another pipeline is running, or inspect the previous interrupted run before removing its lock" : error.message}`);
    process.exitCode = 1;
  }
}

async function main() {
  const temp = path.join(lab, "temp");
  await mkdir(temp, { recursive: true });
  // 构建共享模块生成目录，所以所有流水线 profile 串行；不能并行运行手动 build/codegen。
  const lockPath = path.join(temp, "delivery.lock");
  const lock = await open(lockPath, "wx");
  let output;
  const report = { formatVersion: 1, profile, ci: flags.includes("--ci"), status: "running",
    startedAt: new Date().toISOString(), node: process.version, platform: process.platform, arch: process.arch,
    sources: {}, steps: [], production: false };
  try {
    output = await mkdtemp(path.join(temp, "delivery-"));
    console.log(`[delivery] report=${path.join(output, "report.json")}`);
    if (Number(process.versions.node.split(".")[0]) !== 24) throw new Error("Node.js 24.x required");
    await access(path.join(engine, "node_modules/esbuild/package.json"));
    for (const [name, directory] of Object.entries({ engine, examples, dbproxy })) {
      let revision = null;
      try { revision = (await command("git", ["rev-parse", "HEAD"], directory)).trim(); } catch { /* 未提交的本地实验显式记录。 */ }
      const status = await command("git", ["status", "--porcelain", "--untracked-files=normal"], directory);
      report.sources[name] = { revision, dirty: !!status.trim(), statusSha256: sha(status) };
      if (report.ci && (!revision || status.trim())) throw new Error(`${name}: CI requires a committed, clean checkout; include untracked source files before migrating`);
    }
    if (Object.values(report.sources).some(source => source.dirty || !source.revision)) {
      console.log("[delivery] 本地未提交源码：报告不可用作可重现的正式发布凭证");
    }
    const env = { ...process.env, BATTLE_LAB_STATE_DIR: output };
    if (profile === "container") {
      await command("docker", ["info", "--format", "{{.OSType}}"], root).then(value => {
        if (value.trim() !== "linux") throw new Error("Docker must run Linux containers");
      });
      await access(path.join(temp, "k8s-tools/kubeconfig"));
      await access(path.join(temp, "k8s-tools", process.platform === "win32" ? "kind.exe" : "kind"));
      await command("kubectl", ["version", "--client=true"], root);
    }
    const tool = name => path.join(engine, "tools", name);
    const modules = path.join(lab, "modules");
    const commands = {
      "routing-tests": ["--test", path.join(lab, "routing.test.mjs"), path.join(lab, "k8s/lab.test.mjs"), path.join(import.meta.dirname, "pipeline.test.mjs")],
      "protocol-check": [tool("codegen_module_protocol.mjs"), "--modules-dir", modules, "--check"],
      "module-typecheck": [tool("typecheck_game_modules.mjs"), "--modules-dir", modules],
      build: [path.join(lab, "run.mjs"), "build"],
      "local-acceptance": [path.join(lab, "run.mjs"), "verify"],
      image: [path.join(lab, "k8s/image.mjs")],
      deploy: [path.join(lab, "k8s/lab.mjs"), "up"],
      "container-acceptance": [path.join(lab, "k8s/lab.mjs"), "verify"],
      cleanup: [path.join(lab, "k8s/lab.mjs"), "down"],
    };
    await execute(steps, async name => {
      console.log(`[delivery] ${name}`);
      if (name === "deploy") {
        const actual = (await command("docker", ["image", "inspect", report.artifact.tag, "--format", "{{.Id}}"], root)).trim();
        if (actual !== report.artifact.imageId) throw new Error("image identity changed after build");
        const client = await readFile(path.join(report.artifact.stage, "runtime/client.mjs"));
        if (sha(client) !== report.artifact.clientSha256) throw new Error("image client changed after build");
      }
      const log = path.join(output, `${name}.log`);
      const tail = await command(process.execPath, commands[name], engine, env, log);
      if (name === "local-acceptance") {
        const evidence = /\[battle\] evidence=(.+)/.exec(tail)?.[1]?.trim();
        if (!evidence || !path.resolve(evidence).startsWith(`${temp}${path.sep}`)) throw new Error("missing local acceptance evidence");
        const receipt = JSON.parse(await readFile(path.join(evidence, "report.json"), "utf8"));
        if (!receipt.passed) throw new Error("local acceptance report did not pass");
        await writeFile(path.join(output, "local-acceptance.json"), JSON.stringify(receipt, null, 2));
      }
      if (name === "image") {
        const artifact = JSON.parse(await readFile(path.join(output, "k8s-image.json"), "utf8"));
        artifact.imageId = (await command("docker", ["image", "inspect", artifact.tag, "--format", "{{.Id}}"], root)).trim();
        artifact.clientSha256 = sha(await readFile(path.join(artifact.stage, "runtime/client.mjs")));
        report.artifact = artifact;
        await writeFile(path.join(output, "artifact.json"), JSON.stringify(artifact, null, 2));
      }
    }, report);
    report.status = "passed";
  } catch (error) {
    report.status = "failed";
    report.error = error.message;
    process.exitCode = 1;
    console.error(`[delivery] ${error.message}`);
    // 不在 finally 删除命名空间，失败现场可能有未知结果，必须先检查。
  } finally {
    try {
      report.finishedAt = new Date().toISOString();
      if (output) {
        await writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2));
        console.log(`[delivery] ${report.status}: ${path.join(output, "report.json")}`);
      }
    } finally { await lock.close(); await unlink(lockPath); }
  }
}

function sha(value) { return createHash("sha256").update(value).digest("hex"); }
async function command(file, args, cwd, env = process.env, logFile) {
  const log = logFile ? createWriteStream(logFile, { flags: "wx" }) : null;
  let tail = "";
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(file, args, { cwd, env, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      log?.on("error", error => { child.kill(); reject(error); });
      for (const stream of [child.stdout, child.stderr]) stream.on("data", data => {
        tail = (tail + data.toString()).slice(-65536);
        log?.write(data);
      });
      child.once("error", reject);
      child.once("close", code => code === 0 ? resolve() : reject(new Error(`${path.basename(file)} exited ${code}; see ${logFile ?? "prerequisite check"}`)));
    });
    return tail;
  } finally { if (log) await new Promise(resolve => log.end(resolve)); }
}
