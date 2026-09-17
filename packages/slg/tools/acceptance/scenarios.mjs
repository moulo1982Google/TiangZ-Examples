import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { assertIncome, assertPlayer, assertReceipt } from './assertions.mjs';
import { until, command } from './environment.mjs';

const marks = env => env.proxies.map(p => p.events.length);
const loads = (env, since, record = env.record()) => env.proxies.reduce((n, p, i) => n + p.loads(record, since[i]), 0);
const value = row => row.value;

/** 每轮使用独立库；所有资产由游戏命令产生。 / Every round owns its database; only game commands create assets. */
async function oldCache(env) {
  const record = env.record();
  const old = await env.probe({ command: 'cache_get', record }); assert.ok(old, 'seed cache missing');
  const view = await env.call('alice', 1, 'draw-hero');
  assert.equal(view.receipt.accepted, true);
  const saved = await env.player();
  await until(async () => Number(await env.sql("SELECT count(*) FROM dbproxy_cache_repairs WHERE namespace='slg.demo.player.v1' AND record_key='realm-41/alice'")) === 0, 'previous repair drained');
  const restored = await env.probe({ command: 'cache_restore', record, snapshot: old });
  assert.equal(restored.revision, old.revision); assert.ok(saved.revision > restored.revision);
  return { old, saved };
}

async function recover(env, saved) {
  const before = marks(env);
  const view = await env.call(); assertPlayer(value(saved), view);
  assert.ok(loads(env, before) > 0, 'a cold player must perform a storage load');
  return view;
}

