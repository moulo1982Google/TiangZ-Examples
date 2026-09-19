import assert from 'node:assert/strict';
import { resourceRun, metric } from './hotfix-resources.mjs';
import { until } from './environment.mjs';
import { assertIncome, assertPlayer, assertReceipt } from './assertions.mjs';

export function assertPair(view, name) {
  assert.deepEqual([view.fixtureCode, view.fixtureConfig], [Number(name[1]), Number(name[2])], 'mixed code/config pair');
  assert.equal(view.fixtureCost, name[2] === '1' ? 200 : 240);
  assert.equal(view.fixtureDuration, name[2] === '1' ? 10000 : 12000);
  assert.match(view.fixtureConfigHash, /^[a-f0-9]{64}$/);
}
export function ineffective(message) { return Object.assign(Error(message), { acceptanceStatus: 'not-effective' }); }
/** 协议生成物也参与Model包哈希；核对真实变化及首先触发的拒绝字段。 / Generated protocol code also changes the Model bundle hash; verify the actual change and first rejected contract field. */
export function assertProtocolRejection(active, candidate, error) {
  assert.notEqual(candidate.protocolFingerprint, active.protocolFingerprint, 'candidate must actually change the protocol');
  const field = candidate.modelFingerprint !== active.modelFingerprint ? 'modelFingerprint' : 'protocolFingerprint';
  assert.ok(error.includes(`Hotfix cannot change ${field}: active Model=${active[field]}, candidate Hotfix=${candidate[field]};`), 'must reject the actual incompatible contract');
}
function commitTouches(request, record) {
  const writes = request?.records ?? request?.writes;
  return writes?.some(write => {
    const value = write.record ?? write;
    return value.namespace === record.namespace && value.key === record.key;
  }) ?? false;
}
async function status(env) { return (await env.admin('status')).hotfix; }
async function active(env, name) {
  const current = await status(env);
  assert.equal(current.bundleVersion, env.artifacts.hotfix.identities[name].bundleVersion);
  const view = await env.call(); assertPair(view, name); assert.equal(view.fixtureConfigHash, env.artifacts.hotfix.configFingerprints[name]); return { current, view };
}
async function rollback(env) { return env.admin('rollback', { operationId: 'rollback-' + Date.now() }); }
function sameConnection(env, pid, client, states) {
  assert.equal(env.game.child.pid, pid); assert.equal(env.client, client);
  assert.equal(client.states.length, states, 'hotfix must preserve the established connection');
}
async function building(env, player, target, name) {
  const before = await env.call(player), start = Date.now();
  const after = await env.call(player, before.sequence + 1, 'upgrade-building', target);
  assertPair(after, name); assert.equal(after.receipt.accepted, true);
  const old = before.buildings.find(b => b.id === target), task = after.buildings.find(b => b.id === target);
  assertIncome(before, after, old.level * after.fixtureCost);
  assert.ok(task.dueAt >= start + old.level * after.fixtureDuration);
  assert.ok(task.dueAt <= after.serverTime + old.level * after.fixtureDuration);
  return { before, after, task };
}
async function replay(env, request, expected) {
  const after = await env.call(...request);
  assertReceipt(after.receipt, expected.receipt); assertIncome(expected, after);
  assert.deepEqual(after.heroes, expected.heroes); assert.equal(after.troops, expected.troops);
  assert.equal(after.sequence, expected.sequence); return after;
}
async function rejected(env, name) {
  const before = await active(env, 'P11'), result = await env.applyPair(name, 422), after = await active(env, 'P11');
  const reasons = { 'bad-config': /isolated SLG rules validation failed/, 'bad-evaluation': /isolated candidate evaluation failure/, 'bad-hash': /hash|integrity|完整|哈希/i, 'bad-model': /model/i, 'bad-protocol': /protocol/i, 'bad-cold': /model/i, 'bad-schema': /schema|model/i, 'bad-commit': /FixtureCommitGuard/ };
  if (name === 'bad-protocol') assertProtocolRejection(before.current.modelContract, env.artifacts.hotfix.identities[name], result.error);
  else assert.match(JSON.stringify(result), reasons[name], 'must reject for the intended fault');
  assert.equal(after.current.generation, before.current.generation);
  assertIncome(before.view, after.view);
  const command = await env.call('alice', 1, 'recruit', 0, 1); assert.equal(command.receipt.accepted, true); assertPair(command, 'P11');
  return { before, result, after, command };
}

