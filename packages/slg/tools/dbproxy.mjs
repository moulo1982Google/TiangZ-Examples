import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { slgRuntimeEnvironment } from "./local_environment.mjs";

const root = path.resolve(import.meta.dirname, "..");
const envFile = path.join(root, "infra/dbproxy/.env");
const composeFile = path.join(root, "infra/dbproxy/docker-compose.yml");
const action = process.argv[2] ?? "check";
if (!["up", "check", "smoke", "ps", "stop"].includes(action)) throw new Error(`未知 DBProxy 操作：${action}`);
if (action === "up" && !existsSync(envFile)) {
  const content = ["SLG_POSTGRES_PASSWORD", "SLG_REDIS_PASSWORD", "SLG_DBPROXY_AUTH_TOKEN"]
    .map(key => `${key}=${randomBytes(32).toString("hex")}`).join("\n") + "\n";
  await writeFile(envFile, content, { flag: "wx", mode: 0o600 });
  console.log("[SLG] 已生成独立本地密钥，不输出密钥内容；.env 不纳入 Git");
}
if (!existsSync(envFile)) throw new Error("请先运行 npm run dbproxy:up");
const prefix = ["compose", "--project-name", "tiangz-slg-dbproxy", "--env-file", envFile, "-f", composeFile];
if (action === "up") {
  await docker(...prefix, "config", "--quiet");
  await docker(...prefix, "up", "-d", "--build", "--wait", "--wait-timeout", "120");
  await ready();
} else if (action === "check") {
  await ready();
} else if (action === "smoke") {
  await ready();
  const engine = path.resolve(process.env.TIANGZ_ENGINE_ROOT ?? path.join(root, "../../../TiangZ"));
  const env = await slgRuntimeEnvironment();
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(engine, "tools/module_dbproxy_migration_self_test.mjs"), "--endpoint", "127.0.0.1:18700"], { cwd: engine, env, stdio: "inherit", windowsHide: true });
    child.once("error", reject);
    child.once("exit", code => code === 0 ? resolve() : reject(new Error(`DBProxy SDK 读写验收失败：${code}`)));
  });
} else {
  await docker(...prefix, action);
}

async function ready() {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch("http://127.0.0.1:18900/ready", { signal: AbortSignal.timeout(3000) });
      if (response.ok) {
        const dependencies = await fetch("http://127.0.0.1:18900/dependencies", { signal: AbortSignal.timeout(3000) });
        if (dependencies.ok) {
          console.log("[SLG] DBProxy Ready，PostgreSQL/Redis 依赖检查通过；接口 127.0.0.1:18700");
          return;
        }
      }
    } catch { /* 启动期短暂不可达，继续等待，超时明确失败。 */ }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error("SLG DBProxy 未就绪，请运行 npm run dbproxy:ps 检查容器");
}

function docker(...args) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, { cwd: root, stdio: "inherit", windowsHide: true });
    child.once("error", reject);
    child.once("exit", code => code === 0 ? resolve() : reject(new Error(`Docker 操作失败：${code}`)));
  });
}
