import { Component, component } from "#tiangz/core";

export interface RoomState {
  readonly roomId: number;
  revision: number;
  readonly members: Map<string, string>;
}
export interface RoomSnapshot {
  readonly roomId: number;
  readonly revision: number;
  readonly memberIds: string[];
}

/** 仅由入口 Scene 拥有；内存演示状态在重启后丢失。 / Scene-owned demo state, lost on restart. */
@component()
export class RoomStoreComponent extends Component {
  protected readonly rooms = new Map<number, RoomState>();
  protected nextRoomId = 1;

  /** 释放房间集合，凭据不进入日志或快照。 / Release rooms; never include credentials in logs or snapshots. */
  override OnDestroy(): void { this.rooms.clear(); }
}

export interface RoomStoreComponent {
  Create(memberId: string, resumeKey: string): RoomSnapshot;
  Join(roomId: number, memberId: string, resumeKey: string): RoomSnapshot;
  Leave(roomId: number, memberId: string, resumeKey: string): RoomSnapshot;
  Resume(roomId: number, memberId: string, resumeKey: string): RoomSnapshot;
}
