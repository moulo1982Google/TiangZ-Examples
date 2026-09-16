import type { C2B_Submit } from "#tiangz/module";
export function valid(input: C2B_Submit): boolean {
  return token(input.battleId) && token(input.realmId) && token(input.logicVersion) && token(input.configVersion)
    && Number.isInteger(input.seed) && input.seed >= 0 && input.seed <= 0xffffffff
    && Number.isInteger(input.rounds) && input.rounds >= 1 && input.rounds <= 1_000_000
    && Number.isInteger(input.delayMs) && input.delayMs >= 0 && input.delayMs <= 250;
}
export function token(value: string): boolean { return typeof value === "string" && /^[a-zA-Z0-9-]{1,64}$/.test(value); }
/** 区服只参与任务身份，不选择执行池。 / Realm scopes identity, never pins a worker pool. */
export function taskKey(input: { realmId: string; battleId: string }): string { return JSON.stringify([input.realmId, input.battleId]); }
export function compatible(a: { logicVersion: string; configVersion: string }, b: { logicVersion: string; configVersion: string }): boolean {
  return a.logicVersion === b.logicVersion && a.configVersion === b.configVersion;
}
export function same(a: C2B_Submit, b: C2B_Submit): boolean {
  return a.realmId === b.realmId && a.battleId === b.battleId && compatible(a, b) && a.seed === b.seed && a.rounds === b.rounds && a.delayMs === b.delayMs;
}
