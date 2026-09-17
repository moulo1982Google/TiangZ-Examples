import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
const script = path.join(import.meta.dirname, 'recovery.mjs');
test('recovery defaults to a bounded three-player plan without Docker', () => {
  const result = spawnSync(process.execPath, [script], { encoding: 'utf8', env: { ...process.env, PATH: '' } });
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout); assert.equal(plan.players, 3); assert.equal(plan.cases.length, 7);
});
test('unconfirmed recovery and unexpected actions cannot launch resources', () => {
  for (const args of [['run'], ['run', '--confirm', 'yes'], ['unknown'], ['run', '--confirm', 'isolated-slg-crash-test', '--players', '500']]) {
    const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env: { ...process.env, PATH: '' } });
    assert.notEqual(result.status, 0); assert.match(result.stderr, /run requires/);
  }
});
