import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { root, engine, until } from './environment.mjs';
import { replaceOnce } from './hotfix-build.mjs';
import { assertPair, hotfixScenarios, assertProtocolRejection } from './hotfix-scenarios.mjs';
import { metric, resourceSample, windowSummary, assertGrowth } from './hotfix-resources.mjs';
import { cases, smoke30 } from './plan.mjs';

test('source drift and duplicate anchors fail instead of silently making a wrong candidate', () => {
  assert.equal(replaceOnce('a-b', '-', '+'), 'a+b');
  assert.throws(() => replaceOnce('a', 'b', 'c'));
  assert.throws(() => replaceOnce('a-a', 'a', 'c'));
});

test('protocol rejection proves changed protocol and exact first failing contract instead of any rejection', () => {
  const active = { modelFingerprint: 'm1', protocolFingerprint: 'p1' }, candidate = { modelFingerprint: 'm2', protocolFingerprint: 'p2' };
  assertProtocolRejection(active, candidate, 'Hotfix cannot change modelFingerprint: active Model=m1, candidate Hotfix=m2; restart');
  assert.throws(() => assertProtocolRejection(active, { ...candidate, protocolFingerprint: 'p1' }, 'Hotfix cannot change modelFingerprint: active Model=m1, candidate Hotfix=m2;'));
  assert.throws(() => assertProtocolRejection(active, candidate, 'unrelated failure'));
  assert.throws(() => assertProtocolRejection(active, candidate, 'Hotfix cannot change modelFingerprint: active Model=m1, candidate Hotfix=wrong;'));
});
test('pair checks reject mixed behavior, incorrect costs and missing identity', () => {
  const view = { fixtureCode: 2, fixtureConfig: 2, fixtureCost: 240, fixtureDuration: 12000, fixtureConfigHash: 'a'.repeat(64) };
  assertPair(view, 'P22');
  for (const bad of [{ fixtureCode: 1 }, { fixtureCost: 200 }, { fixtureConfigHash: '' }]) assert.throws(() => assertPair({ ...view, ...bad }, 'P22'));
});
test('every advertised H/J case has a runnable handler; smoke30 includes all joint variants', () => {
  for (const id of Object.keys(cases).filter(id => /^[HJ]/.test(id))) assert.equal(typeof hotfixScenarios[id], 'function', id);
  for (const id of ['H1', 'H4', 'H6', 'H7a', 'H7b', 'J1b', 'J2', 'J3a', 'J3b']) assert.ok(smoke30.includes(id));
});

