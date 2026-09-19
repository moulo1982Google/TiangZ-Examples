import test from 'node:test';
import assert from 'node:assert/strict';
import { assertMarch, soakPhase, eightHours } from './soak.mjs';

test('eight-hour phases preserve a two-hour uninterrupted recovery window and final drain', () => {
  const phase = minutes => soakPhase(minutes * 60000);
  assert.equal(eightHours, 28800000);
  assert.deepEqual([0, 30, 210, 330, 450, 479].map(phase), ['baseline', 'hotfix', 'faults', 'recovery', 'drain', 'drain']);
});

test('march reconciliation rejects early settlement, changed commands and stale reservations', () => {
  const march = { tile: 4, power: 270, dueAt: 1000 };
  const before = { marches: [march] }, after = { marches: [], serverTime: 1001, tiles: [{ id: 4, owner: '', reservedBy: '' }] };
  assert.equal(assertMarch(before, after), 10);
  assert.equal(assertMarch(before, before), 0);
  assert.throws(() => assertMarch(before, { ...after, serverTime: 999 }));
  assert.throws(() => assertMarch(before, { ...after, tiles: [{ id: 4, owner: 'alice', reservedBy: '' }] }));
  assert.throws(() => assertMarch(before, { marches: [{ ...march, dueAt: 2000 }] }));
  assert.equal(assertMarch({ march: null }, { marches: [] }), 0);
});

test('three-hour phases keep an uninterrupted hour for recovery and twenty sample slots', () => {
  assert.deepEqual([0, 10, 70, 110, 170, 179].map(m => soakPhase(m * 60000, true)), ['baseline', 'hotfix', 'faults', 'recovery', 'drain', 'drain']);
  assert.equal(Array.from({ length: 90 }, (_, i) => i * 2).filter(m => soakPhase(m * 60000, true) === 'recovery').length, 30);
});
