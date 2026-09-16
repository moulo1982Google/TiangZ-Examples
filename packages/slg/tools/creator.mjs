import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export async function findCreator() {
  const explicit = process.env.COCOS_CREATOR ?? process.env.COCOS_CREATOR_388;
  if (explicit) {
    if (!existsSync(explicit)) throw new Error("COCOS_CREATOR 路径不存在");
    return explicit;
  }
  const profile = path.join(os.homedir(), ".Cocos/profiles/editor.json");
  try {
    const data = JSON.parse(await readFile(profile, "utf8"));
    const match = Object.values(data.editor ?? {}).flat().find(item => item?.version === "3.8.8" && item?.file && existsSync(item.file));
    if (match) return match.file;
  } catch { /* 无 Dashboard 配置时使用环境变量提示。 */ }
  throw new Error("找不到 Creator 3.8.8，请设置 COCOS_CREATOR 为编辑器可执行文件路径");
}
