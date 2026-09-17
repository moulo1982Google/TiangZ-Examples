import path from "node:path";

export const confirmation = "reset-local-validation-data-and-inject-faults";
export const suites = Object.freeze({
  slg: { title: "SLG小规模游戏崩溃恢复", actions: [], scope: "独立新建存储；3玩家；提交前/丢ACK强杀、恢复及SQL对账；不进入旧prepare清库流程" },
  hotfix: { title: "Hotfix/config原子热更", actions: [], scope: "独立夹具：负载、跨进程、排队、坏候选、回滚和停机；不停止数据库" },
  dbproxy: { title: "DBProxy存储故障恢复", actions: ["postgres", "cache", "redis", "aof", "dbproxy1", "dbproxy2"], scope: "本机专用演练库/Redis及两个自有DBProxy节点；最终SQL/Stream对账" },
  game: { title: "游戏进程崩溃恢复", actions: ["map1", "map2", "map2-orphan", "location", "gate1", "gate2", "dynamic", "game-all"], scope: "只强杀自有游戏进程；数据库保持运行；同账号两轮恢复和交易复核" },
});

export function parseArguments(argv) {
  const [action = "plan", ...rest] = argv;
  if (!["plan", "check", "build", "run"].includes(action)) throw Error("expected plan/check/build/run");
  const values = new Map();
  for (let i = 0; i < rest.length; i += 2) {
    if (!["--suite", "--seconds", "--players", "--confirm"].includes(rest[i]) || !rest[i + 1] || values.has(rest[i])) throw Error("invalid/duplicate option");
    values.set(rest[i], rest[i + 1]);
  }
  const suite = values.get("--suite") ?? "all";
  if (suite !== "all" && !Object.hasOwn(suites, suite)) throw Error("unknown suite");
  const seconds = Number(values.get("--seconds") ?? 3600), players = Number(values.get("--players") ?? 100);
  if (!Number.isInteger(seconds) || seconds < 600 || seconds > 14400) throw Error("seconds must be 600..14400 per DB/game suite");
  if (!Number.isInteger(players) || players < 2 || players > 200) throw Error("players must be 2..200");
  if (action === "run" && values.get("--confirm") !== confirmation) throw Error(`run requires --confirm ${confirmation}`);
  if (suite === "slg" && (values.has("--seconds") || values.has("--players"))) throw Error("slg uses a fixed small correctness matrix; no load/soak parameters");
  return { action, selected: suite === "all" ? ["hotfix", "dbproxy", "game"] : [suite], seconds, players };
}

export function assertCoverage(actions, completed) {
  const missing = actions.filter(action => !completed.includes(action));
  if (missing.length) throw Error(`fault coverage incomplete: ${missing.join(",")}; increase duration, never count partial coverage as passed`);
}

export function assertRunDirectory(base, directory) {
  const relative = path.relative(path.resolve(base), path.resolve(directory));
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw Error("run must be a child of the dedicated evidence root");
}
