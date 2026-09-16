import path from "node:path";

// 流水线只替换实验状态位置；集群凭据仍固定在本工程，不读取默认 context。
export function stateDirectory(lab, value = process.env.BATTLE_LAB_STATE_DIR) {
  const base = path.resolve(lab, "temp");
  if (!value) return base;
  const target = path.resolve(value);
  const relative = path.relative(base, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("BATTLE_LAB_STATE_DIR must be a child of battle/temp");
  return target;
}
