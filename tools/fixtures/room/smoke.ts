import assert from "node:assert/strict";
import "../modules/room/generated/typescript/Core/Net/BrowserWebSocketTransport";
import { RpcSocket } from "../modules/room/generated/typescript/Core/Net/RpcSocket";
import { RoomClient } from "../modules/room/generated/typescript/room/protocol/clients";

/** 所有请求走正式生成的 SDK 与真实 Socket；重新连接不能复用原 Socket。 / Exercise generated SDK calls over real sockets, including an entirely new reconnect socket. */
export async function verify(port: number, signal?: AbortSignal): Promise<void> {
  const alice = { memberId: "alice", resumeKey: "alice_demo_key_01" };
  const bob = { memberId: "bob", resumeKey: "bob_demo_key_0001" };
  let roomId = 0;
  await withClient(port, signal, async client => {
    const created = (await client.createRoom(alice)).snapshot!;
    roomId = created.roomId;
    assert.deepEqual(created, { roomId, revision: 1, memberIds: ["alice"] });
    const joined = (await client.joinRoom({ roomId, ...bob })).snapshot!;
    assert.deepEqual(joined, { roomId, revision: 2, memberIds: ["alice", "bob"] });
  });
  await withClient(port, signal, async client => {
    const resume = () => client.resumeRoom({ roomId, ...alice });
    const joined = { roomId, revision: 2, memberIds: ["alice", "bob"] };
    assert.deepEqual((await resume()).snapshot, joined);
    await assert.rejects(client.resumeRoom({ roomId, ...alice, resumeKey: "incorrect_demo_key" }), /member cannot resume/);
    assert.deepEqual((await client.joinRoom({ roomId, ...alice })).snapshot, joined);
    assert.deepEqual((await resume()).snapshot, joined);
    assert.deepEqual((await client.leaveRoom({ roomId, ...bob })).snapshot, { roomId, revision: 3, memberIds: ["alice"] });
    await assert.rejects(client.resumeRoom({ roomId, ...bob }), /member cannot resume/);
    assert.deepEqual((await resume()).snapshot, { roomId, revision: 3, memberIds: ["alice"] });
    assert.deepEqual((await client.leaveRoom({ roomId, ...alice })).snapshot, { roomId, revision: 4, memberIds: [] });
    await assert.rejects(resume(), /room not found/);

    const next = (await client.createRoom(alice)).snapshot!;
    assert.notEqual(next.roomId, roomId);
    const members = Array.from({ length: 7 }, (_, index) => ({ memberId: `guest_${index}`, resumeKey: `guest_demo_key_000${index}` }));
    const replies = await Promise.all(members.map(member => client.joinRoom({ roomId: next.roomId, ...member })));
    assert.deepEqual(replies.map(reply => reply.snapshot!.revision).sort((a, b) => a - b), [2, 3, 4, 5, 6, 7, 8]);
    await assert.rejects(client.joinRoom({ roomId: next.roomId, memberId: "overflow", resumeKey: "overflow_demo_key" }), /member capacity reached/);
    const full = (await client.resumeRoom({ roomId: next.roomId, ...alice })).snapshot!;
    assert.equal(full.revision, 8);
    assert.equal(full.memberIds.length, 8);
    assert.deepEqual((await client.joinRoom({ roomId: next.roomId, ...alice })).snapshot, full);
    await assert.rejects(client.createRoom({ ...alice, memberId: "" }), /invalid demo credentials/);
    for (let index = 0; index < 15; index++) await client.createRoom(alice);
    await assert.rejects(client.createRoom(alice), /room capacity reached/);
    assert.deepEqual((await client.resumeRoom({ roomId: next.roomId, ...alice })).snapshot, full);
  });
  console.log("[room-consumer] create/join/leave/reconnect, direct room IDs, rejection atomicity and capacity passed; no Location or MapHost deployed.");
}

async function withClient(port: number, signal: AbortSignal | undefined, action: (client: RoomClient) => Promise<void>): Promise<void> {
  if (signal?.aborted) throw new Error("room consumer cancelled");
  const socket = new RpcSocket({ transport: "websocket", host: "127.0.0.1", port });
  const client = new RoomClient(socket);
  const pump = setInterval(() => socket.update(), 5);
  const cancel = () => { clearInterval(pump); socket.close(); };
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    await socket.connect();
    if (signal?.aborted) throw new Error("room consumer cancelled");
    await action(client);
  } finally {
    signal?.removeEventListener("abort", cancel);
    clearInterval(pump);
    socket.close();
  }
}
