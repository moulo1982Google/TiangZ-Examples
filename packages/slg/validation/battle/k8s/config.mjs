import { isIPv4 } from "node:net";

// 容器部署适配，不把 Pod 身份/环境变量带入游戏 Core。
export function runtimeConfig(env, managerIp) {
  const role = env.BATTLE_ROLE;
  if (!["manager", "worker"].includes(role)) throw new Error("invalid BATTLE_ROLE");
  if (!isIPv4(env.POD_IP)) throw new Error("POD_IP must be IPv4");
  let workerId = 0;
  let name = "manager";
  if (role === "worker") {
    const match = /^battle-worker-([0-2])$/.exec(env.POD_NAME ?? "");
    if (!match || !/^[a-f0-9-]{36}$/.test(env.POD_UID ?? "")) throw new Error("invalid worker Pod identity");
    if (!isIPv4(managerIp)) throw new Error("manager must resolve to IPv4");
    workerId = Number(match[1]) + 1;
    // 重建 Pod 不接管旧节点回执；此实验不自动重投结果未知的任务。
    name = `worker-${match[1]}-${env.POD_UID}`;
  }
  return {
    process: { name, identity: { originServerId: 94, workerId },
      observability: { health: { ip: "0.0.0.0", port: 3001 } } },
    scenes: [{ name, sceneType: role === "worker" ? "BattleHost" : "BattleManager",
      innerIp: env.POD_IP, bindIp: "0.0.0.0", port: 3000, protocol: "auto", audience: "mixed" }],
    knownScenes: role === "worker" ? [{ name: "manager", sceneType: "BattleManager", innerIp: managerIp,
      port: 3000, protocol: "auto", audience: "mixed" }] : [],
  };
}
