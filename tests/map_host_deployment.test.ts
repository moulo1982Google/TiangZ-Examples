import { describe, expect, it } from "vitest";
import type { RuntimeDataPack, SceneConfig } from "#tiangz/core";
import { MAP_DEPLOYMENT_OWNER, MAP_DEPLOYMENT_PACK_ID, ResolveMapHostDeployment, ValidateMapHostDeploymentPayload } from "../modules/mmorpg/src/model/mapHost/MapHostDeployment";

const scene: SceneConfig = { name: "map_1", sceneType: "MapHost", innerIp: "127.0.0.1", port: 7301 };
const payload = () => ({ formatVersion: 1, mapHosts: [{ sceneName: "map_1", staticMapIds: [1, 2], acceptDynamicMaps: true }] });
const pack = (data: unknown = payload()): RuntimeDataPack => ({ formatVersion: 1, id: MAP_DEPLOYMENT_PACK_ID, ownerModuleId: MAP_DEPLOYMENT_OWNER, contentHash: "0".repeat(64), source: "fixture", payload: data });

describe("module-owned map deployment", () => {
  it("uses module values when legacy fields are absent and freezes a copy", () => {
    const input = payload();
    const resolved = ResolveMapHostDeployment(scene, pack(input));
    input.mapHosts[0].staticMapIds.push(3);
    expect(resolved).toEqual({ sceneName: "map_1", staticMapIds: [1, 2], acceptDynamicMaps: true });
    expect(Object.isFrozen(resolved)).toBe(true);
    expect(Object.isFrozen(resolved.staticMapIds)).toBe(true);
  });
  it("keeps defaults and explicit legacy-only deployments", () => {
    expect(ResolveMapHostDeployment(scene)).toEqual({ sceneName: "map_1", staticMapIds: [], acceptDynamicMaps: false });
    expect(ResolveMapHostDeployment({ ...scene, staticMapIds: [9], acceptDynamicMaps: true }).staticMapIds).toEqual([9]);
  });
  it("accepts matching dual writes and rejects explicit defaults or reordered conflicts", () => {
    expect(ResolveMapHostDeployment({ ...scene, staticMapIds: [1, 2], acceptDynamicMaps: true }, pack()).acceptDynamicMaps).toBe(true);
    for (const legacy of [{ staticMapIds: [] }, { staticMapIds: [2, 1] }, { acceptDynamicMaps: false }]) {
      expect(() => ResolveMapHostDeployment({ ...scene, ...legacy }, pack())).toThrow(/conflicts with legacy/);
    }
  });
  it("rejects a missing instance even when legacy values are provided", () => {
    expect(() => ResolveMapHostDeployment({ ...scene, name: "missing", staticMapIds: [1] }, pack())).toThrow(/no entry/);
    expect(() => ResolveMapHostDeployment(scene, { ...pack(), ownerModuleId: "org.other.game" })).toThrow(/identity/);
  });
  it("rejects malformed payloads, duplicate names and invalid static IDs", () => {
    for (const value of [null, [], { ...payload(), extra: true }, { ...payload(), formatVersion: 2 }, { ...payload(), mapHosts: [payload().mapHosts[0], payload().mapHosts[0]] },
      ...[[0], [-1], [1.2], [1, 1], [0x100000000], new Array(1025).fill(1)].map(staticMapIds => ({ ...payload(), mapHosts: [{ ...payload().mapHosts[0], staticMapIds }] })),
      { ...payload(), mapHosts: [{ sceneName: "map_1", staticMapIds: [] }] }, { ...payload(), mapHosts: [{ ...payload().mapHosts[0], acceptDynamicMaps: "false" }] }]) {
      expect(() => ValidateMapHostDeploymentPayload(value)).toThrow();
    }
  });
});
