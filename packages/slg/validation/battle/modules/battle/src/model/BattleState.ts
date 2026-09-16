import { Component, component, EntryScene, entryScene, type SceneConfig } from "#tiangz/core";
import type { C2B_Submit, B2C_Overview, C2B_Inspect, B2C_Inspect } from "./generated/protocol/battle/protocol/messages";
export type BattleTask = { input: C2B_Submit; state: string; result: number; node: string; started: number };
export type BattleNode = { endpoint: SceneConfig; seen: number; draining: boolean; busy: string; logicVersion: string; configVersion: string };
@entryScene()
export class BattleManagerScene extends EntryScene {}
@entryScene()
export class BattleHostScene extends EntryScene {}
/** 验证期内存账本，不是可恢复的结算记录。 / Bounded memory ledger, not durable settlement. */
@component()
export class BattleManagerComponent extends Component {
  protected get owner(): EntryScene { return this.Parent as EntryScene; }
  readonly tasks = new Map<string, BattleTask>();
  readonly nodes = new Map<string, BattleNode>();
  ticking = false;
}
export interface BattleManagerComponent {
  Tick(): Promise<void>;
  Register(node: string, port: number, ip: string, logicVersion: string, configVersion: string): boolean;
  Submit(input: C2B_Submit): string;
  Inspect(input: C2B_Inspect): B2C_Inspect;
  Overview(): B2C_Overview;
  Drain(node: string): Promise<boolean>;
}
/** 每进程一个计算槽；有界保留回执。 / One compute slot per process with bounded receipts. */
@component()
export class BattleHostComponent extends Component {
  protected get owner(): EntryScene { return this.Parent as EntryScene; }
  readonly jobs = new Map<string, { input: C2B_Submit; handle: number; result: number }>();
  draining = false;
  reporting = false;
}
export interface BattleHostComponent {
  Report(): Promise<void>;
  Execute(input: C2B_Submit): boolean;
  Poll(id: string): { state: string; result: number };
}
