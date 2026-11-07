import path from "node:path";
import { spawnSync } from "node:child_process";
import { mkdir, realpath, symlink } from "node:fs/promises";
const root = path.resolve(import.meta.dirname, ".."), engine = path.resolve(process.env.TIANGZ_ENGINE_ROOT ?? path.join(root, "../TiangZ"));
const env = { ...process.env };
if (process.platform === "win32") for (const key of ["CC", "CXX"]) if (/^(gcc|g\+\+)(\.exe)?$/i.test(path.basename(env[key] ?? ""))) delete env[key];
const manifest = path.join(root, "modules/mmorpg/rust/Cargo.toml");
const target = path.resolve(engine, env.TIANGZ_NATIVE_TEST_TARGET_DIR ?? "temp/module-native-target");
if (process.platform === "win32") {
  const host = /^host: (.+)$/m.exec(capture("rustc", ["-vV"]))?.[1]?.trim();
  if (!host) throw new Error("cannot determine Rust host target");
  const metadata = JSON.parse(capture("cargo", ["metadata", "--locked", "--format-version", "1", "--filter-platform", host, "--manifest-path", manifest]));
  const v8 = metadata.packages.find(item => item.name === "v8");
  if (v8) {
    const source = await realpath(path.dirname(v8.manifest_path));
    const link = path.join(target, "debug", "gn_root");
    if (path.parse(source).root.toLowerCase() !== path.parse(link).root.toLowerCase()) {
      // V8 跨盘构建使用目录联接，避免要求符号链接特权；不覆盖已有缓存。
      // A junction supplies V8's cross-drive view without symlink privilege or overwriting an existing cache.
      await mkdir(path.dirname(link), { recursive: true });
      let existing;
      try { existing = await realpath(link); } catch (error) { if (error.code !== "ENOENT") throw error; }
      if (existing && existing.toLowerCase() !== source.toLowerCase()) throw new Error("Native test cache refers to another V8 version; set TIANGZ_NATIVE_TEST_TARGET_DIR to a fresh directory");
      if (!existing) await symlink(source, link, "junction");
    }
  }
}
const result = spawnSync("cargo", ["test", "--locked", "--manifest-path", manifest, "--target-dir", target, "--lib", "--test", "native_bridge"], { cwd: engine, env, windowsHide: true, stdio: "inherit" });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;

function capture(command, args) {
  const result = spawnSync(command, args, { cwd: engine, env, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr || result.status}`);
  return result.stdout;
}
