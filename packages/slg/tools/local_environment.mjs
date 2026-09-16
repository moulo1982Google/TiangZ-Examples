import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import path from "node:path";

export async function slgRuntimeEnvironment(base = process.env) {
  const file = path.resolve(import.meta.dirname, "../infra/dbproxy/.env");
  const local = parseEnv(await readFile(file, "utf8").catch(() => {
    throw new Error("SLG DBProxy 密钥尚未准备，请运行 npm run dbproxy:up");
  }));
  if (!local.SLG_DBPROXY_AUTH_TOKEN) throw new Error("SLG DBProxy 本地令牌缺失");
  return { ...base, TIANGZ_DBPROXY_AUTH_TOKEN: local.SLG_DBPROXY_AUTH_TOKEN };
}
