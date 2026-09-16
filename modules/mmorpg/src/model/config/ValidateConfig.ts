import { CreateGameConfigTables } from "../generated/facade/GameConfigs";

/** 验证领域引用与冷表策略，不修改已发布配置。
 * Validates domain references and cold-table policy without mutating published configuration.
 */
export function validate(tables: Readonly<Record<string, unknown>>, previous?: Readonly<Record<string, unknown>>): void {
  CreateGameConfigTables(tables);
  const metadata = "game_tbconfigtablepolicy";
  const rows = tables[metadata];
  if (!Array.isArray(rows)) throw new Error("MMORPG config reload policy is missing");
  const cold = [metadata];
  const declared = new Set<string>([metadata]);
  for (const row of rows) {
    if (typeof row.table_name !== "string" || ![1, 2].includes(row.reload_mode)) throw new Error("invalid MMORPG config reload policy");
    const name = `game_tb${row.table_name.toLowerCase()}`;
    if (declared.has(name) || !(name in tables)) throw new Error(`duplicate or unknown config policy: ${name}`);
    declared.add(name);
    if (row.reload_mode === 2) cold.push(name);
  }
  if (Object.keys(tables).some(name => !declared.has(name))) throw new Error("MMORPG table has no reload policy");
  if (previous) for (const name of cold) {
    if (JSON.stringify(previous[name]) !== JSON.stringify(tables[name])) throw new Error(`cold module config changed; rebuild and restart: ${name}`);
  }
}
