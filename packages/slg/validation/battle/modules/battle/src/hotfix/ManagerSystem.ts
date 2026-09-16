import { systemFor } from "#tiangz/model";
import { BattleManagerComponent, BattleProtocol, type C2B_Submit, type B2C_Overview, type C2B_Inspect, type B2C_Inspect } from "#tiangz/module";
import { valid, same, token, taskKey, compatible } from "./Input";
@systemFor(BattleManagerComponent)
export class ManagerSystem extends BattleManagerComponent {
  override Register(node: string, port: number, ip: string, logicVersion: string, configVersion: string): boolean {
    // 仅供可信隔离实验网；地址检查不等于身份认证。 / Trusted lab only; address validation is not authentication.
    ip ||= "127.0.0.1";
    const octets = ip.split(".");
    if (octets.length !== 4 || octets.some(part => !/^(0|[1-9][0-9]{0,2})$/.test(part) || Number(part) > 255)) return false;
    const [a, b] = octets.map(Number);
    if (!(ip === "127.0.0.1" || a === 10 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168)) return false;
    if (!/^worker-[a-z0-9-]{1,80}$/.test(node) || !Number.isInteger(port) || port < 1024 || port > 65535) return false;
    if (!token(logicVersion) || !token(configVersion)) return false;
    const old = this.nodes.get(node);
    if (old && (old.endpoint.port !== port || old.endpoint.innerIp !== ip || !compatible(old, { logicVersion, configVersion }))) return false;
    if (!old && this.nodes.size >= 16) return false;
    if (old) old.seen = Date.now();
    else this.nodes.set(node, { endpoint: { name: node, sceneType: "BattleHost", innerIp: ip, port, protocol: "auto", audience: "mixed" }, seen: Date.now(), draining: false, busy: "", logicVersion, configVersion });
    return true;
  }
  override Submit(input: C2B_Submit): string {
    if (!valid(input)) return "invalid";
    const key = taskKey(input);
    const old = this.tasks.get(key);
    if (old) return same(old.input, input) ? old.state : "conflict";
    // 没有兼容容量时不受理，不悄悄降级；已受理任务仍保留原身份。 / Fail closed before admission; retain accepted identities.
    if (![...this.nodes.values()].some(host => !host.draining && Date.now() - host.seen < 1500 && compatible(host, input))) return "unavailable";
    if (this.tasks.size >= 128 || [...this.tasks.values()].filter(task => task.state === "queued").length >= 32) return "full";
    this.tasks.set(key, { input: { ...input }, state: "queued", result: 0, node: "", started: 0 });
    return "queued";
  }
  override Inspect(input: C2B_Inspect): B2C_Inspect {
    const task = this.tasks.get(taskKey(input));
    return { state: task?.state ?? "missing", result: task?.result ?? 0, node: task?.node ?? "",
      realmId: input.realmId, battleId: input.battleId, logicVersion: task?.input.logicVersion ?? "", configVersion: task?.input.configVersion ?? "" };
  }
  override Overview(): B2C_Overview {
    const tasks = [...this.tasks.values()];
    const count = (state: string) => tasks.filter(task => task.state === state).length;
    return { queued: count("queued"), running: count("running"), done: count("done"), unknown: count("unknown"),
      workers: [...this.nodes].map(([node, host]) => ({ node, draining: host.draining, busy: !!host.busy, live: Date.now() - host.seen < 1500, logicVersion: host.logicVersion, configVersion: host.configVersion })) };
  }
  override async Drain(node: string): Promise<boolean> {
    const host = this.nodes.get(node);
    if (!host) return false;
    host.draining = true;
    const result = await this.owner.scenes.call(host.endpoint, BattleProtocol.DrainHost, { node }, { timeoutMs: 500 });
    return !host.busy && result.idle;
  }
  override async Tick(): Promise<void> {
    if (this.ticking || this.IsDisposed) return;
    this.ticking = true;
    try {
      for (const [name, host] of this.nodes) {
        if (this.IsDisposed) return;
        if (host.busy) {
          const task = this.tasks.get(host.busy)!;
          if (Date.now() - host.seen > 1500 || Date.now() - task.started > 5000) {
            task.state = "unknown"; host.draining = true; host.busy = "";
            continue;
          }
          try {
            const result = await this.owner.scenes.call(host.endpoint, BattleProtocol.Poll, { battleId: task.input.battleId, realmId: task.input.realmId }, { timeoutMs: 300 });
            if (this.IsDisposed) return;
            if (result.state === "done") { task.result = result.result; task.state = "done"; host.busy = ""; }
          } catch { /* 未知结果保持原分配。 / Preserve uncertain assignment. */ }
        }
        if (host.busy || host.draining || Date.now() - host.seen > 1500) continue;
        const task = [...this.tasks.values()].find(item => item.state === "queued" && compatible(host, item.input));
        if (!task) continue;
        task.node = name; task.state = "running"; task.started = Date.now(); host.busy = taskKey(task.input);
        try {
          const result = await this.owner.scenes.call(host.endpoint, BattleProtocol.Execute, { ...task.input }, { timeoutMs: 300 });
          if (this.IsDisposed) return;
          if (!result.accepted) { task.state = "queued"; task.node = ""; host.busy = ""; host.draining = true; }
        } catch { /* 查询原节点，不立即转投。 / Poll original node instead of reassignment. */ }
      }
    } finally { this.ticking = false; }
  }
}