/** 扣包必须命中真实提交；失败时仍放行并收尾。 / Hold an actual commit and always release and settle on failure. */
async function drain(env, { direction = 'response', success = false, prepare, publishing, paused, observe = true, client = env.client, clientFailure } = {}) {
  const before = await status(env), sequence = (await env.call()).sequence + 1;
  if (prepare) await prepare();
  const request = ['alice', sequence, 'draw-hero', 0, 0];
  // 正式DBProxy解码字段是 writes，旧JSON夹具字段才是 records。 / The official DBProxy decoder uses writes; records belongs to the legacy JSON fixture.
  for (const proxy of env.proxies) proxy.arm(direction, req => req?.kind === 'commit' && commitTouches(req, env.record()));
  let settled = false;
  const pending = env.call(...request, client); pending.finally(() => { settled = true; }).catch(() => {});
  let publication;
  try {
    let hit;
    await until(() => (hit = env.proxies.map(p => p.hit()).find(Boolean)), 'held business commit', 2000);
    if (direction === 'response') assert.equal(hit.event.error, null);
    const row = await env.player();
    assert.equal(row.value.sequence, direction === 'response' ? sequence : sequence - 1);
    const marker = env.lifecycleEvents.length;
    const publicationStarted = Date.now();
    publication = env.applyPair('P22', success ? 200 : 422); publication.catch(() => {}); publishing?.();
    let pause;
    await until(() => (pause = env.lifecycleEvents.slice(marker).find(e => /pause started/.test(e.line))), 'real ingress pause start', 2000);
    assert.equal(settled, false, 'original RPC must still be in flight');
    if (paused) await paused(pause);
    if (success) env.proxies.forEach(p => p.release());
    const result = await publication;
    const end = env.lifecycleEvents.slice(marker).find(e => /pause aborted/.test(e.line));
    if (!success) {
      if (!end || (!clientFailure && settled) || end.at - hit.event.at >= 4800) throw ineffective('DB timeout or missing pause/abort evidence invalidates drain test');
      assert.ok(end.monotonic - pause.monotonic >= 2500, 'must exhaust drain budget');
      assert.match(JSON.stringify(result), /timeout|timed.out|drain|排空/i);
    }
    env.proxies.forEach(p => p.release());
    if (clientFailure) {
      await assert.rejects(pending, clientFailure);
      const restored = await env.call(...request);
      assertPlayer(row.value, restored);
      const after = await active(env, 'P11'); assert.equal(after.current.generation, before.generation);
      return { before, hit, pause, end, result, committedWhileHeld: row, restored, replay: await replay(env, request, restored) };
    }
    const original = await pending; assertPair(original, 'P11');
    assert.equal(original.receipt.accepted, true);
    const after = observe ? await active(env, success ? 'P22' : 'P11') : { current: await status(env) };
    assert.equal(success ? after.current.generation > before.generation : after.current.generation === before.generation, true);
    return { before, hit, pause, end, publicationStarted, result, committedWhileHeld: row, original, replay: observe ? await replay(env, request, original) : undefined, after };
  } finally {
    env.proxies.forEach(p => p.release());
    await Promise.allSettled([pending, publication].filter(Boolean));
  }
}

