import { systemFor, IsVersionedEntityRevisionConflict, utf8Decode, utf8Encode } from "#tiangz/model";
import { SlgGameComponent, type C2S_Game, type S2C_Game, type GameState, type PlayerState, type WorldState } from "#tiangz/module";
import { apply, newPlayer, newWorld, settle } from "./Gameplay";

/** 不兼容存档拒绝加载，不重置资产。 / Reject incompatible saves. */
function decode<T>(row: { schema: string; schemaVersion: number; payload: Uint8Array }, schema: string): T {
  if (row.schema !== schema || row.schemaVersion !== 1) throw Error("存档版本不兼容");
  return JSON.parse(utf8Decode(row.payload)) as T;
}
/** 资源按需结算，只登记业务截止时间。 / Schedule tasks, not resource polling. */
function deadline(p: PlayerState): number { return Math.min(p.march?.dueAt || Infinity, ...p.buildings.map(b => b.dueAt || Infinity)); }

@systemFor(SlgGameComponent)
export class SlgGameSystem extends SlgGameComponent {
  /** 返回确认后的内存快照。 / Return confirmed resident state. */
  override async Execute(request: C2S_Game): Promise<S2C_Game> {
    const { player: p, world } = await this.Run(request, true);
    return { player: p.id, food: p.food, troops: p.troops, sequence: p.sequence, buildings: p.buildings, heroes: p.heroes,
      marches: p.march ? [p.march] : [], tiles: world.tiles, report: p.report, persisted: this.durable,
      serverTime: Date.now(), nextProductionAt: p.producedAt + 60000,
      receipt: p.receipt ?? { sequence: 0, fingerprint: "", accepted: false, message: "旧存档无独立回执", heroId: 0 } };
  }

