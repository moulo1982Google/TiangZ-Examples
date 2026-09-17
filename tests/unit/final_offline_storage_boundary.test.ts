import { expect, test, vi } from "vitest";
import { MapComponent } from "../../modules/mmorpg/src/model/map/MapComponent";

function fixture() {
  let resolve!: () => void; let reject!: (error: Error) => void;
  const saved = new Promise<void>((yes,no) => { resolve=yes; reject=no; });
  let entered!: () => void;
  const saving = new Promise<void>(yes => { entered=yes; });
  const unit = { UnitId: 1, InstanceId: 2, CharacterId: 3n, Account: "test", MapId: 4,
    MatchesGate: () => true, Offline: vi.fn(() => { entered(); return saved; }) };
  const map = Object.create(MapComponent.prototype) as any;
  const location = { Resolve: vi.fn(async () => ({found:true,location:{actorInstanceId:2,revision:1n}})),
    Lock: vi.fn(async () => {}), Remove: vi.fn(async () => ({removed:true})), Unlock: vi.fn(async () => {}) };
  const players = { RecordOffline: vi.fn(), Remove: vi.fn() };
  Object.defineProperties(map,{ players:{value:players}, units:{value:{Get:()=>unit}}, logger:{value:{info:vi.fn(),warn:vi.fn()}} });
  Object.assign(map,{location,offlineOperations:new Map(),nextLocationOperation:1,requirePlayer:()=>{},
    DomainScene:()=>({GetComponent:()=>({PlayerLeaving:()=>{}})}), ScheduleOfflineCleanup:vi.fn()});
  const offline=()=>map.PlayerOffline(unit,{account:"test",characterId:3n,unitId:1,mapId:4,reason:"test",gateName:"gate",gateEpoch:1n});
  return {map,unit,location,players,offline,saving,resolve,reject};
}

test("最终保存未确认时不移除Location和内存角色",async()=>{
  const f=fixture(); const pending=f.offline(); await f.saving;
  expect(f.location.Remove).not.toHaveBeenCalled();
  expect(f.players.Remove).not.toHaveBeenCalled();
  expect(f.map.ScheduleOfflineCleanup).not.toHaveBeenCalled();
  f.resolve(); await expect(pending).resolves.toMatchObject({removed:true});
  expect(f.location.Remove).toHaveBeenCalledOnce();expect(f.players.Remove).toHaveBeenCalledOnce();
  expect(f.map.ScheduleOfflineCleanup).toHaveBeenCalledOnce();
});

test("最终保存失败保留角色，并允许后续重试",async()=>{
  const f=fixture();const pending=f.offline();await f.saving;
  f.reject(Error("PG commit unknown"));await expect(pending).rejects.toThrow("PG commit unknown");
  expect(f.location.Remove).not.toHaveBeenCalled();expect(f.players.Remove).not.toHaveBeenCalled();
  expect(f.map.ScheduleOfflineCleanup).not.toHaveBeenCalled();expect(f.location.Unlock).toHaveBeenCalledOnce();
  f.unit.Offline.mockResolvedValue(undefined);
  await expect(f.offline()).resolves.toMatchObject({removed:true});
  expect(f.unit.Offline).toHaveBeenCalledTimes(2);
});
