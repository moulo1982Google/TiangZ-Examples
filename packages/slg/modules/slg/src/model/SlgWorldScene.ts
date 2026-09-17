import { EntryScene, entryScene, Component, component, HostDbProxyRecords, type DbProxyRecordCommit } from "#tiangz/core";
import type { C2S_Game, S2C_Game, S2C_WorldSnapshot } from "./generated/protocol/slg/protocol/messages";
import type { GameState, WorldState, PlayerState } from "./SlgState";
import residency from "./residency.json";

/** 单服开发入口，挂载玩法组件；权威状态不归连接所有。 / Single-realm demo entry; connections do not own authoritative state. */
@entryScene()
export class SlgWorldScene extends EntryScene {
  protected override readonly mailbox = "unordered" as const;
}

export interface SlgWorldScene {
  GetWorldSnapshot(): S2C_WorldSnapshot;
}

/** 单服Demo经济协调者；内存模式仅用于隔离验收，不能声称持久。 / Single-realm demo coordinator; memory mode is explicitly non-durable. */
@component()
export class SlgGameComponent extends Component {
  readonly records = new HostDbProxyRecords();
  readonly memoryPlayers = new Map<string, PlayerState>();
  memoryWorld: WorldState | undefined;
  durable = false;
  startupRetries = 0;
  readonly activePlayers = new Set<string>();
  readonly settings = Object.freeze({ ...residency });
  readonly residents = new Map<string, { player: PlayerState; revision: bigint; expiresAt: number }>();
  readonly playerBusy = new Set<string>();
  readonly pendingPlayers = new Map<string, { commit: DbProxyRecordCommit; next: GameState; worldChanged: boolean }>();
  world: WorldState | undefined;
  worldRevision = 0n;
  worldBusy: string | undefined;
  worldPending: string | undefined;
  initialized = false;
  initializing: Promise<void> | undefined;
  readonly deadlines = new Map<string, number>();
  readonly playerTimers = new Map<string, ReturnType<Component["NewOnceTimer"]>>();
  readonly timerRetries = new Map<string, number>();
}
export interface SlgGameComponent {
  Execute(request: C2S_Game): Promise<S2C_Game>;
  Tick(): Promise<void>;
  Transact(request: C2S_Game): Promise<GameState>;
  Initialize(): Promise<void>;
  Run(request: C2S_Game, foreground: boolean): Promise<GameState>;
  Schedule(player: string): void;
  OnPlayerDue(player: string): Promise<void>;
  Publish(player: string, next: GameState, revision: bigint, worldChanged: boolean, worldRevision: bigint): void;
}
