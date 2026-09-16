// MMORPG configuration rules relocated from the original generator.
const ACTION_TYPE_MAX = 10;
export function validateGeneratedSpatialData(data) {
  const maps = data.game_tbmapconfig;
  const aois = data.game_tbaoiconfig;
  if (!Array.isArray(maps) || !Array.isArray(aois)) {
    throw new Error("Luban spatial config tables are missing");
  }
  const aoiById = new Map(aois.map((row) => [row.id, row]));
  for (const map of maps) {
    const aoi = aoiById.get(map.aoi_config_id);
    const gridSize = aoi?.grid_size_cells;
    if (!Number.isSafeInteger(gridSize) || gridSize <= 0) {
      throw new Error(`MapConfig ${map.id} references an invalid AoiConfig`);
    }
    if (
      !Number.isSafeInteger(map.width_cells) || !Number.isSafeInteger(map.depth_cells) ||
      map.width_cells < 3 || map.depth_cells < 3 ||
      map.width_cells % gridSize !== 0 || map.depth_cells % gridSize !== 0
    ) {
      throw new Error(
        `MapConfig ${map.id} width_cells/depth_cells must be positive multiples of AOI grid_size_cells=${gridSize}`,
      );
    }
  }
}

export function validateGeneratedActionAndSkillData(data) {
  const items = data.game_tbitemconfig;
  const buffs = data.game_tbbuffconfig;
  const skills = data.game_tbskillconfig;
  const effects = data.game_tbskilleffectconfig;
  const drops = data.game_tbdroptableconfig;
  const monsters = data.game_tbmonsterconfig;
  const objectives = data.game_tbquestobjectiveconfig;
  if (!Array.isArray(items) || !Array.isArray(buffs) || !Array.isArray(skills) || !Array.isArray(effects) || !Array.isArray(drops) || !Array.isArray(monsters) || !Array.isArray(objectives)) {
    throw new Error("Luban Item/Buff/Skill config tables are missing");
  }
  const itemIds = new Set(items.map((row) => row.id));
  const objectiveById = new Map(objectives.map((row) => [row.id, row]));
  const dropTableIds = new Set(drops.map((row) => row.drop_table_id));
  for (const drop of drops) {
    const itemDrop = Number.isSafeInteger(drop.item_config_id) && drop.item_config_id > 0 && itemIds.has(drop.item_config_id) &&
      Number.isSafeInteger(drop.min_count) && drop.min_count > 0 &&
      Number.isSafeInteger(drop.max_count) && drop.max_count >= drop.min_count &&
      drop.gold === 0;
    const currencyDrop = drop.item_config_id === 0 && drop.min_count === 0 && drop.max_count === 0 &&
      Number.isSafeInteger(drop.gold) && drop.gold > 0 && drop.quest_objective_id === 0;
    if (
      !Number.isSafeInteger(drop.drop_table_id) || drop.drop_table_id <= 0 ||
      (!itemDrop && !currencyDrop) ||
      !Number.isSafeInteger(drop.chance_permille) || drop.chance_permille < 0 || drop.chance_permille > 1000 ||
      !Number.isSafeInteger(drop.quest_objective_id) || drop.quest_objective_id < 0
    ) {
      throw new Error(`DropTableConfig ${drop.id} has invalid item/currency, count, chance, or objective values`);
    }
    if (drop.quest_objective_id > 0) {
      const objective = objectiveById.get(drop.quest_objective_id);
      if (!objective || objective.objective_type !== 4 || objective.target_config_id !== drop.item_config_id) {
        throw new Error(`DropTableConfig ${drop.id} references an incompatible CollectItem objective`);
      }
    }
  }
  for (const monster of monsters) {
    if (monster.drop_table_id > 0 && !dropTableIds.has(monster.drop_table_id)) {
      throw new Error(`MonsterConfig ${monster.id} references missing DropTableConfig group ${monster.drop_table_id}`);
    }
  }
  const buffIds = new Set(buffs.map((row) => row.id));
  for (const item of items) {
    if (item.use_effect === 0 && item.use_params.length !== 0) {
      throw new Error(`ItemConfig ${item.id} cannot carry parameters when use_effect is 0`);
    }
    if (item.use_effect === 1) {
      if (item.use_params.length !== 1 || !buffIds.has(item.use_params[0])) {
        throw new Error(`ItemConfig ${item.id} AddBuff requires one valid BuffConfig id`);
      }
    } else if (item.use_effect === 2) {
      if (item.use_params.length === 0) {
        throw new Error(`ItemConfig ${item.id} ExecuteAction requires [actionType, ...parameters]`);
      }
      validateRawAction(
        `ItemConfig ${item.id}`,
        item.use_params[0],
        item.use_params.slice(1),
        buffIds,
        false,
      );
    } else if (item.use_effect !== 0) {
      throw new Error(`ItemConfig ${item.id} has unsupported use_effect ${item.use_effect}`);
    }
  }
  for (const buff of buffs) {
    validateRawAction(`BuffConfig ${buff.id} add`, buff.add_action_type, buff.add_action_params, buffIds, false);
    validateRawAction(`BuffConfig ${buff.id} tick`, buff.tick_action_type, buff.tick_action_params, buffIds, false);
    validateRawAction(`BuffConfig ${buff.id} remove`, buff.remove_action_type, buff.remove_action_params, buffIds, true);
    if ((buff.tick_interval_ms === 0) !== (buff.tick_action_type === 0)) {
      throw new Error(`BuffConfig ${buff.id} Tick interval and Action must be configured together`);
    }
  }

  const skillIds = new Set(skills.map((row) => row.id));
  const effectCountBySkill = new Map();
  const ordersBySkill = new Map();
  for (const effect of effects) {
    if (!skillIds.has(effect.skill_id)) {
      throw new Error(`SkillEffectConfig ${effect.id} references missing SkillConfig ${effect.skill_id}`);
    }
    if (!Number.isSafeInteger(effect.order) || effect.order <= 0) {
      throw new Error(`SkillEffectConfig ${effect.id} needs a positive integer order`);
    }
    const orders = ordersBySkill.get(effect.skill_id) ?? new Set();
    if (orders.has(effect.order)) {
      throw new Error(`SkillConfig ${effect.skill_id} has duplicate effect order ${effect.order}`);
    }
    orders.add(effect.order);
    ordersBySkill.set(effect.skill_id, orders);
    if (effect.target !== 1 && effect.target !== 2) {
      throw new Error(`SkillEffectConfig ${effect.id} has unsupported target ${effect.target}`);
    }
    if (typeof effect.description !== "string" || effect.description.trim().length === 0) {
      throw new Error(`SkillEffectConfig ${effect.id} needs a description`);
    }
    if (effect.action_type === 0) {
      throw new Error(`SkillEffectConfig ${effect.id} cannot use ActionType.None`);
    }
    validateRawAction(`SkillEffectConfig ${effect.id}`, effect.action_type, effect.action_params, buffIds, false, true);
    effectCountBySkill.set(effect.skill_id, (effectCountBySkill.get(effect.skill_id) ?? 0) + 1);
  }
  for (const skill of skills) {
    const orderedEffects = effects
      .filter((effect) => effect.skill_id === skill.id)
      .sort((left, right) => left.order - right.order || left.id - right.id);
    let hasResolvedDamage = false;
    for (const effect of orderedEffects) {
      if (effect.action_type === 4) hasResolvedDamage = true;
      if (effect.action_type !== 8) continue;
      if (!hasResolvedDamage) {
        throw new Error(`SkillConfig ${skill.id} HealFromResolvedDamagePercent must follow DealDamage`);
      }
      if (effect.target !== 1) {
        throw new Error(`SkillConfig ${skill.id} HealFromResolvedDamagePercent must target Caster`);
      }
    }
    if (typeof skill.description !== "string" || skill.description.trim().length === 0) {
      throw new Error(`SkillConfig ${skill.id} needs a description`);
    }
    if (
      !Number.isSafeInteger(skill.cast_time_ms) || skill.cast_time_ms < 0 ||
      !Number.isSafeInteger(skill.cooldown_ms) || skill.cooldown_ms < 0 ||
      !Number.isSafeInteger(skill.global_cooldown_ms) || skill.global_cooldown_ms < 0 ||
      !Number.isFinite(skill.range_meters) || skill.range_meters <= 0 ||
      !Number.isSafeInteger(skill.queue_window_ms) || skill.queue_window_ms < 0 ||
      !Number.isSafeInteger(skill.channel_tick_ms) || skill.channel_tick_ms < 0 ||
      !Number.isSafeInteger(skill.channel_ticks) || skill.channel_ticks < 0
    ) {
      throw new Error(`SkillConfig ${skill.id} has invalid cast, cooldown, range, queue, or channel values`);
    }
    if (skill.target_relation !== 1 && skill.target_relation !== 2) {
      throw new Error(`SkillConfig ${skill.id} has unsupported target relation`);
    }
    if (skill.movement_policy !== 1 && skill.movement_policy !== 2) {
      throw new Error(`SkillConfig ${skill.id} has unsupported movement policy`);
    }
    if (!Number.isSafeInteger(skill.auto_attack_policy) || skill.auto_attack_policy < 1 || skill.auto_attack_policy > 4) {
      throw new Error(`SkillConfig ${skill.id} has unsupported auto-attack policy`);
    }
    if (
      (skill.delivery === 1 && skill.projectile_speed_meters_per_second !== 0) ||
      (skill.delivery === 2 && (!Number.isFinite(skill.projectile_speed_meters_per_second) || skill.projectile_speed_meters_per_second <= 0)) ||
      (skill.delivery !== 1 && skill.delivery !== 2)
    ) {
      throw new Error(`SkillConfig ${skill.id} has invalid delivery or projectile speed`);
    }
    if ((skill.channel_tick_ms === 0) !== (skill.channel_ticks === 0)) {
      throw new Error(`SkillConfig ${skill.id} must configure channel tick interval and count together`);
    }
    if (skill.channel_ticks > 0 && (skill.delivery !== 1 || skill.cast_time_ms < skill.channel_tick_ms * skill.channel_ticks)) {
      throw new Error(`SkillConfig ${skill.id} channel must be direct and fit inside cast time`);
    }
    if (skill.required_absent_buff_config_id > 0 && !buffIds.has(skill.required_absent_buff_config_id)) {
      throw new Error(`SkillConfig ${skill.id} references missing blocking BuffConfig`);
    }
    if ((effectCountBySkill.get(skill.id) ?? 0) === 0) {
      throw new Error(`SkillConfig ${skill.id} needs at least one effect`);
    }
  }
}

