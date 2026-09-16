import { systemFor } from "#tiangz/model";
import { BattleHostComponent, BattleProtocol, NativeOps, BattleRelease, type C2B_Submit } from "#tiangz/module";
import { same, valid, taskKey, compatible } from "./Input";
@systemFor(BattleHostComponent)
export class HostSystem extends BattleHostComponent {
  override async Report(): Promise<void> {
    if (this.reporting || this.IsDisposed) return;
    this.reporting = true;
    try {
      await this.owner.scenes.callOne("BattleManager", BattleProtocol.Register,
        { node: this.owner.self.name, port: this.owner.self.port, ip: this.owner.self.innerIp, ...BattleRelease }, { timeoutMs: 500 });
    } catch { /* 下次心跳重试。 / Retry next heartbeat. */ }
    finally { this.reporting = false; }
  }
  override Execute(input: C2B_Submit): boolean {
    if (!valid(input) || !compatible(input, BattleRelease)) return false;
    const key = taskKey(input);
    const old = this.jobs.get(key);
    if (old) return same(old.input, input);
    if (this.draining || this.jobs.size >= 128 || [...this.jobs.values()].some(job => job.result < 0)) return false;
    const handle = NativeOps.Submit(input.seed, input.rounds, input.delayMs);
    if (!handle) return false;
    this.jobs.set(key, { input: { ...input }, handle, result: -1 });
    return true;
  }
  override Poll(id: string): { state: string; result: number } {
    const job = this.jobs.get(id);
    if (!job) return { state: "unknown", result: 0 };
    if (job.result < 0) job.result = NativeOps.Poll(job.handle);
    return { state: job.result < 0 ? "running" : "done", result: Math.max(0, job.result) };
  }
}