/** 不改变时钟或存档，安排自然到期窗口。 / Arrange natural deadlines without changing clocks or saves. */
async function timerWindow(env, success) {
  const initial = await env.call();
  const boundary = initial.nextProductionAt;
  await env.wait(Math.max(0, boundary - Date.now() - 10200));
  const build = await building(env, 'alice', 1, 'P11');
  const march = await env.call('alice', 2, 'march', 2, 1);
  const due = [build.task.dueAt, march.marches[0].dueAt, boundary];
  let pause, releaseAt;
  const result = await drain(env, {
    success, observe: false,
    prepare: () => env.wait(Math.max(0, Math.min(...due) - Date.now() - 1100)),
    paused: async event => {
      pause = event;
      if (Math.min(...due) <= event.at || Math.max(...due) >= event.at + 2300) throw ineffective('natural deadline did not fit the pause window');
      if (success) { await env.wait(Math.max(...due) - Date.now() + 100); releaseAt = Date.now(); }
    },
  });
  const end = success ? releaseAt : result.end.at;
  if (!due.every(t => t > pause.at && t < end)) throw ineffective('deadline or minute boundary outside verified pause');
  // 恢复后先读SQL，不用玩家请求驱动定时器。 / Observe timer settlement in SQL before player requests.
  let saved;
  await until(async () => { saved = await env.player(); return saved.value.buildings[0].level === 2 && saved.value.march === null; }, 'timer settlements', 10000);
  assert.equal(saved.value.troops, 98); assertReceipt(saved.value.receipt, result.original.receipt);
  assertIncome(initial, saved.value, 200 + 100 + 300);
  const recovered = await env.call(); assertPlayer(saved.value, recovered);
  const retry = await replay(env, ['alice', 3, 'draw-hero', 0, 0], recovered);
  const rows = await env.rows(); assert.equal(rows.find(r => r.namespace === 'slg.demo.world.v1').value.tiles.find(t => t.id === 2).owner, 'alice');
  return { ...result, build, march, due, saved, rows, recovered, retry, releaseAt };
}