test('official game codecs correlate held client frames and close discards undelivered commands', { timeout: 15000 }, async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'slg-hotfix-client-'));
  t.after(() => { assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir())); return rm(directory, { recursive: true, force: true }); });
  const entry = path.join(directory, 'entry.ts'), output = path.join(directory, 'client.mjs');
  await writeFile(entry, `
    export {SlgConnection} from ${JSON.stringify(path.join(root, 'tools/acceptance/hotfix-client.ts'))};
    export {registerClientTransport} from '#fixture/Core/Net/ClientTransport';
    export {SlgProtocol} from '#fixture/slg/protocol/rpcs';
    export {packFrame} from '#fixture/Core/Protocol/Frame';
  `);
  const require = createRequire(path.join(engine, 'package.json'));
  await require('esbuild').build({ entryPoints: [entry], outfile: output, bundle: true, format: 'esm', platform: 'node', alias: { '#fixture': path.join(root, 'modules/slg/generated/typescript') } });
  const { SlgConnection, registerClientTransport, SlgProtocol, packFrame } = await import(pathToFileURL(output));
  const transports = [];
  registerClientTransport('websocket', endpoint => {
    const transport = { endpoint, connected: false, sent: [], listener: undefined,
      async connect() { this.connected = true; }, setListener(listener) { this.listener = listener; },
      send(frame) { this.sent.push(SlgProtocol.Game.requestCodec.decode(frame.subarray(2))); },
      close() { this.connected = false; this.listener.onClose(Error('test closed')); },
    }; transports.push(transport); return transport;
  });
  const client = new SlgConnection(), pump = setInterval(() => client.update(), 5);
  t.after(() => { clearInterval(pump); client.close(); });
  client.arm('response', request => request?.sequence === 7);
  const pending = client.game({ player: 'alice', sequence: 7, action: 'draw-hero', target: 0, amount: 0 }); pending.catch(() => {});
  await until(() => transports[0].sent.length === 1, 'sent formal request', 1000);
  const request = transports[0].sent[0];
  const response = { rpcId: request.rpcId, error: 0, player: 'alice', sequence: 7, food: 2700, troops: 100,
    buildings: [], heroes: [], marches: [], tiles: [], persisted: true, report: '', serverTime: 0, nextProductionAt: 60000,
    receipt: { sequence: 7, fingerprint: 'draw', accepted: true, message: 'original', heroId: 2 } };
  transports[0].listener.onMessage(packFrame(SlgProtocol.Game.responseCode, SlgProtocol.Game.responseCodec.encode(response)));
  assert.equal(client.hit().request.sequence, 7); assert.equal(client.hit().value.receipt.heroId, 2);
  assert.equal(client.socket.queuedMessages, 0); client.release();
  assert.equal((await pending).receipt.heroId, 2);
  client.arm('request', req => req?.sequence === 8);
  const discarded = client.game({ player: 'alice', sequence: 8, action: 'recruit', target: 0, amount: 1 }); discarded.catch(() => {});
  await until(() => client.hit(), 'held request', 1000);
  assert.equal(transports[0].sent.length, 1); client.close(); client.release();
  await assert.rejects(discarded); assert.equal(transports[0].sent.length, 1);
  const short = new SlgConnection('127.0.0.1', 18001, 500);
  const shortPump = setInterval(() => short.update(), 5);
  t.after(() => { clearInterval(shortPump); short.close(); });
  const original = { player: 'alice', sequence: 7, action: 'draw-hero', target: 0, amount: 0 };
  await assert.rejects(short.game({ ...original }), /timeout|timed out|超时/i);
  assert.equal(short.socket.state, 'connected');
  const firstRpc = transports[1].sent[0].rpcId;
  transports[1].listener.onMessage(packFrame(SlgProtocol.Game.responseCode, SlgProtocol.Game.responseCodec.encode({ ...response, rpcId: firstRpc })));
  short.update();
  const retry = short.game({ ...original }); retry.catch(() => {});
  await until(() => transports[1].sent.length === 2, 'retry after local timeout', 1000);
  const secondRpc = transports[1].sent[1].rpcId; assert.notEqual(secondRpc, firstRpc);
  assert.equal(transports[1].sent[1].sequence, 7);
  transports[1].listener.onMessage(packFrame(SlgProtocol.Game.responseCode, SlgProtocol.Game.responseCodec.encode({ ...response, rpcId: secondRpc })));
  assert.equal((await retry).receipt.heroId, 2);

});

test('custom outbound gauges are selected by labels; absent gauges never become zero', () => {
  const text = 'tiangz_scene_custom_metric_gauge{key="outbound_total_depth",name="outbound_lanes"} 2\n'
    + 'tiangz_scene_custom_metric_gauge{key="outbound_total_depth_max",name="outbound_lanes"} 9\n';
  assert.equal(metric(text, 'tiangz_scene_custom_metric_gauge', { name: 'outbound_lanes', key: 'outbound_total_depth' }), 2);
  assert.throws(() => metric(text, 'missing'), e => e.acceptanceStatus === 'not-effective');
  assert.throws(() => resourceSample(text), /missing/);
});
const stableSample = at => ({ at, heap: 100 * 1024 ** 2, rss: 200 * 1024 ** 2, timers: 4,
  pending: 0, deadlines: 0, residents: 3, playerTimers: 3, ingress: 0, mailbox: 0, frameQueue: 0, outbound: 0 });
test('resource windows reject missing samples, hidden pending work and leaked timers', () => {
  const samples = Array.from({ length: 30 }, (_, i) => stableSample(i * 1000));
  const baseline = windowSummary(samples, 0, 30000);
  assert.throws(() => windowSummary(samples.slice(0, 20), 0, 30000), /incomplete/);
  assert.throws(() => windowSummary(samples.map((s, i) => i === 10 ? { ...s, pending: 1 } : s), 0, 30000), /unexplained/);
  assertGrowth(baseline, Array.from({ length: 10 }, () => ({ ...baseline })));
  assert.throws(() => assertGrowth(baseline, Array.from({ length: 10 }, () => ({ ...baseline, timers: 5 }))), /Timer/);
});
test('resource growth gate detects absolute growth and sustained medians independently', () => {
  const baseline = { heap: 100 * 1024 ** 2, rss: 200 * 1024 ** 2, timers: 4 };
  const windows = Array.from({ length: 10 }, (_, i) => ({ ...baseline, heap: baseline.heap + Math.max(0, i - 4) * 5 * 1024 ** 2 }));
  assert.throws(() => assertGrowth(baseline, windows), /sustained/);
  assert.throws(() => assertGrowth(baseline, Array.from({ length: 10 }, () => ({ ...baseline, rss: baseline.rss + 65 * 1024 ** 2 }))), /allowance/);
});
