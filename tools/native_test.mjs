import path from "node:path";
import { spawnSync } from "node:child_process";
const root = path.resolve(import.meta.dirname, ".."), engine = path.resolve(root, "../TiangZ");
const env = { ...process.env };
if (process.platform === "win32") for (const key of ["CC", "CXX"]) if (/^(gcc|g\+\+)(\.exe)?$/i.test(path.basename(env[key] ?? ""))) delete env[key];
const result = spawnSync("cargo", ["test", "--locked", "--manifest-path", path.join(root, "modules/mmorpg/rust/Cargo.toml"), "--target-dir", path.join(engine, "temp/module-native-target"), "--lib", "--test", "native_bridge"], { cwd: engine, env, windowsHide: true, stdio: "inherit" });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
