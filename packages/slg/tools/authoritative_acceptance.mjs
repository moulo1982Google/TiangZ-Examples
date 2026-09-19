import assert from 'node:assert/strict';
import { access, cp, mkdir, mkdtemp, readFile, writeFile, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { parse, cases, pendingCoverage } from './acceptance/plan.mjs';
import { Environment, command, root, engine, dbRoot, executable, sourceState, hash, until } from './acceptance/environment.mjs';
import { scenarios } from './acceptance/scenarios.mjs';
import { hotfixScenarios, assertPair } from './acceptance/hotfix-scenarios.mjs';
import { buildHotfix } from './acceptance/hotfix-build.mjs';
import { assertIncome } from './acceptance/assertions.mjs';

const options = parse(process.argv.slice(2));
if (options.action === 'plan') {
  console.log(JSON.stringify({ ...options, cases: options.selected.map(id => ({ id, name: cases[id] })),
    evidence: 'temp/authoritative-acceptance/run-*/report.json', note: 'C delegates to the strengthened seven-case recovery script; D5 old-server side is a handshake simulator' }, null, 2));
  process.exit(0);
}
const base = path.join(root, 'temp/authoritative-acceptance');
const manifestPath = path.join(base, 'build.json');
const nativeEnv = { ...process.env };
if (process.platform === 'win32') for (const key of ['CC', 'CXX']) if (/(gcc|g\+\+)(\.exe)?$/i.test(nativeEnv[key] ?? '')) delete nativeEnv[key];

if (options.action === 'build-hotfix') {
  await mkdir(base, { recursive: true });
  const directory = await mkdtemp(path.join(base, 'hotfix-'));
  const hotfix = await buildHotfix(directory, nativeEnv);
  await writeFile(path.join(directory, 'build.json'), JSON.stringify(hotfix, null, 2));
  console.log(JSON.stringify({ status: 'built-not-tested', directory })); process.exit(0);
}

/** 只使用正式生成器；短TTL修改发生在独立源码副本。 / Use official generators; short TTL modifies only a separate source copy. */
if (options.action === 'build') {
  await mkdir(base, { recursive: true });
  const buildDir = await mkdtemp(path.join(base, 'build-'));
  await command(process.execPath, ['tools/workspace.mjs', 'build'], { cwd: root, env: nativeEnv, timeout: 1800000 });
  await command('cargo', ['build', '--bin', 'dbproxy_acceptance_probe'], { cwd: dbRoot, env: nativeEnv, timeout: 1800000 });
  const testBuild = await command('cargo', ['test', '-p', 'tiangz-dbproxy-server', '--test', 'authoritative_reads', '--no-run', '--message-format=json'], { cwd: dbRoot, env: nativeEnv, timeout: 1800000 });
  const authorityTest = testBuild.split('\n').filter(l => l.startsWith('{')).map(JSON.parse).find(x => x.reason === 'compiler-artifact' && x.target.name === 'authoritative_reads' && x.executable)?.executable;
  assert.ok(authorityTest, 'authority test binary missing');
  const shortModules = path.join(buildDir, 'modules'), shortDist = path.join(buildDir, 'dist');
  await cp(path.join(root, 'modules'), shortModules, { recursive: true });
  const settingsPath = path.join(shortModules, 'slg/src/model/residency.json');
  const settings = JSON.parse(await readFile(settingsPath, 'utf8')); settings.keepAliveMs = 1000;
  await writeFile(settingsPath, JSON.stringify(settings));
  for (const tool of ['codegen_module_protocol.mjs', 'prepare_game_modules.mjs']) await command(process.execPath, [path.join(engine, 'tools', tool), '--modules-dir', shortModules], { cwd: engine, env: nativeEnv });
  await command(process.execPath, [path.join(engine, 'tools/build_runtime_bundles.mjs'), '--modules-dir', shortModules, '--out-dir', shortDist], { cwd: engine, env: nativeEnv });
  const hotfix = await buildHotfix(path.join(buildDir, 'hotfix'), nativeEnv);
  const image = `tiangz-slg-dbproxy:acceptance-${path.basename(buildDir).toLowerCase()}`;
  await command('docker', ['build', '-f', 'Dockerfile.dev', '-t', image, '.'], { cwd: dbRoot, timeout: 1800000 });
  const imageId = await command('docker', ['image', 'inspect', image, '--format', '{{.Id}}']);
  const artifacts = { hotfix, imageId, shortDist, authorityTest, files: {}, sources: {}, builtAt: new Date().toISOString() };
  for (const file of [path.join(engine, 'target/debug', executable('TiangZ')), path.join(dbRoot, 'target/debug', executable('dbproxy_acceptance_probe')), authorityTest,
    ...['model.js', 'hotfix.js'].flatMap(name => [path.join(root, 'dist', name), path.join(shortDist, name)])]) artifacts.files[file] = hash(await readFile(file));
  for (const [name, digest] of Object.entries(hotfix.files)) artifacts.files[path.join(hotfix.directory, name)] = digest;
  for (const repo of [engine, dbRoot, path.resolve(root, '../..')]) artifacts.sources[repo] = await sourceState(repo);
  await writeFile(manifestPath, JSON.stringify(artifacts, null, 2));
  console.log(JSON.stringify({ status: 'built-not-tested', manifestPath })); process.exit(0);
}

const artifacts = JSON.parse(await readFile(manifestPath, 'utf8'));
for (const [file, expected] of Object.entries(artifacts.files)) { await access(file); assert.equal(hash(await readFile(file)), expected, `stale artifact: ${path.basename(file)}`); }
for (const [repo, expected] of Object.entries(artifacts.sources)) assert.equal((await sourceState(repo)).fingerprint, expected.fingerprint, `source changed since build: ${path.basename(repo)}`);
if (options.action === 'check') { console.log('Artifacts and source hashes match; no Docker access or runtime validation.'); process.exit(0); }

await mkdir(base, { recursive: true });
const directory = await mkdtemp(path.join(base, 'run-'));
const report = { status: 'running', options, omitted: { ...Object.fromEntries(Object.keys(cases).filter(id => !options.selected.includes(id)).map(id => [id, 'not-run'])), ...Object.fromEntries(Object.keys(pendingCoverage).map(id => [id, 'not-run'])) }, startedAt: new Date().toISOString(), artifacts, cases: [] };
for (let round = 1; round <= options.rounds; round++) for (const id of options.selected) report.cases.push({ id, round, status: 'not-run' });
const save = async () => { await writeFile(path.join(directory, 'report.next.json'), JSON.stringify(report, null, 2)); await rename(path.join(directory, 'report.next.json'), path.join(directory, 'report.json')); };
let cancelled = false, deadline;
const cancelledOrExpired = () => {
  if (existsSync(path.join(directory, 'STOP'))) cancelled = true;
  return cancelled || (deadline !== undefined && Date.now() >= deadline);
};
const startWindow = () => { if (options.durationMs && deadline === undefined) {
  deadline = Date.now() + options.durationMs; report.measurementStartedAt = new Date().toISOString();
  report.measurementDeadline = new Date(deadline).toISOString();
} };
// 剩余窗口持续核对三名玩家，并周期性确认经济操作。 / Reconcile three players and confirm economic operations for the remaining window.
async function steadyWindow(env) {
  const samples = []; let controls = await Promise.all(['alice', 'bob'].map(player => env.call(player))); let nextCommand = Date.now(), previous = await env.call('income');
  while (Date.now() < deadline - 2000) {
    if (cancelled) throw Error('cancelled');
    const spend = Date.now() >= nextCommand ? 10 : 0;
    const current = spend ? await env.call('income', previous.sequence + 1, 'recruit', 0, 1) : await env.call('income');
    assertPair(current, 'P11'); assertIncome(previous, current, spend);
    if (spend) { assert.equal(current.receipt.accepted, true); nextCommand = Date.now() + 30000; }
    previous = current;
    const views = await Promise.all(['alice', 'bob'].map(player => env.call(player)));
    for (const [index, view] of views.entries()) {
      assertPair(view, 'P11'); assertIncome(controls[index], view);
      for (const key of ['sequence', 'troops', 'heroes', 'receipt']) assert.deepEqual(view[key], controls[index][key]);
    }
    controls = views;
    if (samples.length % 10 === 0) samples.push({ at: Date.now(), current, metrics: await env.gameMetrics() });
    else samples.push({ at: Date.now(), current });
    await env.wait(Math.min(1000, Math.max(0, deadline - Date.now() - 2000)));
  }
  // 最后两秒停止入队，留给在途回包收尾。 / Stop enqueueing during the final two-second drain.
  while (Date.now() < deadline) { if (cancelled) throw Error('cancelled'); await new Promise(r => setTimeout(r, Math.min(250, deadline - Date.now()))); }
  return samples;
}
/** 故障解除后持续核对已确认状态，不能只凭ready判恢复。 / Reconcile confirmed state after faults instead of relying on readiness alone. */
async function recoveryObservation(env, durationMs) {
  const recoveryStartedAt = Date.now();
  await until(async () => { try { return await env.sql('SELECT 1') === '1'; } catch { return false; } }, 'PG ready after fault', 30000);
  const samples = [], players = ['alice', 'bob', 'income']; let previous = await Promise.all(players.map(p => env.call(p)));
  const end = Date.now() + durationMs; let nextCommand = Date.now();
  while (Date.now() < end) {
    const spend = Date.now() >= nextCommand ? 10 : 0;
    const current = await Promise.all(players.map((p, i) => i === 2 && spend ? env.call(p, previous[i].sequence + 1, 'recruit', 0, 1) : env.call(p)));
    for (const [i, value] of current.entries()) {
      assertIncome(previous[i], value, i === 2 ? spend : 0);
      assert.deepEqual(value.heroes, previous[i].heroes);
      assert.equal(value.troops, previous[i].troops + (i === 2 && spend ? 1 : 0));
      assert.equal(value.sequence, previous[i].sequence + (i === 2 && spend ? 1 : 0));
      if (!(i === 2 && spend)) assert.deepEqual(value.receipt, previous[i].receipt);
      else assert.equal(value.receipt.accepted, true);
    }
    let persisted;
    if (spend) {
      nextCommand = Date.now() + 30000; persisted = await env.rows();
      for (const [i, player] of players.entries()) {
        const row = persisted.find(r => r.namespace === env.record(player).namespace && r.key === env.record(player).key);
        assert.ok(row, 'observed player must remain durable'); assertIncome(current[i], row.value);
        for (const field of ['sequence', 'heroes', 'troops']) assert.deepEqual(row.value[field], current[i][field]);
        if (row.value.receipt) assert.deepEqual(row.value.receipt, current[i].receipt); else assert.equal(current[i].sequence, 0);
      }
    }
    samples.push({ at: Date.now(), views: current, persisted, dbMetrics: samples.length % 15 === 0 ? await Promise.all([env.metrics(0), env.metrics(1)]) : undefined });
    previous = current; await env.wait(Math.min(2000, Math.max(0, end - Date.now())));
  }
  const pendingRepairs = Number(await env.sql("SELECT count(*) FROM dbproxy_cache_repairs WHERE namespace LIKE 'slg.demo.%'"));
  assert.equal(pendingRepairs, 0, 'cache repairs must converge after recovery observation');
  return { recoveryStartedAt, durationMs, pendingRepairs, samples };
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { cancelled = true; });
await save(); console.log(directory);
try {
  for (const item of report.cases) {
    if (cancelledOrExpired()) throw Error('cancelled or profile budget exhausted before required cases completed');
    const caseDirectory = path.join(directory, `${item.id}-${item.round}`);
    await mkdir(caseDirectory); item.status = 'running'; item.startedAt = new Date().toISOString(); await save();
    if (item.id === 'C') {
      let output, failure;
      try { output = await command(process.execPath, ['tools/recovery.mjs', 'run', '--confirm', 'isolated-slg-crash-test'], { cwd: root, env: { ...nativeEnv, SLG_RECOVERY_IMAGE_ID: artifacts.imageId }, timeout: 600000, cooperative: true, cancelled: cancelledOrExpired }); }
      catch (error) { failure = error; output = error.stdout ?? ''; }
      await writeFile(path.join(caseDirectory, 'controller.log'), output);
      const match = output.match(/\[slg-recovery\] (?:passed|failed): (.+)\/report.json/);
      if (match) {
        const reportPath = path.join(match[1], 'report.json');
        const childReport = JSON.parse(await readFile(reportPath, 'utf8'));
        item.evidence = { reportPath, report: childReport };
        assert.equal(childReport.status, 'passed'); assert.equal(childReport.cases.length, 7);
      }
      if (failure) throw failure;
      assert.ok(match, 'recovery did not produce a report');
      item.status = 'passed'; item.finishedAt = new Date().toISOString(); await save(); continue;
    }
    const env = new Environment(caseDirectory, artifacts, cancelledOrExpired);
    item.project = env.project;
    try {
      await env.init(item.id === 'A5', Object.hasOwn(hotfixScenarios, item.id)); startWindow();
      item.baseline = env.baseline; item.protocol = env.info;
      item.configuration = structuredClone({ dbproxy: env.dbConfig, game: env.config });
      item.resourcesBefore = await env.resources();
      item.evidence = await (hotfixScenarios[item.id] ?? scenarios[item.id])(env);
      if (options.profile === 'smoke30' && item === report.cases.at(-1)) item.steady = await steadyWindow(env);
      if (options.recoveryObservationMs && /^B/.test(item.id)) item.recoveryObservation = await recoveryObservation(env, options.recoveryObservationMs);
      if (options.profile === 'acceptance90' && cancelledOrExpired()) throw Error('acceptance90 budget exhausted');
      item.final = await env.rows(); item.resourcesAfter = await env.resources();
      item.status = 'passed';
    } catch (error) { item.status = error.acceptanceStatus ?? 'failed'; item.error = String(error); throw error; }
    finally {
      item.cleanup = await env.close(); item.processes = env.processes; item.events = env.events; item.lifecycle = env.lifecycleEvents; item.clients = env.clientHistory.map(c => ({ states: c.states, events: c.events }));
      await writeFile(path.join(caseDirectory, 'rpc-events.json'), JSON.stringify(env.proxies.map(p => p.events), null, 2));
      item.finishedAt = new Date().toISOString();
      if (Object.values(item.cleanup).some(v => v !== 'stopped')) { item.status = 'failed'; item.cleanupFailed = true; }
      await save();
    }
    assert.equal(item.status, 'passed', 'cleanup must succeed');
  }
  report.status = options.fullAcceptance ? 'passed' : options.profile === 'matrix' ? 'subset-passed' : options.profile + '-passed';
} catch (error) {
  report.status = cancelled ? 'cancelled' : 'failed'; report.error = String(error); process.exitCode = 1;
  for (const item of report.cases) if (item.status === 'running') { item.status = 'failed'; item.error = String(error); }
} finally {
  report.finishedAt = new Date().toISOString(); await save(); console.log(JSON.stringify({ status: report.status, report: path.join(directory, 'report.json') }));
}
