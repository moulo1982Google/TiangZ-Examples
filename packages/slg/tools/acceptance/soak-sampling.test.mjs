import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { idle } from './hotfix-resources.mjs';
import { settledResourceSample, samplingProgress, requireRecoverySamples } from './soak-sampling.mjs';

const fixture = JSON.parse(await readFile(new URL('./fixtures/soak-resource-20260918.json', import.meta.url), 'utf8'));
const clean = fixture.samples.find(idle);

test('recorded eight-hour evidence reproduces the original 23-to-18 sample failure', () => {
  assert.equal(fixture.samples.length, 23);
  const accepted = fixture.samples.filter(idle).map(s => ({ ...s, pid: 1 }));
  assert.equal(accepted.length, 18);
  assert.throws(() => requireRecoverySamples(accepted), /18\/20/);
});

test('stale idle publications cannot pass; fresh busy resets the consecutive idle count', async () => {
  let clock = 0, index = 0; const observed = [];
  const values = [[1, 0], [1, 0], [2, 0], [3, 1], [4, 0], [4, 0], [5, 0]];
  const result = await settledResourceSample({
    read: async () => { const [publishedAt, pending] = values[index++]; return { publishedAt, sample: { ...clean, pending } }; },
    wait: async ms => { clock += ms; }, now: () => clock, timeoutMs: 4000, observe: async v => observed.push(v),
  });
  assert.equal(result.publishedAt, 5); assert.equal(index, 7);
  assert.equal(observed.filter(v => v.fresh && !v.idle).length, 1);
});

test('a permanently busy queue and a frozen idle exporter both fail within the budget', async () => {
  for (const busy of [true, false]) {
    let clock = 0, calls = 0;
    await assert.rejects(settledResourceSample({
      read: async () => ({ publishedAt: busy ? ++calls : 1, sample: { ...clean, pending: busy ? 1 : 0 } }),
      wait: async ms => { clock += ms; }, now: () => clock, timeoutMs: 2000, observe: async () => {},
    }), /did not settle within 2000ms/);
    assert.equal(clock, 2000);
  }
});

test('sample shortage is detected before the end and restart cannot hide resource growth', () => {
  assert.deepEqual(samplingProgress(18, 20, 90, 110, 10), { collected: 18, required: 20, remainingSlots: 2 });
  assert.throws(() => samplingProgress(18, 20, 100, 110, 10), /insufficient remaining/);
  const samples = Array.from({ length: 20 }, () => ({ ...clean, pid: 1 }));
  requireRecoverySamples(samples);
  samples[19].pid = 2; assert.throws(() => requireRecoverySamples(samples), /same process/);
});