export function validateRawAction(owner, type, parameters, buffIds, allowEmptyRemove, allowResolvedDamage = false) {
  if (!Number.isSafeInteger(type) || type < 0 || type >= ACTION_TYPE_MAX || !Array.isArray(parameters)) {
    throw new Error(`${owner} has an unsupported Action`);
  }
  if (!parameters.every(Number.isSafeInteger)) {
    throw new Error(`${owner} has non-integer Action parameters`);
  }
  if (type === 8 && !allowResolvedDamage) {
    throw new Error(`${owner} HealFromResolvedDamagePercent is only valid in SkillEffectConfig`);
  }
  const expected = type === 0 ? 0
    : type === 1 ? 2
      : type === 2 ? 1
        : type === 3 ? (allowEmptyRemove ? undefined : 1)
          : type === 4 ? 2
            : type === 6 ? 1
              : type === 7 ? 2
                : type === 8 ? 1
                : undefined;
  if (expected !== undefined && parameters.length !== expected) {
    throw new Error(`${owner} expects ${expected} Action parameters`);
  }
  if (type === 3 && allowEmptyRemove && parameters.length > 1) {
    throw new Error(`${owner} RemoveBuff expects zero or one parameter`);
  }
  if (type === 5 && (parameters.length < 1 || parameters.length > 2)) {
    throw new Error(`${owner} RegisterDamageAbsorber expects one or two parameters`);
  }
  if (type === 9 && (parameters.length === 0 || parameters.length % 2 !== 0)) {
    throw new Error(`${owner} ChangeNumericBatch expects one or more [numericType, delta] pairs`);
  }
  if (type === 10 && (parameters.length === 0
    || parameters.some((value) => value <= 0)
    || new Set(parameters).size !== parameters.length)) {
    throw new Error(`${owner} RemoveBuffsByEffectTags needs unique positive effect tags`);
  }
  if (type === 1) {
    if (parameters[0] === 1) {
      throw new Error(`${owner} ChangeNumeric cannot target CurrentHp; use Heal or DealDamage`);
    }
    if (parameters[0] <= 0 || (parameters[0] >= 1_000 && parameters[0] <= 9_999)) {
      throw new Error(`${owner} ChangeNumeric targets an invalid or derived NumericType`);
    }
  }
  if (type === 9) {
    const seenNumericTypes = new Set();
    for (let index = 0; index < parameters.length; index += 2) {
      if (parameters[index] === 1) {
        throw new Error(`${owner} ChangeNumericBatch cannot target CurrentHp; use Heal or DealDamage`);
      }
      if (parameters[index] <= 0 || (parameters[index] >= 1_000 && parameters[index] <= 9_999)) {
        throw new Error(`${owner} ChangeNumericBatch targets an invalid or derived NumericType`);
      }
      if (seenNumericTypes.has(parameters[index])) {
        throw new Error(`${owner} ChangeNumericBatch contains duplicate NumericType`);
      }
      seenNumericTypes.add(parameters[index]);
    }
  }
  if (type === 2 && !buffIds.has(parameters[0])) {
    throw new Error(`${owner} AddBuff references missing BuffConfig ${parameters[0]}`);
  }
  if (type === 4 && (parameters[0] < 0 || parameters[1] < 1 || parameters[1] > 5)) {
    throw new Error(`${owner} DealDamage needs [non-negative amount, valid DamageSchool]`);
  }
  if (type === 5 && (parameters[0] <= 0 || (parameters[1] ?? 0) < 0)) {
    throw new Error(`${owner} RegisterDamageAbsorber needs positive amount and non-negative priority`);
  }
  if (type === 6 && parameters[0] < 0) {
    throw new Error(`${owner} Heal needs a non-negative amount`);
  }
  if (type === 8 && parameters[0] < 0) {
    throw new Error(`${owner} HealFromResolvedDamagePercent needs a non-negative percent`);
  }
}

