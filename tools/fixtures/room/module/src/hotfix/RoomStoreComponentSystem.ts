import { systemFor } from "#tiangz/model";
import { RoomStoreComponent, type RoomSnapshot, type RoomState } from "#tiangz/module";

@systemFor(RoomStoreComponent)
export class RoomStoreComponentSystem extends RoomStoreComponent {
  /** 创建有界内存房间，返回可直接使用的房间 ID。 / Create a bounded in-memory room and return its addressable ID. */
  override Create(memberId: string, resumeKey: string): RoomSnapshot {
    credentials(memberId, resumeKey);
    if (this.rooms.size >= 16 || this.nextRoomId > 0xffffffff) throw new Error("room capacity reached");
    const room = { roomId: this.nextRoomId++, revision: 1, members: new Map([[memberId, resumeKey]]) };
    this.rooms.set(room.roomId, room);
    return snapshot(room);
  }

  /** 重复加入不重复增加版本或占用容量。 / Repeated joins do not increase revision or consume another slot. */
  override Join(roomId: number, memberId: string, resumeKey: string): RoomSnapshot {
    credentials(memberId, resumeKey);
    const room = requireRoom(this.rooms, roomId);
    if (room.members.has(memberId)) {
      authorize(room, memberId, resumeKey);
      return snapshot(room);
    }
    if (room.members.size >= 8) throw new Error("member capacity reached");
    nextRevision(room);
    room.members.set(memberId, resumeKey);
    return snapshot(room);
  }

  /** 最后一名成员离开后释放房间；失效的地址不能恢复。 / Delete an empty room; its old ID cannot be resumed. */
  override Leave(roomId: number, memberId: string, resumeKey: string): RoomSnapshot {
    credentials(memberId, resumeKey);
    const room = requireRoom(this.rooms, roomId);
    authorize(room, memberId, resumeKey);
    nextRevision(room);
    room.members.delete(memberId);
    if (!room.members.size) this.rooms.delete(roomId);
    return snapshot(room);
  }

  /** 重连只读取当前快照，不重放加入，也不变更版本。 / Reconnect reads the current snapshot without replaying a join or advancing revision. */
  override Resume(roomId: number, memberId: string, resumeKey: string): RoomSnapshot {
    credentials(memberId, resumeKey);
    const room = requireRoom(this.rooms, roomId);
    authorize(room, memberId, resumeKey);
    return snapshot(room);
  }
}

/** 演示凭据仅校验输入形状，不是生产登录鉴权。 / Validate demo input shape, not production account authentication. */
function credentials(memberId: string, resumeKey: string): void {
  if (!/^[a-zA-Z0-9_-]{1,32}$/.test(memberId) || !/^[a-zA-Z0-9_-]{16,64}$/.test(resumeKey)) throw new Error("invalid demo credentials");
}
function requireRoom(rooms: ReadonlyMap<number, RoomState>, roomId: number): RoomState {
  const room = rooms.get(roomId);
  if (!room) throw new Error("room not found");
  return room;
}
function authorize(room: RoomState, memberId: string, resumeKey: string): void {
  if (room.members.get(memberId) !== resumeKey) throw new Error("member cannot resume");
}
function nextRevision(room: RoomState): void {
  if (room.revision >= 0xffffffff) throw new Error("room revision exhausted");
  room.revision++;
}
function snapshot(room: RoomState): RoomSnapshot {
  return { roomId: room.roomId, revision: room.revision, memberIds: [...room.members.keys()].sort() };
}
