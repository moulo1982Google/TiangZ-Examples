import assert from 'node:assert/strict';
import { appendFile, writeFile, rename, statfs, stat } from 'node:fs/promises';
import path from 'node:path';
import { assertIncome, assertPlayer, assertReceipt } from './assertions.mjs';
import { assertPair } from './hotfix-scenarios.mjs';
import { resourceSample, assertGrowth, metric } from './hotfix-resources.mjs';
import { settledResourceSample, samplingProgress, requireRecoverySamples } from './soak-sampling.mjs';
import { until } from './environment.mjs';

export const eightHours = 8 * 60 * 60 * 1000;
export function soakPhase(elapsed, threeHour = false) {
  const minutes = elapsed / 60000;
  if (threeHour) return minutes < 10 ? 'baseline' : minutes < 70 ? 'hotfix' : minutes < 110 ? 'faults' : minutes < 170 ? 'recovery' : 'drain';
  return minutes < 30 ? 'baseline' : minutes < 210 ? 'hotfix' : minutes < 330 ? 'faults' : minutes < 450 ? 'recovery' : 'drain';
}

/** 行军只使用必败的四号地块，独立核对返兵与解除预订。 / Use a losing march on tile four and verify returns and reservation release independently. */
export function assertMarch(before, after) {
  const old = before.marches?.[0] ?? before.march;
  const current = after.marches?.[0] ?? after.march;
  if (old && !current) {
    assert.ok((after.serverTime ?? after.producedAt) >= old.dueAt, 'march settled before deadline');
    assert.equal(old.tile, 4); assert.equal(old.power, 270);
    if (after.tiles) { const tile = after.tiles.find(t => t.id === 4); assert.equal(tile.owner, ''); assert.equal(tile.reservedBy, ''); }
    return 10;
  }
  assert.deepEqual(current ?? null, old ?? null); return 0;
}

/** 原子替换报告；监控器只能看到完整快照。 / Atomically replace reports so observers only see complete snapshots. */
export async function saveReport(directory, report) {
  await writeFile(path.join(directory, 'report.next.json'), JSON.stringify(report, null, 2));
  await rename(path.join(directory, 'report.next.json'), path.join(directory, 'report.json'));
}