export function selfTestActionValidation() {
  let rejected = false;
  try {
    validateRawAction("self-test", 1, [1, 50], new Set(), false);
  } catch (error) {
    rejected = String(error).includes("ChangeNumeric cannot target CurrentHp");
  }
  if (!rejected) throw new Error("ChangeNumeric(CurrentHp) codegen validation did not reject the action");
  validateRawAction("self-test", 1, [2, 50], new Set(), false);
  validateRawAction("self-test", 9, [2, 50, 3, -10], new Set(), false);
  rejected = false;
  try {
    validateRawAction("self-test", 9, [2, 50, 3], new Set(), false);
  } catch (error) {
    rejected = String(error).includes("ChangeNumericBatch expects");
  }
  if (!rejected) throw new Error("ChangeNumericBatch odd parameter validation did not reject the action");
  process.stdout.write("game config Action validation self-test passed\n");
}

export function createClientFacade(data, dataFingerprint) {
  return `// Generated by tools/codegen_game_config.mjs for client. Do not edit.
import { Tables, type game } from "./schema";

const RAW_DATA: Record<string, unknown> = ${JSON.stringify(data, null, 2)};

class ConfigTable<T extends { readonly id: number }> {
  private readonly byId: ReadonlyMap<number, T>;
  private readonly values: readonly T[];

  constructor(values: readonly T[]) {
    const copy = values.map((value) => Object.freeze(value));
    this.values = Object.freeze(copy);
    this.byId = new Map(copy.map((value) => [value.id, value]));
  }

  Get(id: number): T {
    const value = this.byId.get(id);
    if (!value) throw new Error(\`game config not found: id=\${id}\`);
    return value;
  }

  TryGet(id: number): T | undefined {
    return this.byId.get(id);
  }

  GetAll(): readonly T[] {
    return this.values;
  }
}

const tables = new Tables((file) => {
  const value = RAW_DATA[file];
  if (value === undefined) throw new Error(\`game config data not found: \${file}\`);
  return value;
});

export type ItemConfig = game.ItemConfig;
export type BuffConfig = game.BuffConfig;
export type MapConfig = game.MapConfig;
export type PlayerConfig = game.PlayerConfig;
export type AoiConfig = game.AoiConfig;
export type AoiSyncTierConfig = game.AoiSyncTierConfig;
export type MonsterConfig = game.MonsterConfig;
export type SkillConfig = game.SkillConfig;
export type QuestConfig = game.QuestConfig;
export type QuestObjectiveConfig = game.QuestObjectiveConfig;

export const GameConfigFingerprint = "${dataFingerprint}";
export const GameConfigs = Object.freeze({
  ItemConfig: new ConfigTable<game.ItemConfig>(tables.TbItemConfig.getDataList()),
  BuffConfig: new ConfigTable<game.BuffConfig>(tables.TbBuffConfig.getDataList()),
  MapConfig: new ConfigTable<game.MapConfig>(tables.TbMapConfig.getDataList()),
  PlayerConfig: new ConfigTable<game.PlayerConfig>(tables.TbPlayerConfig.getDataList()),
  AoiConfig: new ConfigTable<game.AoiConfig>(tables.TbAoiConfig.getDataList()),
  AoiSyncTierConfig: new ConfigTable<game.AoiSyncTierConfig>(tables.TbAoiSyncTierConfig.getDataList()),
  MonsterConfig: new ConfigTable<game.MonsterConfig>(tables.TbMonsterConfig.getDataList()),
  SkillConfig: new ConfigTable<game.SkillConfig>(tables.TbSkillConfig.getDataList()),
  QuestConfig: new ConfigTable<game.QuestConfig>(tables.TbQuestConfig.getDataList()),
  QuestObjectiveConfig: new ConfigTable<game.QuestObjectiveConfig>(tables.TbQuestObjectiveConfig.getDataList()),
});
`;
}