  /** 启动恢复离线任务索引；不依赖玩家重新登录。 / Recover deadlines before accepting requests. */
  override async Initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initializing) return this.initializing;
    this.initializing = (async () => {
      const s = this.settings;
      if (![s.keepAliveMs, s.maxResidents, s.maxPlayers, s.retryDelayMs, s.maxTimerRetries].every(n => Number.isSafeInteger(n) && n > 0)
        || s.maxResidents > s.maxPlayers) throw Error("SLG驻留配置无效");
      const saved = this.durable ? await this.records.Load({ namespace: "slg.demo.world.v1", key: "realm-41" }) : undefined;
      const world = saved ? decode<WorldState>(saved, "slg.demo.world") : this.memoryWorld ?? newWorld();
      if (!Array.isArray(world.players) || world.players.length > s.maxPlayers || new Set(world.players).size !== world.players.length) throw Error("世界玩家目录无效");
      const tasks = new Map<string, number>();
      for (const id of world.players) {
        const row = this.durable ? await this.records.Load({ namespace: "slg.demo.player.v1", key: `realm-41/${id}` }) : undefined;
        const p = row ? decode<PlayerState>(row, "slg.demo.player") : this.memoryPlayers.get(id);
        if (!p || p.id !== id) throw Error("已登记玩家存档缺失或身份无效");
        tasks.set(id, deadline(p));
      }
      this.world = world; this.worldRevision = saved?.revision ?? 0n;
      this.deadlines.clear();
      for (const [id, due] of tasks) { this.activePlayers.add(id); if (Number.isFinite(due)) this.deadlines.set(id, due); }
      this.initialized = true;
      for (const id of tasks.keys()) this.Schedule(id);
    })();
    try { await this.initializing; } finally { this.initializing = undefined; }
  }
  /** 启动恢复入口，不逐秒扫描玩家。 / Startup recovery only. */
  override async Tick(): Promise<void> {
    try { await this.Initialize(); this.startupRetries = 0; }
    catch (error) {
      if (++this.startupRetries < this.settings.maxTimerRetries && !this.IsDisposed) this.NewOnceTimer(this.settings.retryDelayMs, "Tick");
      throw error;
    }
  }
  override async Transact(request: C2S_Game): Promise<GameState> { return this.Run(request, false); }

  /** 玩家独立串行；涉及地图才占用世界协调权。 / Per-player exclusion with world coordination for map changes. */
  override async Run(request: C2S_Game, foreground: boolean): Promise<GameState> {
    if (!/^[a-zA-Z0-9_-]{1,24}$/.test(request.player)) throw Error("开发角色名须为1至24位英文、数字或下划线");
    await this.Initialize();
    const id = request.player;
    if (this.playerBusy.has(id)) throw Error("玩家正在结算，请稍后重试原操作");
    this.playerBusy.add(id);
    try {
      const pending = this.pendingPlayers.get(id);
      if (pending) {
        try {
          await this.records.CommitRecords(pending.commit);
          this.Publish(id, pending.next, pending.commit.writes[0]!.expectedRevision! + 1n, pending.worldChanged,
            pending.worldChanged ? pending.commit.writes[1]!.expectedRevision! + 1n : this.worldRevision);
          this.pendingPlayers.delete(id); if (this.worldPending === id) this.worldPending = undefined;
        } catch (error) {
          if (IsVersionedEntityRevisionConflict(error)) {
            this.pendingPlayers.delete(id); this.residents.delete(id);
            if (this.worldPending === id) { this.worldPending = undefined; this.initialized = false; }
          }
          throw error;
        }
      }
      let resident = this.residents.get(id);
      if (resident && foreground && resident.expiresAt <= Date.now()) { this.residents.delete(id); resident = undefined; }
      if (!resident) {
        // Count in-flight loads too; no unbounded admission during an await.
        if (this.residents.size + [...this.playerBusy].filter(key => key !== id && !this.residents.has(key)).length >= this.settings.maxResidents) {
          const victim = [...this.residents].find(([key, value]) => value.expiresAt <= Date.now() && !this.playerBusy.has(key) && !this.pendingPlayers.has(key));
          if (victim) this.residents.delete(victim[0]); else throw Error("玩家驻留容量已满，请稍后重试");
        }
        const saved = this.durable ? await this.records.Load({ namespace: "slg.demo.player.v1", key: `realm-41/${id}` }) : undefined;
        const p = saved ? decode<PlayerState>(saved, "slg.demo.player") : this.memoryPlayers.get(id);
        if (!p && this.world!.players.includes(id)) throw Error("已登记玩家存档缺失，拒绝重建资产");
        if (p && p.id !== id) throw Error("存档身份无效");
        resident = { player: p ?? newPlayer(id, Date.now()), revision: saved?.revision ?? 0n, expiresAt: Date.now() };
        this.residents.set(id, resident);
      }
      if (foreground) resident.expiresAt = Date.now() + this.settings.keepAliveMs;
      const now = Date.now();
      const touchesWorld = !this.world!.players.includes(id) || request.action === "march" || !!(resident.player.march && resident.player.march.dueAt <= now);
      if (touchesWorld) {
        if ((this.worldBusy && this.worldBusy !== id) || this.worldPending) throw Error("地图正在结算，请稍后重试原操作");
        this.worldBusy = id;
      }
      const state: GameState = { player: resident.player, world: this.world! };
      const next = JSON.parse(JSON.stringify(state)) as GameState;
      if (!next.world.players.includes(id)) {
        if (next.world.players.length >= this.settings.maxPlayers) throw Error("开发服玩家目录容量已满");
        next.world.players.push(id);
      }
      settle(next, now);
      if (request.action !== "snapshot") {
        if (request.sequence === next.player.sequence + 1) {
          const before = JSON.parse(JSON.stringify(next)) as GameState;
          const fingerprint = JSON.stringify([request.action, request.target, request.amount]);
          try {
            apply(next, request, now, Math.random());
            const heroId = request.action === "draw-hero" ? next.player.heroes.find(h => h.copies > (before.player.heroes.find(b => b.id === h.id)?.copies ?? 0))!.id : 0;
            next.player.receipt = { sequence: request.sequence, fingerprint, accepted: true,
              message: request.action === "draw-hero" ? next.player.report : `${request.action}已受理`, heroId };
          } catch (error) {
            next.player = before.player; next.world = before.world;
            next.player.sequence = request.sequence; next.player.fingerprint = fingerprint;
            next.player.report = `操作未执行：${error instanceof Error ? error.message : String(error)}`;
            next.player.receipt = { sequence: request.sequence, fingerprint, accepted: false, message: next.player.report, heroId: 0 };
          }
        } else apply(next, request, now, 0);
      }
      const worldChanged = JSON.stringify(state.world) !== JSON.stringify(next.world);
      const changed = !this.world!.players.includes(id) || JSON.stringify(state.player) !== JSON.stringify(next.player) || worldChanged;
      if (changed && this.durable) {
        const commit = { operationId: `slg-demo:${id}:${resident.revision}:${this.worldRevision}:${now}:${Math.random().toString(36).slice(2)}:${Math.random().toString(36).slice(2)}`,
          writes: [{ record: { namespace: "slg.demo.player.v1", key: `realm-41/${id}` }, schema: "slg.demo.player", schemaVersion: 1,
            expectedRevision: resident.revision, payload: utf8Encode(JSON.stringify(next.player)), updatedAtUnixMs: BigInt(now) },
          ...(worldChanged ? [{ record: { namespace: "slg.demo.world.v1", key: "realm-41" }, schema: "slg.demo.world", schemaVersion: 1,
            expectedRevision: this.worldRevision, payload: utf8Encode(JSON.stringify(next.world)), updatedAtUnixMs: BigInt(now) }] : [])],
          appends: [], outboxEvents: [], result: utf8Encode(JSON.stringify(next.player.receipt ?? null)) };
        this.pendingPlayers.set(id, { commit, next, worldChanged });
        if (worldChanged) this.worldPending = id;
        try {
          await this.records.CommitRecords(commit);
          this.Publish(id, next, resident.revision + 1n, worldChanged, this.worldRevision + (worldChanged ? 1n : 0n));
          this.pendingPlayers.delete(id); if (this.worldPending === id) this.worldPending = undefined;
        } catch (error) {
          if (IsVersionedEntityRevisionConflict(error)) {
            this.pendingPlayers.delete(id); this.residents.delete(id);
            if (this.worldPending === id) { this.worldPending = undefined; this.initialized = false; }
          }
          throw error;
        }
      } else if (changed) {
        this.memoryPlayers.set(id, next.player); if (worldChanged) this.memoryWorld = next.world;
        this.Publish(id, next, resident.revision + 1n, worldChanged, this.worldRevision + (worldChanged ? 1n : 0n));
      }
      this.timerRetries.delete(id);
      const confirmed = this.residents.get(id)!.player;
      const due = deadline(confirmed); if (Number.isFinite(due)) this.deadlines.set(id, due); else this.deadlines.delete(id);
      return JSON.parse(JSON.stringify({ player: confirmed, world: this.world })) as GameState;
    } finally {
      if (this.worldBusy === id) this.worldBusy = undefined;
      this.playerBusy.delete(id); this.Schedule(id);
    }
  }

  /** 确认后发布；不覆盖并发已推进的无关世界。 / Publish only affected confirmed records. */
  override Publish(id: string, next: GameState, revision: bigint, worldChanged: boolean, worldRevision: bigint): void {
    const expiresAt = this.residents.get(id)?.expiresAt ?? Date.now();
    this.residents.set(id, { player: next.player, revision, expiresAt });
    const due = deadline(next.player);
    if (Number.isFinite(due)) this.deadlines.set(id, due); else this.deadlines.delete(id);
    if (worldChanged) { this.world = next.world; this.worldRevision = worldRevision; }
    this.activePlayers.add(id);
  }

  /** 回收缓存不撤销截止任务，Timer只保留玩家标识。 / Eviction preserves lightweight task deadlines. */
  override Schedule(id: string): void {
    const old = this.playerTimers.get(id); if (old !== undefined) this.CancelTimer(old);
    this.playerTimers.delete(id);
    if (this.IsDisposed) return;
    const resident = this.residents.get(id);
    let due = Math.min(this.deadlines.get(id) ?? Infinity, resident?.expiresAt ?? Infinity);
    if (this.pendingPlayers.has(id) || this.timerRetries.has(id)) {
      if ((this.timerRetries.get(id) ?? 0) >= this.settings.maxTimerRetries) return;
      due = Date.now() + this.settings.retryDelayMs;
    }
    if (Number.isFinite(due)) this.playerTimers.set(id, this.NewOnceTimer(Math.max(1, due - Date.now()), "OnPlayerDue", id));
  }

  /** 无连接也结算；未知结果保留，失败有界重试。 / Settle offline tasks with bounded retry. */
  override async OnPlayerDue(id: string): Promise<void> {
    this.playerTimers.delete(id);
    if (this.playerBusy.has(id)) return;
    try {
      if (this.pendingPlayers.has(id) || (this.deadlines.get(id) ?? Infinity) <= Date.now())
        await this.Run({ player: id, action: "snapshot", sequence: 0, target: 0, amount: 0 }, false);
      const resident = this.residents.get(id);
      if (resident && resident.expiresAt <= Date.now() && !this.pendingPlayers.has(id)) this.residents.delete(id);
    } catch (error) {
      this.timerRetries.set(id, (this.timerRetries.get(id) ?? 0) + 1);
      throw error;
    } finally { this.Schedule(id); }
  }
}
