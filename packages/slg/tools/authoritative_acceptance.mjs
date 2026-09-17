import assert from 'node:assert/strict';
import { access, cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse, cases } from './acceptance/plan.mjs';
import { Environment, command, root, engine, dbRoot, executable, sourceState, hash } from './acceptance/environment.mjs';
import { scenarios } from './acceptance/scenarios.mjs';

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
  const image = `tiangz-slg-dbproxy:acceptance-${path.basename(buildDir).toLowerCase()}`;
  await command('docker', ['build', '-f', 'Dockerfile.dev', '-t', image, '.'], { cwd: dbRoot, timeout: 1800000 });
  const imageId = await command('docker', ['image', 'inspect', image, '--format', '{{.Id}}']);
  const artifacts = { imageId, shortDist, authorityTest, files: {}, sources: {}, builtAt: new Date().toISOString() };
  for (const file of [path.join(engine, 'target/debug', executable('TiangZ')), path.join(dbRoot, 'target/debug', executable('dbproxy_acceptance_probe')), authorityTest,
    ...['model.js', 'hotfix.js'].flatMap(name => [path.join(root, 'dist', name), path.join(shortDist, name)])]) artifacts.files[file] = hash(await readFile(file));
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
const report = { status: 'running', options, startedAt: new Date().toISOString(), artifacts, cases: [] };
for (let round = 1; round <= options.rounds; round++) for (const id of options.selected) report.cases.push({ id, round, status: 'not-run' });
const save = () => writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2));
let cancelled = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { cancelled = true; });
await save(); console.log(directory);
try {
  for (const item of report.cases) {
    if (cancelled) throw Error('cancelled');
    const caseDirectory = path.join(directory, `${item.id}-${item.round}`);
    await mkdir(caseDirectory); item.status = 'running'; item.startedAt = new Date().toISOString(); await save();
    if (item.id === 'C') {
      let output, failure;
      try { output = await command(process.execPath, ['tools/recovery.mjs', 'run', '--confirm', 'isolated-slg-crash-test'], { cwd: root, env: { ...nativeEnv, SLG_RECOVERY_IMAGE_ID: artifacts.imageId }, timeout: 600000, cooperative: true, cancelled: () => cancelled }); }
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
    const env = new Environment(caseDirectory, artifacts, () => cancelled);
    item.project = env.project;
    try {
      await env.init(item.id === 'A5');
      item.baseline = env.baseline; item.protocol = env.info;
      item.configuration = structuredClone({ dbproxy: env.dbConfig, game: env.config });
      item.resourcesBefore = await env.resources();
      item.evidence = await scenarios[item.id](env);
      item.final = await env.rows(); item.resourcesAfter = await env.resources();
      item.status = 'passed';
    } catch (error) { item.status = 'failed'; item.error = String(error); throw error; }
    finally {
      item.cleanup = await env.close(); item.processes = env.processes; item.events = env.events;
      await writeFile(path.join(caseDirectory, 'rpc-events.json'), JSON.stringify(env.proxies.map(p => p.events), null, 2));
      item.finishedAt = new Date().toISOString();
      if (Object.values(item.cleanup).some(v => v !== 'stopped')) { item.status = 'failed'; item.cleanupFailed = true; }
      await save();
    }
    assert.equal(item.status, 'passed', 'cleanup must succeed');
  }
  report.status = options.fullAcceptance ? 'passed' : 'subset-passed';
} catch (error) {
  report.status = 'failed'; report.error = String(error); process.exitCode = 1;
  for (const item of report.cases) if (item.status === 'running') { item.status = 'failed'; item.error = String(error); }
} finally {
  report.finishedAt = new Date().toISOString(); await save(); console.log(JSON.stringify({ status: report.status, report: path.join(directory, 'report.json') }));
}
