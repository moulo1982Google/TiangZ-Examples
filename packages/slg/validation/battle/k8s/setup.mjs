import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { chmod, mkdir, readFile, access } from "node:fs/promises";
import path from "node:path";

const root = import.meta.dirname;
const directory = path.resolve(root, "../temp/k8s-tools");
const version = "v0.33.0";
const platform = process.platform === "win32" ? "windows" : process.platform;
if (!["windows", "linux", "darwin"].includes(platform) || !["x64", "arm64"].includes(process.arch)) throw new Error("unsupported kind platform");
const asset = `kind-${platform}-${process.arch === "x64" ? "amd64" : "arm64"}`;
const binary = path.join(directory, platform === "windows" ? "kind.exe" : "kind");
const checksumFile = path.join(directory, "kind.sha256");
await mkdir(directory, { recursive: true });
try { await access(binary); } catch (error) {
  if (error.code !== "ENOENT") throw error;
  await run(platform === "windows" ? "curl.exe" : "curl", ["-fL", "--retry", "2", "--max-time", "180", "-o", binary,
    `https://github.com/kubernetes-sigs/kind/releases/download/${version}/${asset}`]);
}
try { await access(checksumFile); } catch (error) {
  if (error.code !== "ENOENT") throw error;
  await run(platform === "windows" ? "curl.exe" : "curl", ["-fL", "--retry", "2", "--max-time", "60", "-o", checksumFile,
    `https://github.com/kubernetes-sigs/kind/releases/download/${version}/${asset}.sha256sum`]);
}
const expected = (await readFile(checksumFile, "utf8")).trim().split(/\s+/)[0];
if (!/^[a-f0-9]{64}$/.test(expected) || createHash("sha256").update(await readFile(binary)).digest("hex") !== expected) {
  throw new Error("kind checksum mismatch; inspect download files, do not execute them");
}
if (platform !== "windows") await chmod(binary, 0o755);
await run(binary, ["version"]);
// get clusters 只读；已有同名集群不自动重建，也不覆盖 kubeconfig。
const clusters = await run(binary, ["get", "clusters"], true);
if (clusters.split(/\s+/).includes("tiangz-battle-lab")) {
  await access(path.join(directory, "kubeconfig"));
  console.log("[battle-k8s] cluster exists; checking its API");
} else {
  await run(binary, ["create", "cluster", "--name", "tiangz-battle-lab", "--config", path.join(root, "kind.yaml"),
    "--kubeconfig", path.join(directory, "kubeconfig"), "--wait", "180s"]);
}
await run("kubectl", ["--kubeconfig", path.join(directory, "kubeconfig"), "--context", "kind-tiangz-battle-lab", "--request-timeout=15s", "get", "nodes"]);
await run("kubectl", ["--kubeconfig", path.join(directory, "kubeconfig"), "--context", "kind-tiangz-battle-lab",
  "wait", "--for=condition=Ready", "nodes", "--all", "--timeout=180s"]);
await run("kubectl", ["--kubeconfig", path.join(directory, "kubeconfig"), "--context", "kind-tiangz-battle-lab",
  "-n", "kube-system", "rollout", "status", "deployment/coredns", "--timeout=180s"]);
async function run(command, args, capture = false) {
  const child = spawn(command, args, { windowsHide: true, stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit" });
  let output = "";
  child.stdout?.on("data", data => { output += data; });
  await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", code => code === 0 ? resolve() : reject(new Error(`${command} failed: ${code}`))); });
  return output;
}