/** 同环境运行八小时；重启仅发生于指定故障阶段，经济指令持续而有界。 / Run eight hours in one environment, with restarts confined to planned faults and bounded economic traffic. */
export async function soak(env, report, save, { smoke = false, sampling = false, threeHour = false } = {}) {
  const duration = sampling ? 10 * 60000 : smoke ? 5 * 60000 : threeHour ? 180 * 60000 : eightHours;
  const start = Date.now(), end = start + duration;
  const sampleInterval = sampling ? 20000 : smoke ? 30000 : (threeHour ? 2 : 5) * 60000;
  const recoveryStart = start + (sampling ? 0 : threeHour ? 110 : 330) * 60000, recoveryEnd = start + (sampling ? 8 : threeHour ? 170 : 450) * 60000;
  report.measurementStartedAt = new Date(start).toISOString(); report.measurementDeadline = new Date(end).toISOString();
  report.profile = sampling ? 'sampling10' : smoke ? 'soak-smoke5' : threeHour ? 'soak3h' : 'soak8h'; report.durationMs = duration;
  report.schedule = { baselineEndMinutes: threeHour ? 10 : 30, hotfixEndMinutes: threeHour ? 70 : 210, recoveryStartMinutes: (recoveryStart - start) / 60000, recoveryEndMinutes: (recoveryEnd - start) / 60000, sampleIntervalMs: sampleInterval };
  report.counts = { snapshots: 0, accepted: 0, retries: 0, reconciliations: 0, hotfix: 0, faults: 0 };
  report.thresholds = { recoveryMs: 60000, maxGrowthBytes: 64 * 1024 ** 2, minDiskFreeBytes: 5 * 1024 ** 3, maxEvidenceBytes: 512 * 1024 ** 2 };
  const players = ['alice', 'bob', 'income'], previous = new Map(), revisions = new Map(), windows = [];
  const pendingTasks = new Map(); let pair = 'P11', previousPair, nextCommand = start, nextSample = start, nextDraw = start + 15 * 60000;
  let nextBuild = start + 60000, nextHotfix = start + (smoke ? 30000 : (threeHour ? 10 : 30) * 60000), nextReconnect = start + 10 * 60000, nextFault = start + (smoke ? 90000 : (threeHour ? 70 : 210) * 60000);
  let hotfixIndex = 0, faultIndex = 0, evidenceBytes = 0, nextMarch = start + (smoke ? 60000 : 2 * 60000);
  const evidence = async value => {
    const line = JSON.stringify({ at: new Date().toISOString(), ...value }) + '\n'; evidenceBytes += Buffer.byteLength(line);
    assert.ok(evidenceBytes < report.thresholds.maxEvidenceBytes, 'bounded soak evidence exceeded');
    await appendFile(path.join(env.directory, 'observations.jsonl'), line);
  };
  const snapshot = async player => {
    const view = await env.call(player); assertPair(view, pair);
    assert.equal(view.fixtureConfigHash, env.artifacts.hotfix.configFingerprints[pair]);
    const before = previous.get(player);
    if (before) {
      assertIncome(before, view); assert.equal(view.sequence, before.sequence); assert.equal(view.troops, before.troops + assertMarch(before, view));
      assert.deepEqual(view.heroes, before.heroes); if (before.sequence) assertReceipt(view.receipt, before.receipt);
      for (const building of view.buildings) {
        const old = before.buildings.find(b => b.id === building.id);
        if (old.dueAt && view.serverTime >= old.dueAt) { assert.equal(building.level, old.level + 1); assert.equal(building.dueAt, 0); }
        else assert.deepEqual(building, old);
      }
    }
    previous.set(player, view); report.counts.snapshots++; return view;
  };
  const transact = async (player, action, target = 0, amount = 0) => {
    const before = await snapshot(player), request = [player, before.sequence + 1, action, target, amount];
    let view;
    // 结果未知保留完整指令与序号；不重新生成操作。 / Preserve the complete command and sequence when the result is unknown.
    try { view = await env.call(...request); }
    catch (error) { await evidence({ type: 'unknown-result', player, sequence: request[1], error: String(error) }); view = await env.call(...request); report.counts.retries++; }
    assertPair(view, pair); assert.equal(view.receipt.accepted, true); assert.equal(view.sequence, request[1]);
    const spent = action === 'recruit' ? amount * 10 : action === 'draw-hero' ? 300 : action === 'march' ? 100 : before.buildings.find(b => b.id === target).level * before.fixtureCost;
    assertIncome(before, view, spent);
    assert.equal(view.troops, before.troops + (action === 'recruit' ? amount : action === 'march' ? -20 : 0) + (action === 'march' ? 0 : assertMarch(before, view)));
    if (action === 'march') {
      assert.equal(view.marches.length, 1); assert.equal(view.marches[0].tile, 4); assert.equal(view.marches[0].power, 270);
      assert.equal(view.tiles.find(t => t.id === 4).reservedBy, player);
    }
    if (action === 'draw-hero') {
      const selected = view.receipt.heroId; assert.ok([1, 2, 3].includes(selected));
      assert.equal(view.heroes.length, before.heroes.length + (before.heroes.some(h => h.id === selected) ? 0 : 1));
      for (const h of view.heroes) { const old = before.heroes.find(v => v.id === h.id); assert.equal(h.copies, (old?.copies ?? 0) + (h.id === selected ? 1 : 0)); assert.equal(h.level, old?.level ?? 1); }
    } else assert.deepEqual(view.heroes, before.heroes);
    if (action === 'upgrade-building') pendingTasks.set(player + ':' + target, view.buildings.find(b => b.id === target));
    const retry = await env.call(...request); assertReceipt(retry.receipt, view.receipt); assertIncome(view, retry);
    assert.equal(retry.sequence, view.sequence); assert.equal(retry.troops, view.troops + assertMarch(view, retry)); assert.deepEqual(retry.heroes, view.heroes);
    previous.set(player, retry); report.counts.accepted++; report.counts.retries++;
    await evidence({ type: 'accepted', player, request: { sequence: request[1], action, target, amount }, before, view, retry });
  };
  const reconcile = async () => {
    for (const player of players) await snapshot(player);
    const rows = await env.rows();
    for (const player of players) {
      const row = rows.find(r => r.namespace === env.record(player).namespace && r.key === env.record(player).key); assert.ok(row);
      assert.ok(row.revision >= (revisions.get(player) ?? 0), 'confirmed revision regressed'); revisions.set(player, row.revision);
      const view = previous.get(player); assertIncome(view, row.value); assert.equal(row.value.sequence, view.sequence);
      // SQL快照没有serverTime；用查询结束时间验证自然到期。 / SQL payloads lack serverTime; use query completion time for natural deadlines.
      assert.equal(row.value.troops, view.troops + assertMarch(view, { ...row.value, serverTime: Date.now() })); assert.deepEqual(row.value.heroes, view.heroes);
      if (view.sequence) assertReceipt(row.value.receipt, view.receipt);
      for (const [key, task] of pendingTasks) if (key.startsWith(player + ':') && Date.now() > task.dueAt + 10000) {
        const current = row.value.buildings.find(b => b.id === task.id); assert.equal(current.level, task.level + 1); assert.equal(current.dueAt, 0); pendingTasks.delete(key);
      }
    }
    report.counts.reconciliations++; return rows;
  };
  const fault = async kind => {
    await evidence({ type: 'fault-start', kind }); const began = Date.now();
    if (kind === 'cache-pause') {
      const old = await env.probe({ command: 'cache_get', record: env.record() });
      const before = await env.metrics();
      await env.redis('CLIENT', 'PAUSE', '30000', 'WRITE');
      try {
        await transact('alice', 'recruit', 0, 1);
        const cached = await env.probe({ command: 'cache_get', record: env.record() }), saved = await env.player();
        assert.equal(cached.revision, old.revision); assert.ok(saved.revision > cached.revision);
        const errors = text => Number(text.match(/^dbproxy_cache_write_errors_total (\d+)$/m)?.[1] ?? NaN);
        await until(async () => errors(await env.metrics()) > errors(before), 'cache failure observed', 5000);
        await evidence({ type: 'cache-timeout-proof', old, cached, saved });
      } finally { await env.redis('CLIENT', 'UNPAUSE'); }
    } else if (kind === 'cache-stop') {
      await env.service('stop', 'cache');
      try { await transact('bob', 'recruit', 0, 1); } finally { await env.service('start', 'cache'); }
    } else if (kind === 'node-kill') {
      await env.service('kill', 'dbproxy-a');
      try { await transact('income', 'recruit', 0, 1); } finally { await env.service('start', 'dbproxy-a'); await env.ready(0); }
    } else if (kind === 'pg-stop') {
      await env.service('stop', 'postgres');
      try { await assert.rejects(env.probe({ command: 'read', record: env.record() }), { code: 3001 }); await env.wait(5000); }
      finally { await env.service('start', 'postgres'); await env.ready(0); await env.ready(1); }
    } else {
      const before = await env.rows(); await env.restartPair(pair);
      for (const player of players) { const view = await snapshot(player); assertPlayer(before.find(r => r.key === env.record(player).key).value, view); }
    }
    const restored = Date.now();
    await until(async () => Number(await env.sql('SELECT count(*) FROM dbproxy_cache_repairs')) === 0, 'soak repair convergence', report.thresholds.recoveryMs);
    const rows = await reconcile(); report.counts.faults++;
    await evidence({ type: 'fault-recovered', kind, elapsedMs: Date.now() - began, convergenceMs: Date.now() - restored, rows });
  };
  await reconcile();
  await until(async () => { try { resourceSample(await env.gameMetrics()); return true; } catch { return false; } }, 'initial game metrics', 10000);
  if (sampling) {
    // 真实建筑任务制造非空闲样本；不篡改时钟、指标或存档。 / A real building task creates a busy sample without changing clocks, metrics or saves.
    await transact('alice', 'upgrade-building', 1);
    let busy;
    await until(async () => { busy = resourceSample(await env.gameMetrics()); return busy.deadlines > 0; }, 'real busy resource sample', 8000);
    report.busySampleProof = busy; await evidence({ type: 'sampling-busy-proof', sample: busy });
  }
  await save();
  while (Date.now() < end) {
    if (env.cancelled()) throw Error('operator cancelled');
    const now = Date.now(), elapsed = now - start, phase = sampling ? (now < recoveryEnd ? 'recovery' : 'drain') : smoke ? 'smoke' : soakPhase(elapsed, threeHour); report.phase = phase;
    if (!smoke && now >= recoveryEnd && !report.recoveryValidated) {
      const recovery = windows.filter(w => w.phase === 'recovery');
      requireRecoverySamples(recovery); assertGrowth(recovery[0], recovery.slice(1));
      report.recoveryValidated = true; report.resourceWindows = recovery; await save();
    }
    for (const player of players) await snapshot(player);
    if (now >= nextCommand && phase !== 'drain') {
      for (const player of players) await transact(player, 'recruit', 0, 1);
      nextCommand = now + 60000;
    }
    if (now >= nextDraw && phase !== 'drain') { for (const player of players) await transact(player, 'draw-hero'); nextDraw = now + 15 * 60000; }
    if (now >= nextMarch && phase !== 'drain') { await transact('alice', 'march', 4, 1); nextMarch = now + 15 * 60000; }
    if (now >= nextBuild && phase !== 'drain') {
      for (const player of players) {
        const view = previous.get(player), task = view.buildings.find(b => b.level < 5 && !b.dueAt);
        if (task && view.food > task.level * view.fixtureCost + 1000) await transact(player, 'upgrade-building', task.id);
      }
      nextBuild = now + 30 * 60000;
    }
    if (now >= nextHotfix && (phase === 'hotfix' || (smoke && !hotfixIndex))) {
      const candidates = ['P22', 'P21', 'bad-config', 'rollback', 'P12', 'bad-hash', 'P11', 'bad-evaluation'];
      const candidate = candidates[hotfixIndex++ % candidates.length], before = (await env.admin('status')).hotfix;
      let result;
      if (candidate === 'rollback') { result = await env.admin('rollback', { operationId: 'soak-rollback-' + now }); [pair, previousPair] = [previousPair, pair]; }
      else { result = await env.applyPair(candidate, candidate.startsWith('bad-') ? 422 : 200); if (!candidate.startsWith('bad-')) { previousPair = pair; pair = candidate; } }
      const after = (await env.admin('status')).hotfix;
      assert.equal(candidate.startsWith('bad-') ? after.generation === before.generation : after.generation > before.generation, true);
      await reconcile(); report.counts.hotfix++; await evidence({ type: 'hotfix', candidate, pair, before, after, result }); nextHotfix = now + (threeHour ? 5 : 15) * 60000;
    }
    if (faultIndex < 5 && now >= nextFault && (phase === 'faults' || (smoke && !faultIndex))) {
      await fault(['cache-pause', 'cache-stop', 'node-kill', 'pg-stop', 'game-restart'][faultIndex++]); nextFault = now + (smoke ? duration : (threeHour ? 8 : 25) * 60000);
    }
    if (now >= nextReconnect) { env.disconnectClients(); for (const player of players) await snapshot(player); nextReconnect = now + 10 * 60000; }
    if (now >= nextSample) {
      const rows = await reconcile();
      let text = await env.gameMetrics(), sample = resourceSample(text);
      if (phase === 'baseline' || phase === 'recovery') {
        const settled = await settledResourceSample({
          read: async () => { const text = await env.gameMetrics(); return { text, sample: resourceSample(text), publishedAt: metric(text, 'tiangz_process_metrics_timestamp_ms') }; },
          wait: ms => env.wait(ms),
          observe: value => evidence({ type: 'resource-settling', phase, ...value }),
          timeoutMs: Math.min(60000, (phase === 'recovery' ? recoveryEnd : end) - Date.now()),
        });
        ({ text, sample } = settled);
        windows.push({ ...sample, pid: env.game.child.pid, phase });
      }
      const repairs = Number(await env.sql('SELECT count(*) FROM dbproxy_cache_repairs'));
      assert.equal(repairs, 0, 'repair backlog between faults');
      const disk = await statfs(env.directory); assert.ok(disk.bavail * disk.bsize > report.thresholds.minDiskFreeBytes, 'disk reserve exhausted');
      for (let i = 1; i <= env.processes.length; i++) { const file = await stat(path.join(env.directory, `game-${i}.log`)); assert.ok(file.size < 256 * 1024 ** 2, 'game log exceeded budget'); }
      const resources = await env.resources();
      await evidence({ type: 'sample', phase, rows, sample, resources, text, counts: report.counts });
      // 原始帧分批落盘后释放观察器缓冲，不清理服务状态。 / Flush raw frames before releasing observer buffers; never clear service state.
      for (const proxy of env.proxies) await evidence({ type: 'db-frames', events: proxy.events.splice(0) });
      for (const client of env.clientHistory) await evidence({ type: 'client-frames', events: client.events?.splice(0) ?? [] });
      report.lastSampleAt = new Date().toISOString(); report.latestSample = sample; report.evidenceBytes = evidenceBytes;
      // 按固定时间表推进；错过的时隙不能靠连续重复读同一指标补数。 / Keep fixed slots; missed slots cannot be replaced by repeated reads of one publication.
      do { nextSample += sampleInterval; } while (nextSample <= Date.now());
      if (!smoke && Date.now() >= recoveryStart && Date.now() < recoveryEnd) {
        report.recoverySampling = samplingProgress(windows.filter(w => w.phase === 'recovery').length, 20, nextSample, recoveryEnd, sampleInterval);
      }
      report.lastProgressAt = new Date().toISOString(); await save();
      console.log(JSON.stringify({ at: report.lastSampleAt, phase, counts: report.counts, status: 'running' }));
    }
    await env.wait(Math.min(10000, Math.max(0, end - Date.now()), Math.max(0, nextSample - Date.now())));
  }
  await until(async () => Number(await env.sql('SELECT count(*) FROM dbproxy_cache_repairs')) === 0, 'final repair convergence', 60000);
  report.finalRows = await reconcile();
  report.measurementFinishedAt = new Date().toISOString(); report.elapsedMs = Date.now() - start;
  if (!smoke && !sampling) {
    assert.ok(report.counts.accepted >= (threeHour ? 450 : 1200), 'insufficient business activity'); assert.equal(report.counts.faults, 5); assert.ok(report.counts.hotfix >= 12);
  }
  if (!smoke) assert.equal(report.recoveryValidated, true, 'recovery gate must run before final drain');
  // 八小时结束后做冷恢复对账，收尾时间不冒充运行时长。 / Reconcile a cold recovery after the full duration; cleanup is not part of the measured run.
  await env.restartPair(pair);
  for (const player of players) { const view = await snapshot(player); assertPlayer(report.finalRows.find(r => r.key === env.record(player).key).value, view); }
  report.coldRecoveryFinishedAt = new Date().toISOString(); report.finalPair = pair;
  await evidence({ type: 'completed', counts: report.counts, elapsedMs: report.elapsedMs });
}
