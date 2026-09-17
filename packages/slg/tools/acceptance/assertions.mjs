import assert from 'node:assert/strict';

/** 只按已推进的完整分钟对账，允许两次响应跨分钟。 / Reconcile complete minutes, including a boundary between responses. */
export function assertIncome(before, after, spent = 0) {
  const start = before.producedAt ?? before.nextProductionAt - 60000;
  const end = after.producedAt ?? after.nextProductionAt - 60000;
  const minutes = (end - start) / 60000;
  assert.ok(Number.isSafeInteger(minutes) && minutes >= 0, 'production checkpoint must advance by whole minutes');
  assert.equal(after.food, Math.min(1_000_000_000, before.food + minutes * 100) - spent);
  return { minutes, start, end, spent };
}

/** 原回执与资产独立比较，不把战报当回执。 / Compare the original receipt independently of mutable battle reports. */
export function assertReceipt(actual, expected) {
  assert.ok(expected && expected.sequence > 0, 'a persisted receipt is required');
  assert.deepEqual(actual, expected, 'original receipt must survive retries and report changes');
}

/** 恢复允许正常产粮，但不得回退扣费、兵力、武将或操作号。 / Allow income, never roll back committed assets or command identity. */
export function assertPlayer(saved, view) {
  assert.equal(view.persisted, true);
  assert.equal(view.player, saved.id);
  assert.equal(view.sequence, saved.sequence);
  assert.equal(view.troops, saved.troops);
  assert.deepEqual(view.heroes, saved.heroes);
  assertIncome(saved, view);
  if (saved.receipt) assertReceipt(view.receipt, saved.receipt);
}