export const hotfixScenarios = {
  async H1(env) {
    const pid = env.game.child.pid, client = env.client, states = client.states.length;
    const old = await building(env, 'alice', 1, 'P11');
    let running = true; const samples = [];
    const load = (async () => { while (running) { const view = await env.call('bob'); const pair = 'P' + view.fixtureCode + view.fixtureConfig; assert.ok(['P11', 'P22'].includes(pair)); assertPair(view, pair); assert.equal(view.fixtureConfigHash, env.artifacts.hotfix.configFingerprints[pair]); samples.push(view); await env.wait(20); } })();
    load.catch(() => {});
    let result; try { result = await env.applyPair('P22'); } finally { running = false; await load; }
    const current = await active(env, 'P22');
    const task = current.view.buildings.find(b => b.id === 1);
    if (Date.now() < old.task.dueAt) assert.equal(task.dueAt, old.task.dueAt);
    else assert.equal(task.level, 2);
    const fresh = await building(env, 'bob', 1, 'P22');
    sameConnection(env, pid, client, states); assert.ok(samples.length);
    return { old, result, current, fresh, samples };
  },
  async H2a(env) { const before = await active(env, 'P11'); await env.applyPair('P21'); const after = await active(env, 'P21'); assert.equal(before.view.fixtureConfigHash, after.view.fixtureConfigHash); assert.notEqual(before.current.bundleVersion, after.current.bundleVersion); return { before, after, task: await building(env, 'alice', 1, 'P21') }; },
  async H2b(env) { const before = await active(env, 'P11'); await env.applyPair('P12'); const after = await active(env, 'P12'); assert.notEqual(before.view.fixtureConfigHash, after.view.fixtureConfigHash); return { before, after, task: await building(env, 'alice', 1, 'P12') }; },
  async H3(env) {
    const client = env.client, pid = env.game.child.pid, states = client.states.length;
    let queued, finished = false, loading = true, load; const samples = [];
    let result;
    try {
      result = await drain(env, {
        success: true,
        prepare: async () => {
          // 保持四条有界只读请求链，避免单请求往返跨过短准备窗口；仍要求客户端实际收到暂停前回包。 / Keep four bounded read-only chains so one round trip cannot consume the short preparation window; still require an actual client response before pause.
          load = Promise.all(Array.from({ length: 4 }, async () => {
            while (loading) {
              const sentAt = Date.now(), view = await env.call('bob'); samples.push({ sentAt, at: Date.now(), view });
              assert.ok(samples.length <= 2000, 'normal traffic evidence bound exceeded');
            }
          }));
          load.catch(() => {});
          await until(() => samples.length >= 4, 'preparation traffic started', 2000);
        },
        paused: async () => {
          loading = false;
          queued = env.call('income', 1, 'recruit', 0, 1); queued.then(() => { finished = true; }, () => {});
          await env.wait(150); assert.equal(finished, false, 'new ingress must wait during pause');
        },
      });
    } finally { loading = false; if (load) await load; }
    const response = await queued; assertPair(response, 'P22'); assert.equal(response.receipt.accepted, true);
    sameConnection(env, pid, client, states);
    env.events.push({ action: 'preparation-traffic', concurrency: 4, publicationStarted: result.publicationStarted, pause: result.pause, samples });
    if (!samples.some(s => s.at >= result.publicationStarted && s.at < result.pause.at)) throw ineffective('preparation finished before a business response was observed');
    return { ...result, preparationTraffic: samples, queuedResponse: response };
  },
  H4: env => drain(env),
  H5a: env => rejected(env, 'bad-config'),
  H5b: env => rejected(env, 'bad-evaluation'),
  H5c: env => rejected(env, 'bad-hash'),
  async H5d(env) {
    const rejectedCandidate = await rejected(env, 'bad-commit');
    const next = await env.applyPair('P22'), current = await active(env, 'P22');
    return { rejectedCandidate, next, current, task: await building(env, 'bob', 1, 'P22') };
  },
  H8: env => resourceRun(env, { active, rollback, building, assertPair }),
  async 'H3-F1'(env) {
    const original = env.client;
    const result = await drain(env, { clientFailure: /closed|关闭/i, paused: async () => {
      original.close(); env.client = env.connectClient(); await env.wait(150);
    } });
    assert.notEqual(env.client, original); assert.ok(original.states.some(s => s.state === 'closed')); return result;
  },
  async 'H3-F3'(env) {
    const short = env.connectClient(1800);
    return drain(env, { client: short, clientFailure: /timeout|timed out|超时/i, paused: () => env.wait(2000) });
  },
  async 'H3-F2'(env) {
    // 沿用默认4096容量，控制队列保留四分之一；只发有限快照。 / Keep the default capacity and reserve; send a bounded snapshot burst only.
    assert.equal(env.config.process.scheduling?.eventQueueCapacity ?? 4096, 4096);
    const burst = env.connectClient(1200); await burst.socket.connect();
    let before, requests = [], evidence;
    // 进程指标按周期发布；必须等首个完整帧队列样本，不能把缺失当零。 / Metrics publish periodically; await the first complete frame-queue sample rather than treating absence as zero.
    await until(async () => {
      before = await env.gameMetrics();
      try { metric(before, 'tiangz_process_queue_stage_backpressure_waits_total', { stage: 'frame' }); return true; } catch { return false; }
    }, 'initial frame queue metrics', 5000);
    try {
      const result = await drain(env, { paused: async () => {
        requests = Array.from({ length: 4096 }, () => burst.game({ player: 'bob', sequence: 0, action: 'snapshot', target: 0, amount: 0 }));
        for (const request of requests) request.catch(() => {});
        await env.wait(1700); evidence = await env.gameMetrics();
        env.events.push({ action: 'saturation-metrics', before, evidence });
      } });
      const outcomes = await Promise.allSettled(requests);
      const errors = outcomes.filter(x => x.status === 'rejected').map(x => String(x.reason));
      // 峰值及背压指标会延迟发布，恢复后有界等待累计值刷新，不重复加压。 / Peak and backpressure counters publish asynchronously; await their refresh after recovery without another burst.
      try {
        await until(async () => {
          evidence = await env.gameMetrics();
          return metric(evidence, 'tiangz_process_queue_stage_max_depth', { stage: 'frame' }) >= 3072
            && metric(evidence, 'tiangz_process_queue_stage_backpressure_waits_total', { stage: 'frame' }) > metric(before, 'tiangz_process_queue_stage_backpressure_waits_total', { stage: 'frame' });
        }, 'published saturation metrics', 10000);
      } finally { env.events.push({ action: 'saturation-final-metrics', evidence, errors: errors.length }); }
      if (metric(evidence, 'tiangz_process_queue_stage_max_depth', { stage: 'frame' }) < 3072
          || metric(evidence, 'tiangz_process_queue_stage_backpressure_waits_total', { stage: 'frame' }) <= metric(before, 'tiangz_process_queue_stage_backpressure_waits_total', { stage: 'frame' })
          || !errors.some(e => /timeout|closed|超时|关闭/i.test(e))) throw ineffective('bounded burst did not prove queue saturation and explicit client failure');
      assert.equal(outcomes.length, 4096);
      return { ...result, queue: { capacity: 4096, dataCapacity: 3072, requests: 4096, clientTimeoutMs: 1200 }, before, evidence, errors, successes: outcomes.length - errors.length };
    } finally { burst.close(); await Promise.allSettled(requests); }
  },
  async H6(env) {
    await env.applyPair('P22'); const task = await building(env, 'alice', 1, 'P22'), before = await status(env);
    const result = await rollback(env), after = await active(env, 'P11'); assert.ok(after.current.generation > before.generation);
    const retry = await replay(env, ['alice', 1, 'upgrade-building', 1, 0], task.after);
    assert.equal(retry.buildings[0].dueAt, task.task.dueAt);
    return { task, result, after, retry, fresh: await building(env, 'bob', 1, 'P11') };
  },
  H7a: env => timerWindow(env, true),
  H7b: env => timerWindow(env, false),
  H9a: env => rejected(env, 'bad-model'), H9b: env => rejected(env, 'bad-protocol'),
  H9c: env => rejected(env, 'bad-cold'), H9d: env => rejected(env, 'bad-schema'),
  J1a: env => drain(env), J1b: env => drain(env, { direction: 'request' }),
  async J2(env) {
    await env.applyPair('P22'); const task = await building(env, 'alice', 1, 'P22'), saved = await env.player(), pid = env.game.child.pid;
    assert.ok(Date.now() < task.task.dueAt, 'must crash with a pending task');
    await env.restartPair('P22'); assert.notEqual(env.game.child.pid, pid);
    const recovered = await active(env, 'P22'); assertPlayer(saved.value, recovered.view);
    await env.wait(Math.max(0, task.task.dueAt - Date.now() + 200));
    let settled; await until(async () => { settled = await env.player(); return settled.value.buildings[0].level === 2; }, 'recovered timer', 10000);
    assert.equal(settled.value.buildings[0].dueAt, 0); assertIncome(saved.value, settled.value);
    assertReceipt(settled.value.receipt, task.after.receipt);
    return { task, saved, recovered, settled, startup: env.artifacts.hotfix.identities.P22 };
  },
  J3a: env => rollbackUnknown(env, true), J3b: env => rollbackUnknown(env, false),
};