export const scenarios = {
  async A1(env) {
    const before = await env.call(); const marker = marks(env);
    env.disconnectClients(); await env.wait(11000);
    const after = await env.call(); assertIncome(before, after); assert.equal(loads(env, marker), 0);
    return { before, after, playerLoads: 0, measurementStart: marker };
  },
  async A2(env) {
    const before = await env.call(); const marker = marks(env);
    env.disconnectClients(); const idleAt = Date.now();
    await env.wait(301000);
    const after = await env.call(); assertIncome(before, after); assert.ok(loads(env, marker) >= 1);
    return { before, after, idleMs: Date.now() - idleAt, playerLoads: loads(env, marker), ttlMs: 300000 };
  },
  async A3(env) {
    const evidence = await oldCache(env);
    await env.stopGame(true); await env.startGame();
    return { ...evidence, recovered: await recover(env, evidence.saved) };
  },
  async A4(env) {
    await env.call('alice', 1, 'draw-hero'); const saved = await env.player();
    await env.stopGame(true); await env.startGame();
    const cache = await env.probe({ command: 'cache_negative', record: env.record() }); assert.equal(cache, null);
    assert.equal(await env.probe({ command: 'read', cached: true, record: env.record() }), null, 'negative cache must be effective immediately before cold restore');
    return { saved, recovered: await recover(env, saved), negative: true };
  },
  async A5(env) {
    assert.equal(env.shortTtl, true);
    const building = await env.call('alice', 1, 'upgrade-building', 1);
    const march = await env.call('alice', 2, 'march', 2, 1);
    const marker = marks(env); env.disconnectClients();
    await env.wait(Math.max(building.buildings[0].dueAt, march.marches[0].dueAt) - Date.now() + 1000);
    let rows;
    await until(async () => { rows = await env.rows(); const p = rows.find(r => r.namespace === env.record().namespace && r.key === env.record().key)?.value; return p?.buildings[0].level === 2 && p.march === null; }, 'offline timer settlement', 10000);
    const saved = rows.find(r => r.namespace === env.record().namespace && r.key === env.record().key);
    assert.ok(loads(env, marker) > 0, 'deadline must reload an expired resident');
    assert.equal(saved.value.troops, 98);
    assert.equal(rows.find(r => r.namespace === 'slg.demo.world.v1').value.tiles[0].owner, 'alice');
    const priorToReconnect = Date.now();
    const recovered = await env.call(); assertPlayer(saved.value, recovered);
    return { priorToReconnect, sqlBeforeReconnect: rows, recovered, playerLoads: loads(env, marker), shortTtlMs: 1000 };
  },
  async B1(env) {
    const beforeMetrics = await env.metrics();
    const before = await env.player(); const old = await env.probe({ command: 'cache_get', record: env.record() });
    assert.equal(await env.redis('CLIENT', 'PAUSE', '30000', 'WRITE'), 'OK');
    try {
      const response = await env.call('alice', 1, 'draw-hero'); const saved = await env.player();
      assert.equal(response.receipt.accepted, true); assert.ok(saved.revision > before.revision);
      const cached = await env.probe({ command: 'cache_get', record: env.record() });
      assert.equal(cached.revision, old.revision, 'cache write pause must actually preserve an old cache');
      const pending = await env.sql("SELECT count(*) FROM dbproxy_cache_repairs WHERE namespace='slg.demo.player.v1' AND record_key='realm-41/alice'"); assert.equal(Number(pending), 1);
      let afterMetrics;
      const errors = metrics => Number(metrics.match(/^dbproxy_cache_write_errors_total (\d+)$/m)?.[1] ?? NaN);
      await until(async () => { afterMetrics = await env.metrics(); return errors(afterMetrics) > errors(beforeMetrics); }, 'observed cache write failure', 5000);
      await env.stopGame(true); await env.startGame();
      return { before, saved, cached, response, pending: Number(pending), beforeMetrics, afterMetrics, recovered: await recover(env, saved) };
    } finally { await env.redis('CLIENT', 'UNPAUSE'); }
  },
  async B2(env) {
    await env.call('alice', 1, 'draw-hero'); const saved = await env.player();
    await env.stopGame(true); await env.service('stop', 'cache');
    try { await env.startGame(); return { saved, recovered: await recover(env, saved), scope: 'independent snapshot cache outage; reliable queue Redis remains online' }; }
    finally { await env.service('start', 'cache'); }
  },
  async B3(env) {
    const evidence = await oldCache(env); await env.stopGame(true); await env.startGame();
    await env.service('stop', 'postgres');
    try {
      const cached = await env.probe({ command: 'cache_get', record: env.record() }); assert.equal(cached.revision, evidence.old.revision);
      await assert.rejects(env.call());
      await assert.rejects(env.probe({ command: 'read', record: env.record() }), { code: 3001 });
      await assert.rejects(env.probe({ command: 'batch', records: [env.record()] }), { code: 3001 });
    } finally { await env.service('start', 'postgres'); await env.ready(0); await env.ready(1); }
    const recovered = await env.call(); assertPlayer(evidence.saved.value, recovered);
    return { ...evidence, recovered, failurePath: 'cold player and strict single/batch reads all rejected during primary outage' };
  },
  async B4(env) {
    await env.call('alice', 1, 'draw-hero'); const saved = await env.player();
    const before = await env.compose('ps', '-q', 'dbproxy-a');
    const original = await command('docker', ['inspect', '--format', '{{.State.StartedAt}}', before]);
    await env.service('kill', 'dbproxy-a'); await env.stopGame(true); await env.startGame();
    const recovered = await recover(env, saved); assert.ok(env.proxies[1].loads(env.record()) > 0, 'B must serve the cold read');
    await env.service('start', 'dbproxy-a'); await env.ready(0);
    const restarted = await command('docker', ['inspect', '--format', '{{.State.StartedAt}}', before]); assert.notEqual(restarted, original);
    const fromA = await env.probe({ command: 'read', record: env.record(), endpoint: env.endpoint(0) }); assert.ok(fromA.revision >= saved.revision);
    return { saved, recovered, container: before, originalProcess: original, restartedProcess: restarted, fromA };
  },
  async B5(env) {
    const evidence = await oldCache(env); await env.service('restart', 'cache');
    await until(async () => (await env.redis('PING')) === 'PONG', 'cache restart');
    await env.probe({ command: 'cache_restore', record: env.record(), snapshot: evidence.old });
    await env.stopGame(true); await env.startGame();
    return { ...evidence, recovered: await recover(env, evidence.saved) };
  },
  async B6(env) {
    const old = await env.probe({ command: 'cache_get', record: env.record() });
    await env.redis('CLIENT', 'PAUSE', '30000', 'WRITE');
    let pending, latest;
    try {
      await env.call('alice', 1, 'draw-hero');
      await until(async () => Number(await env.sql("SELECT count(*) FROM dbproxy_cache_repairs WHERE namespace='slg.demo.player.v1' AND record_key='realm-41/alice' AND lease_owner IS NOT NULL")) > 0, 'repair task claimed', 5000);
      await env.call('alice', 2, 'upgrade-building', 1);
      pending = await env.sql("SELECT row_to_json(r) FROM dbproxy_cache_repairs r WHERE namespace='slg.demo.player.v1' AND record_key='realm-41/alice'");
      latest = await env.player();
    } finally { await env.redis('CLIENT', 'UNPAUSE'); }
    await until(async () => (await env.probe({ command: 'cache_get', record: env.record() }))?.revision >= latest.revision, 'repair converges to newest revision');
    const afterOldWrite = await env.probe({ command: 'cache_put', record: env.record(), snapshot: old });
    assert.ok(afterOldWrite.revision >= latest.revision);
    const after = await env.player(); assert.ok(after.revision >= latest.revision); assertReceipt(after.value.receipt, latest.value.receipt);
    return { old, pending: JSON.parse(pending), latest, afterOldWrite, after };
  },
  async D1(env) {
    const concurrent = await env.probe({ command: 'atomic_batch' });
    const storage = await command(env.artifacts.authorityTest, ['--ignored', '--nocapture', '--test-threads=1'], { env: { ...process.env, ...env.probeEnv }, timeout: 60000 });
    await writeFile(path.join(env.directory, 'sql-snapshot-probe.log'), storage);
    assert.match(storage, /1 passed/);
    return { concurrent, sqlSnapshotProbe: 'sql-snapshot-probe.log', scope: 'SLG-isolated records; official backend test verifies one PG operation for default batch' };
  },
  async D2(env) {
    const e = await oldCache(env); const record = env.record();
    const cached = await env.probe({ command: 'read', cached: true, record }); assert.equal(cached.revision, e.old.revision);
    const fenced = await env.probe({ command: 'read', cached: true, record, minimum: e.saved.revision }); assert.ok(fenced.revision >= e.saved.revision);
    await assert.rejects(env.probe({ command: 'read', cached: true, record, minimum: e.saved.revision + 100 }), { code: 3001 });
    await env.probe({ command: 'cache_negative', record });
    assert.equal(await env.probe({ command: 'read', cached: true, record }), null);
    const negative = await env.probe({ command: 'read', cached: true, record, minimum: e.saved.revision }); assert.ok(negative.revision >= e.saved.revision);
    return { ...e, cached, fenced, negative };
  },
  async D3(env) {
    const e = await oldCache(env); const record = env.record();
    const missing = { namespace: 'acceptance.missing', key: 'none' };
    for (const minima of [[], [0, 0]]) {
      const values = await env.probe({ command: 'batch', cached: true, records: [missing, record], minima }); assert.equal(values[0], null); assert.equal(values[1].revision, e.old.revision);
    }
    const values = await env.probe({ command: 'batch', cached: true, records: [missing, record], minima: [0, e.saved.revision] }); assert.equal(values[0], null); assert.ok(values[1].revision >= e.saved.revision);
    await assert.rejects(env.probe({ command: 'batch', cached: true, records: [missing, record], minima: [1, e.saved.revision] }), { code: 3001 });
    assert.equal((await env.probe({ command: 'invalid_batch', record })).code, 1001);
    await env.service('stop', 'postgres');
    try { await assert.rejects(env.probe({ command: 'batch', cached: true, records: [record], minima: [e.saved.revision + 100] }), { code: 3001 }); }
    finally { await env.service('start', 'postgres'); await env.ready(0); }
    return { values, order: [missing, record], invalidLengthRejected: true, primaryFailureRejected: true };
  },
  async D4(env) {
    const e = await oldCache(env); const record = env.record(); const results = [];
    for (let i = 0; i < 2; i++) {
      results.push(await env.probe({ command: 'read', cached: true, record, minimum: e.saved.revision, endpoint: env.endpoint(i) }));
      await env.service('restart', i ? 'dbproxy-b' : 'dbproxy-a'); await env.ready(i);
      results.push(await env.probe({ command: 'read', cached: true, record, minimum: e.saved.revision, endpoint: env.endpoint(i) }));
    }
    assert.ok(results.every(r => r.revision >= e.saved.revision));
    env.dbConfig.storage.authoritativeReadNamespaces = [record.namespace];
    await writeFile(path.join(env.directory, 'db.json'), JSON.stringify(env.dbConfig));
    for (let i = 0; i < 2; i++) { await env.service('restart', i ? 'dbproxy-b' : 'dbproxy-a'); await env.ready(i); }
    await env.probe({ command: 'cache_restore', record, snapshot: e.old });
    for (let i = 0; i < 2; i++) assert.ok((await env.probe({ command: 'read', cached: true, record, endpoint: env.endpoint(i) })).revision >= e.saved.revision);
    return { results, namespaceGuardVerified: true };
  },
  async D5(env) {
    const e = await oldCache(env);
    const legacy = await env.probe({ command: 'legacy_read', record: env.record() }); assert.ok(legacy.revision >= e.saved.revision);
    const rejected = await env.probe({ command: 'reject_old_handshake' }); assert.equal(rejected.rejected, true);
    return { legacy, rejected, scope: 'actual old-fingerprint wire request to new server; simulated old-fingerprint response to new client' };
  },
};
