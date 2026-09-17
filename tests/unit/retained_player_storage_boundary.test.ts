import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { InitializeGameSingletons } from "../../../TiangZ/app/core/runtime/Game";
import { SingletonRegistry } from "../../../TiangZ/app/core/runtime/Singleton";
import { MapHostComponent } from "../../modules/mmorpg/src/model/mapHost/MapHostComponent";

beforeEach(() => InitializeGameSingletons());
afterEach(() => { vi.restoreAllMocks(); SingletonRegistry.DestroyAll(); });

// 调用真实进图分支，替身仅隔离网络、Native与存储；不是登录性能基准。
function fixture(retained: boolean) {
  const host = Object.create(MapHostComponent.prototype) as any;
  const snapshot = { account: "retained", characterId: 1n, mapId: 1, unitId: 2,
    gateName: "gate", x: 0, y: 0, z: 0, gold: 123, numerics: [] };
  const state = { Snapshot: () => [], CompletedQuestConfigIds: () => [],
    KnownSkillIds: () => [], Proficiencies: () => [], StarterDungeonCooldownEndAtMs: 0 };
  const player = { MapInstanceId: 1n, UnitId: 2, CharacterId: 1n, InstanceId: 3,
    MatchesGate: vi.fn(() => true), SecondEnterMap: vi.fn(() => snapshot), GetComponent: () => state };
  const load = vi.fn(async () => { throw new Error("storage boundary reached"); });
  const map = { MapId: 1, EntitySnapshots: vi.fn(() => []), CreatePlayer: vi.fn() };
  const mailbox = vi.fn(async (_player: unknown, fn: () => unknown) => fn());
  Object.defineProperties(host, {
    players: { value: { Get: () => retained ? player : undefined } },
    owner: { value: { RunLocalActorMailbox: mailbox, logger: { info: vi.fn() },
      scenes: { byName: () => ({}), send: vi.fn(async () => {}) } } },
  });
  Object.assign(host, { EnsureLocationOwner: async () => {}, validateEnterMap: () => {},
    requireMap: () => map, mapOf: () => map, repository: { Load: load }, entryMetrics: {
      idAllocations: 0, idAllocationMs: 0, maxIdAllocationMs: 0,
      mapReadySends: 0, mapReadySendMs: 0, maxMapReadySendMs: 0,
      locationResolves: 0, locationResolveMs: 0, maxLocationResolveMs: 0 },
    location: { AllocateUnitId: vi.fn(async () => ({ unitId: 2 })),
      Resolve: vi.fn(async () => ({ found: true, location: { actorInstanceId: 3, mapInstanceId: 1n, revision: 1n } })) } });
  return { host, player, load, map, mailbox, enter: () => host.EnterMapCore({
    account: "retained", characterId: 1n, mapInstanceId: 1n, gateName: "gate", gateEpoch: 1n, entrySyncMode: 0 }) };
}

test("保活角色通过原Actor邮箱恢复，角色快照零存储读取", async () => {
  const f = fixture(true);
  const result = await f.enter();
  expect(result.gold).toBe(123);
  expect(f.mailbox).toHaveBeenCalledOnce();
  expect(f.player.SecondEnterMap).toHaveBeenCalledOnce();
  expect(f.load).not.toHaveBeenCalled();
  expect(f.map.CreatePlayer).not.toHaveBeenCalled();
  expect(f.host.location.AllocateUnitId).not.toHaveBeenCalled();
});

test("已释放角色才进入Repository恢复，不伪装为保活命中", async () => {
  const f = fixture(false);
  await expect(f.enter()).rejects.toThrow("storage boundary reached");
  expect(f.load).toHaveBeenCalledExactlyOnceWith(1n);
  expect(f.player.SecondEnterMap).not.toHaveBeenCalled();
});

test("保活角色身份不匹配时拒绝，不绕过到存储重新创建", async () => {
  const f = fixture(true); f.player.MatchesGate.mockReturnValue(false);
  await expect(f.enter()).rejects.toThrow("Gate mismatch");
  expect(f.load).not.toHaveBeenCalled();
  expect(f.map.CreatePlayer).not.toHaveBeenCalled();
});
