import { spawn } from "node:child_process";
import { lookup } from "node:dns/promises";
import { writeFile } from "node:fs/promises";
import { runtimeConfig } from "./config.mjs";

const managerIp = process.env.BATTLE_ROLE === "worker"
  ? (await lookup("battle-manager", { family: 4 })).address : undefined;
const config = runtimeConfig(process.env, managerIp);
await writeFile("/game/configs/process.json", JSON.stringify(config));
const child = spawn("/game/TiangZ", ["--runtime-root=/game", "/game/configs/process.json"], {
  cwd: "/game", env: { ...process.env, TIANGZ_WATCHER_CONTROL: "stdin" }, stdio: ["pipe", "inherit", "inherit"],
});
let stopping = false;
let timer;
function stop() {
  if (stopping) return;
  stopping = true;
  console.log("[battle-k8s] shutdown requested");
  child.stdin.end("shutdown\n");
  timer = setTimeout(() => { console.error("[battle-k8s] shutdown timed out"); child.kill("SIGKILL"); }, 8000);
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
child.stdin.on("error", error => console.error(error.message));
child.once("error", error => { console.error(error); process.exitCode = 1; });
child.once("close", (code, signal) => {
  clearTimeout(timer);
  console.log(`[battle-k8s] runtime exit code=${code} signal=${signal}`);
  process.exitCode = code === 0 ? 0 : 1;
});
