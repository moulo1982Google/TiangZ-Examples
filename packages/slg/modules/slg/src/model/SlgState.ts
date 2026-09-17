/** 玩家经济与世界占领分开持久化，时间一律为服务端墙钟毫秒。 / Separate player economy and world ownership; timestamps are server wall-clock milliseconds. */
export interface PlayerState {
  id: string; food: number; troops: number; producedAt: number; sequence: number; fingerprint: string;
  buildings: { id: number; name: string; level: number; dueAt: number }[];
  heroes: { id: number; name: string; level: number; copies: number }[];
  march: { tile: number; hero: number; troops: number; power: number; dueAt: number } | null;
  report: string;
  /** 最新命令回执独立于战报；旧存档缺省为空。 / Latest command receipt, independent of battle reports. */
  receipt?: { sequence: number; fingerprint: string; accepted: boolean; message: string; heroId: number };
}
export interface WorldState { players: string[]; tiles: { id: number; owner: string; reservedBy: string }[]; }
export interface GameCommand { player: string; sequence: number; action: string; target: number; amount: number; }
export interface GameState { player: PlayerState; world: WorldState; }
