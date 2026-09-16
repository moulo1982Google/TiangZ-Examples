import { runSelfTest } from "../../TiangZ/tools/self_test_entry";
import assert from "node:assert/strict";
import { CanClaimRegularLoot } from "../modules/mmorpg/src/model/loot/LootContainer";

export function main(): void {
  // 普通掉落只能由首个有效攻击者领取；任务掉落不走这个判断。
  // Regular loot belongs only to the first effective attacker; quest loot uses a separate rule.
  const container = { lootOwnerAccount: "attacker" };
  assert.equal(CanClaimRegularLoot(container, "attacker"), true);
  assert.equal(CanClaimRegularLoot(container, "bystander"), false);

  console.log("Loot ownership self-test passed");
}

runSelfTest(main);
