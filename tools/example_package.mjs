import path from "node:path";
import { readFile, realpath, readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

const repository = path.resolve(import.meta.dirname, "..");

export async function selectExample(action, args, root = repository) {
  let name, dryRun = false;
  for (let index = 0; index < args.length; index++) {
    const value = args[index];
    if (value === "--dry-run" && !dryRun) { dryRun = true; continue; }
    if (value === "--package" && name === undefined && args[index + 1]) { name = args[++index]; continue; }
    throw new Error(`未知或重复参数：${value}`);
  }
  if (!name || !/^[a-z][a-z0-9-]*$/u.test(name)) throw new Error("请指定一个包名，例如 --package slg；不支持路径或隐式构建全部包");
  const packages = await realpath(path.join(root, "packages"));
  const directory = await realpath(path.join(packages, name)).catch(() => { throw new Error(`不存在示例包：${name}`); });
  if (path.dirname(directory) !== packages) throw new Error("示例包不能通过联接逃逸 packages 目录");
  const manifest = JSON.parse(await readFile(path.join(directory, "tiangz.example.json"), "utf8"));
  if (manifest.formatVersion !== 1 || manifest.name !== name || !Array.isArray(manifest.actions)
      || !manifest.actions.every(value => typeof value === "string") || typeof manifest.entry !== "string") throw new Error(`示例包清单无效：${name}`);
  if (!manifest.actions.includes(action)) throw new Error(`${name} 不支持 ${action}；可用操作：${manifest.actions.join(", ")}`);
  const entry = await realpath(path.resolve(directory, manifest.entry));
  if (!entry.startsWith(directory + path.sep) || !entry.endsWith(".mjs")) throw new Error("示例包入口必须是包内的 .mjs 文件");
  return { name, action, directory, entry, output: path.join(directory, "dist"), dryRun };
}

async function main() {
  const [action, ...args] = process.argv.slice(2);
  if (action === "list" && args.length === 0) {
    for (const item of await readdir(path.join(repository, "packages"), { withFileTypes: true })) {
      if (!item.isDirectory()) continue;
      const manifest = JSON.parse(await readFile(path.join(repository, "packages", item.name, "tiangz.example.json"), "utf8"));
      console.log(`${manifest.name}: ${manifest.actions.join(", ")}`);
    }
    return;
  }
  const selected = await selectExample(action, args);
  if (selected.dryRun) { console.log(JSON.stringify(selected, null, 2)); return; }
  console.log(`[example] ${selected.name}: ${selected.action} -> ${selected.output}`);
  // 不使用 Shell 或继承另一游戏的模块目录。 / No shell or inherited module selection.
  const env = { ...process.env }; delete env.TIANGZ_MODULES_DIR;
  const child = spawn(process.execPath, [selected.entry, action], { cwd: selected.directory, env, stdio: "inherit", windowsHide: true });
  process.exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject); child.once("exit", code => resolve(code ?? 1));
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main().catch(error => { console.error(`[example] ${error.message}`); process.exitCode = 1; });
}
