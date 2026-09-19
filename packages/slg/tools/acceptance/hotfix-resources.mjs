import assert from 'node:assert/strict';
import { appendFile } from 'node:fs/promises';
import path from 'node:path';
import { assertIncome } from './assertions.mjs';

/** 按指标及标签取值；缺指标不能按零处理。 / Select by metric and labels; missing metrics are never zero. */
export function metric(text, name, labels = {}) {
  const values = [];
  for (const line of text.split('\n')) {
    if (!line.startsWith(name + '{') && !line.startsWith(name + ' ')) continue;
    const match = line.match(/^([^ {]+)(?:\{(.*)\})?\s+([-+0-9.eE]+)$/);
    if (!match) continue;
    const actual = Object.fromEntries([...((match[2] ?? '').matchAll(/([a-zA-Z_][a-zA-Z0-9_]*)="((?:[^"\\]|\\.)*)"/g))].map(m => [m[1], JSON.parse('"' + m[2] + '"')]));
    if (Object.entries(labels).every(([key, value]) => actual[key] === value)) values.push(Number(match[3]));
  }
  if (!values.length || values.some(v => !Number.isFinite(v))) throw Object.assign(Error('missing or invalid metric: ' + name + ' ' + JSON.stringify(labels)), { acceptanceStatus: 'not-effective' });
  return values.reduce((a, b) => a + b, 0);
}
export function resourceSample(text, at = Date.now()) {
  const custom = key => metric(text, 'tiangz_scene_custom_metric_gauge', { name: 'slg_fixture', key });
  return { at, rss: metric(text, 'tiangz_process_rss_bytes'), heap: metric(text, 'tiangz_process_v8_heap_used_bytes'),
    timers: metric(text, 'tiangz_game_timers_total'), pending: custom('pending'), playerTimers: custom('timers'),
    residents: custom('residents'), deadlines: custom('deadlines'),
    ingress: metric(text, 'tiangz_scene_ingress_queue_length'), mailbox: metric(text, 'tiangz_scene_mailbox_queued_depth'),
    frameQueue: metric(text, 'tiangz_process_queue_stage_depth', { stage: 'frame' }),
    outbound: metric(text, 'tiangz_scene_custom_metric_gauge', { name: 'outbound_lanes', key: 'outbound_total_depth' }) };
}
export function idle(sample) {
  return sample.pending === 0 && sample.deadlines === 0 && sample.residents === 3 && sample.playerTimers === 3
    && sample.ingress === 0 && sample.mailbox === 0 && sample.frameQueue === 0 && sample.outbound === 0;
}
const median = values => { const ordered = [...values].sort((a, b) => a - b); return (ordered[Math.floor((ordered.length - 1) / 2)] + ordered[Math.floor(ordered.length / 2)]) / 2; };
export function windowSummary(samples, start, durationMs) {
  const selected = samples.filter(s => s.at >= start && s.at < start + durationMs);
  assert.ok(selected.length >= Math.floor(durationMs / 1000) - 2, 'stable window sampling incomplete');
  for (let i = 1; i < selected.length; i++) assert.ok(selected[i].at - selected[i - 1].at <= 2500, 'sampling interrupted');
  assert.ok(selected.every(idle), 'stable window has unexplained tasks or queues');
  assert.ok(selected.every(s => s.heap > 0 && s.rss > 0 && s.timers >= 3));
  return { start, durationMs, count: selected.length, heap: median(selected.map(s => s.heap)), rss: median(selected.map(s => s.rss)), timers: Math.max(...selected.map(s => s.timers)) };
}
export function assertGrowth(baseline, windows) {
  assert.ok(windows.length >= 10);
  for (const field of ['heap', 'rss']) {
    for (const window of windows) assert.ok(window[field] - baseline[field] <= Math.max(64 * 1024 ** 2, baseline[field] * 0.25), field + ' exceeds baseline growth allowance');
    const last = windows.slice(-5);
    assert.ok(!(last.every((w, i) => i === 0 || w[field] > last[i - 1][field]) && last.at(-1)[field] - last[0][field] > 16 * 1024 ** 2), field + ' has sustained growth');
  }
  for (const window of windows) assert.equal(window.timers, baseline.timers, 'unexplained global Timer growth');
}

/** 同进程持续采样；不以重启清理资源增长。 / Sample one process continuously; never hide growth with restarts. */
export async function resourceRun(env, helpers) {
  // 就绪探针早于周期指标发布，采样前等待完整首帧。 / Readiness precedes periodic metrics; wait for the first complete snapshot before sampling.
  const readyDeadline = Date.now() + 10000;
  while (true) {
    try { resourceSample(await env.gameMetrics()); break; }
    catch (error) { if (Date.now() >= readyDeadline) throw error; await env.wait(100); }
  }
  const pid = env.game.child.pid, client = env.client, connectionStates = env.client.states.length, samples = [], windows = [], steps = [], warmups = [];
  const raw = path.join(env.directory, 'resource-metrics.jsonl');
  env.events.push({ action: 'resource-sampling', raw });
  let running = true, sampleError;
  const sampling = (async () => {
    try {
      while (running) {
        const at = Date.now(), text = await env.gameMetrics();
        const sample = resourceSample(text, at); samples.push(sample);
        if (samples.length > 1800) throw Error('H8 sample bound exceeded');
        await appendFile(raw, JSON.stringify({ at, text }) + '\n');
        await env.wait(Math.max(0, 1000 - (Date.now() - at)));
      }
    } catch (error) { sampleError = error; }
  })();
  const wait = async ms => { const until = Date.now() + ms; while (Date.now() < until) { if (sampleError) throw sampleError; await env.wait(Math.min(250, until - Date.now())); } };
  const stable = async duration => {
    const drainStart = Date.now(), deadline = drainStart + 10000;
    while ((!samples.length || samples.at(-1).at < drainStart || !idle(samples.at(-1))) && Date.now() < deadline) await wait(100);
    assert.ok(samples.length && samples.at(-1).at >= drainStart && idle(samples.at(-1)), 'resources must drain within ten seconds');
    const start = Date.now(); await wait(duration);
    return windowSummary(samples, start, duration);
  };
  const business = async (name, task) => {
    for (const player of ['alice', 'bob', 'income']) await env.call(player);
    const before = await env.call(), response = await env.call('alice', before.sequence + 1, 'recruit', 0, 1);
    helpers.assertPair(response, name); assert.equal(response.receipt.accepted, true); assertIncome(before, response, 10);
    let building;
    if (task) {
      building = await helpers.building(env, 'bob', 1, name);
      await wait(Math.max(0, building.task.dueAt - Date.now()) + 100);
    }
    return { response, building };
  };
  try {
    for (const name of ['P22', 'P11']) {
      await env.applyPair(name); await helpers.active(env, name);
      const command = await business(name, false); const window = await stable(30000); warmups.push({ name, command, window });
    }
    const baseline = warmups.at(-1).window;
    const sequence = [
      ['P22', 'P22'], ['rollback', 'P11'], ['bad-config', 'P11'], ['P21', 'P21'], ['P12', 'P12'],
      ['bad-hash', 'P12'], ['P22', 'P22'], ['rollback', 'P12'], ['bad-evaluation', 'P12'], ['P22', 'P22'],
    ];
    for (const [index, [candidate, expected]] of sequence.entries()) {
      const previous = (await env.admin('status')).hotfix;
      const result = candidate === 'rollback' ? await helpers.rollback(env) : await env.applyPair(candidate, candidate.startsWith('bad-') ? 422 : 200);
      const current = await helpers.active(env, expected);
      assert.equal(candidate.startsWith('bad-') ? current.current.generation === previous.generation : current.current.generation > previous.generation, true);
      const command = await business(expected, [2, 5, 8].includes(index));
      const window = await stable(75000); windows.push(window); steps.push({ candidate, expected, result, command, window });
      assert.equal(env.game.child.pid, pid); assert.equal(env.client, client); assert.equal(client.states.length, connectionStates);
    }
    // 最后观察前刷新合法驻留期限，不引入新任务。 / Refresh residency before the final idle window without adding tasks.
    for (const player of ['alice', 'bob', 'income']) await env.call(player);
    const finalWindow = await stable(90000); assertGrowth(baseline, [...windows, finalWindow]);
    return { pid, warmups, baseline, steps, finalWindow, frameworkTimers: baseline.timers - 3,
      sampleIntervalMs: 1000, stableWindowMs: 75000, samples, raw, status: 'passed' };
  } finally { running = false; await sampling; if (sampleError) throw sampleError; }
}