async function rollbackUnknown(env, committed) {
  await env.applyPair('P22'); const before = await env.player(), client = env.client;
  client.arm(committed ? 'response' : 'request', req => req?.player === 'alice' && req.sequence === 1);
  const pending = env.call('alice', 1, 'upgrade-building', 1); pending.catch(() => {});
  try {
    await until(() => client.hit(), 'held game frame', 3000);
    const held = client.hit(), saved = await env.player();
    assert.equal(saved.value.sequence, committed ? 1 : 0);
    if (committed) { assert.equal(held.value.error ?? 0, 0); assertPair(held.value, 'P22'); assertReceipt(saved.value.receipt, held.value.receipt); }
    else assert.deepEqual(saved, before);
    const result = await rollback(env);
    let warm;
    if (committed) {
      const other = env.connectClient(); warm = await env.call('alice', 1, 'upgrade-building', 1, 0, other);
      assertReceipt(warm.receipt, held.value.receipt); assertIncome(held.value, warm);
    }
    await env.restartPair('P11'); await Promise.allSettled([pending]);
    const response = await env.call('alice', 1, 'upgrade-building', 1); assertPair(response, 'P11');
    if (committed) { assertPlayer(saved.value, response); assert.equal(response.buildings[0].dueAt, saved.value.buildings[0].dueAt); }
    else { assert.equal(response.receipt.accepted, true); assertIncome(before.value, response, 200); }
    const retry = await replay(env, ['alice', 1, 'upgrade-building', 1, 0], response);
    return { before, held, saved, result, warm, response, retry, startup: env.artifacts.hotfix.identities.P11 };
  } finally { client.close(); await Promise.allSettled([pending]); }
}
