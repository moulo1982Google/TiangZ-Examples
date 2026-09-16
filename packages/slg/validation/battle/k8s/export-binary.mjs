import { copyFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { resolveModuleRuntimeBinary } from "./TiangZ/tools/module_runtime_binary.mjs";

const binary = await resolveModuleRuntimeBinary({ engineRoot: "/workspace/TiangZ", modulesDirectory: "/workspace/modules" });
const manifest = path.resolve(path.dirname(binary), "../../debug.manifest.json");
await readFile(manifest); // 缺少构建证据必须失败。
await mkdir("/output");
await copyFile(binary, "/output/TiangZ");
await copyFile(manifest, "/output/build.manifest.json");
