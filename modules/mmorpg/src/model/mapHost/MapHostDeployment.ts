import type { RuntimeDataPack, SceneConfig } from "#tiangz/core";

export const MAP_DEPLOYMENT_PACK_ID = "org.tiangz.mmorpg.map-deployment";
export const MAP_DEPLOYMENT_OWNER = "org.tiangz.mmorpg";

/** 按具体 Scene 实例关联的部署；不属于通用 Core 或玩法配置表。 / Deployment for a concrete Scene instance, owned by this module rather than Core or gameplay tables. */
export interface MapHostDeployment {
  readonly sceneName: string;
  readonly staticMapIds: readonly number[];
  readonly acceptDynamicMaps: boolean;
}

export interface MapHostDeploymentPayload {
  readonly formatVersion: 1;
  readonly mapHosts: readonly MapHostDeployment[];
}

/** 构建工具与运行时共用校验；复制并冻结数组，不信任泛型断言。 / Shared build/runtime validation copies and freezes arrays instead of trusting a generic cast. */
export function ValidateMapHostDeploymentPayload(value: unknown): MapHostDeploymentPayload {
  const payload = object(value, ["formatVersion", "mapHosts"], "map deployment");
  if (payload.formatVersion !== 1 || !Array.isArray(payload.mapHosts) || payload.mapHosts.length > 4096) {
    throw new Error("map deployment requires formatVersion=1 and at most 4096 mapHosts");
  }
  const names = new Set<string>();
  const mapHosts = payload.mapHosts.map(item => {
    const entry = object(item, ["sceneName", "staticMapIds", "acceptDynamicMaps"], "map host deployment");
    if (typeof entry.sceneName !== "string" || !entry.sceneName.trim() || entry.sceneName.length > 128 || /[\x00-\x1f\x7f]/.test(entry.sceneName)) {
      throw new Error("map host deployment requires a sceneName of 1..128 characters without controls");
    }
    if (names.has(entry.sceneName)) throw new Error(`duplicate map host deployment: ${entry.sceneName}`);
    names.add(entry.sceneName);
    if (typeof entry.acceptDynamicMaps !== "boolean") throw new Error(`acceptDynamicMaps must be boolean: ${entry.sceneName}`);
    return Object.freeze({ sceneName: entry.sceneName, staticMapIds: mapIds(entry.staticMapIds), acceptDynamicMaps: entry.acceptDynamicMaps });
  });
  return Object.freeze({ formatVersion: 1, mapHosts: Object.freeze(mapHosts) });
}

/** 包存在时不默默回退；显式旧字段与新配置冲突时拒绝启动。 / Never falls back from an incomplete pack; explicit legacy conflicts reject startup. */
export function ResolveMapHostDeployment(scene: SceneConfig, pack?: RuntimeDataPack): MapHostDeployment {
  if (!pack) {
    if (scene.acceptDynamicMaps !== undefined && typeof scene.acceptDynamicMaps !== "boolean") throw new Error(`legacy acceptDynamicMaps must be boolean: ${scene.name}`);
    return Object.freeze({ sceneName: scene.name, staticMapIds: mapIds(scene.staticMapIds === undefined ? [] : scene.staticMapIds, false), acceptDynamicMaps: scene.acceptDynamicMaps ?? false });
  }
  if (pack.id !== MAP_DEPLOYMENT_PACK_ID || pack.ownerModuleId !== MAP_DEPLOYMENT_OWNER) throw new Error("map deployment pack has the wrong module identity");
  const payload = ValidateMapHostDeploymentPayload(pack.payload);
  const selected = payload.mapHosts.find(entry => entry.sceneName === scene.name);
  if (!selected) throw new Error(`map deployment has no entry for MapHost ${scene.name}`);
  if (scene.staticMapIds !== undefined) {
    const legacy = mapIds(scene.staticMapIds, false);
    if (legacy.length !== selected.staticMapIds.length || legacy.some((id, index) => id !== selected.staticMapIds[index])) {
      throw new Error(`map deployment conflicts with legacy staticMapIds: ${scene.name}`);
    }
  }
  if (scene.acceptDynamicMaps !== undefined && scene.acceptDynamicMaps !== selected.acceptDynamicMaps) {
    throw new Error(`map deployment conflicts with legacy acceptDynamicMaps: ${scene.name}`);
  }
  return selected;
}

/** 只接受明确字段，避免部署拼写错误被静默忽略。 / Rejects unknown or missing fields so deployment typos cannot disappear silently. */
function object(value: unknown, fields: readonly string[], label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some(key => !fields.includes(key)) || fields.some(key => !Object.hasOwn(record, key))) throw new Error(`${label} fields must be: ${fields.join(", ")}`);
  return record;
}

/** 地图 ID 与旧 Rust u32 范围一致，额外拒绝无效零值、重复和过大数组。 / Keeps the u32 range while rejecting invalid zero, duplicates and oversized lists. */
function mapIds(value: unknown, bounded = true): readonly number[] {
  if (!Array.isArray(value) || (bounded && value.length > 1024) || Array.from(value).some(id => !Number.isInteger(id) || id <= 0 || id > 0xffffffff)
    || new Set(value).size !== value.length) throw new Error("staticMapIds must contain at most 1024 distinct positive u32 IDs");
  return Object.freeze([...value]);
}