export function readReloadPolicies(serverData, clientData) {
  const metadataKey = "game_tbconfigtablepolicy";
  const rows = serverData[metadataKey];
  if (!Array.isArray(rows)) {
    throw new Error(`Luban reload policy table is missing: ${metadataKey}`);
  }
  const hot = [];
  const cold = [metadataKey];
  const declared = new Set();
  for (const row of rows) {
    const tableName = row?.table_name;
    const mode = row?.reload_mode;
    if (typeof tableName !== "string" || tableName.length === 0) {
      throw new Error("Luban reload policy contains an invalid table_name");
    }
    const dataKey = `game_tb${tableName.toLowerCase()}`;
    if (declared.has(dataKey)) throw new Error(`duplicate reload policy: ${tableName}`);
    if (!(dataKey in serverData)) throw new Error(`reload policy references unknown table: ${tableName}`);
    declared.add(dataKey);
    if (mode === 1) hot.push(dataKey);
    else if (mode === 2) cold.push(dataKey);
    else throw new Error(`reload policy ${tableName} has unsupported mode ${mode}`);
  }
  for (const dataKey of Object.keys(serverData)) {
    if (dataKey !== metadataKey && !declared.has(dataKey)) {
      throw new Error(`Luban table has no Hot/Cold reload policy: ${dataKey}`);
    }
  }
  for (const dataKey of Object.keys(clientData)) {
    if (!declared.has(dataKey)) {
      throw new Error(`client Luban table has no Hot/Cold reload policy: ${dataKey}`);
    }
  }
  hot.sort((left, right) => left.localeCompare(right, "en"));
  cold.sort((left, right) => left.localeCompare(right, "en"));
  return Object.freeze({ hot, cold });
}

export function partitionData(data, policies) {
  const select = (keys) => Object.fromEntries(
    keys.filter((key) => key in data).map((key) => [key, data[key]]),
  );
  return { hot: select(policies.hot), cold: select(policies.cold) };
}
