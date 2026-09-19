import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import path from 'node:path';
import { Environment, root, sourceState, hash } from './acceptance/environment.mjs';
import { cases, confirmation } from './acceptance/plan.mjs';
import { soak, saveReport } from './acceptance/soak.mjs';

// 参数检查先于环境操作，完整长稳必须提供H/J的实际通过报告。 / Validate before environment operations; full soak requires actual H/J pass reports.
const args = process.argv.slice(2), options = new Map();
for (let i = 0; i < args.length; i += 2) {
  assert.ok(['--profile', '--confirm', '--hj-reports'].includes(args[i]) && args[i + 1] && !options.has(args[i]), 'invalid arguments');
  options.set(args[i], args[i + 1]);
}
const profile = options.get('--profile');
assert.ok(['smoke5', 'sampling10', 'soak3h', 'soak8h'].includes(profile));
assert.equal(options.get('--confirm'), confirmation);
const base = path.join(root, 'temp/authoritative-acceptance');
const artifacts = JSON.parse(await readFile(path.join(base, 'build.json'), 'utf8'));
for (const [file, expected] of Object.entries(artifacts.files)) assert.equal(hash(await readFile(file)), expected, 'stale artifact: ' + file);
for (const [repo, expected] of Object.entries(artifacts.sources)) assert.equal((await sourceState(repo)).fingerprint, expected.fingerprint, 'source changed: ' + repo);
const preflight = [];
if (profile === 'soak8h' || profile === 'soak3h') {
  const passed = new Set();
  for (const file of (options.get('--hj-reports') ?? '').split(',').filter(Boolean)) {
    const report = JSON.parse(await readFile(file, 'utf8'));
    for (const item of report.cases) if (item.status === 'passed') passed.add(item.id);
    preflight.push({ file: path.resolve(file), hash: hash(await readFile(file)), status: report.status, cases: report.cases.map(c => ({ id: c.id, status: c.status })) });
  }
  for (const id of Object.keys(cases).filter(id => /^[HJ]/.test(id))) assert.ok(passed.has(id), 'H/J not passed: ' + id);
}
await mkdir(base, { recursive: true });
const directory = await mkdtemp(path.join(base, profile + '-'));
let stopped = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { stopped = true; });
const cancelled = () => stopped ||= existsSync(path.join(directory, 'STOP'));
const report = { status: 'preparing', profile, pid: process.pid, startedAt: new Date().toISOString(), artifacts, preflight, players: 3, scope: 'SLG functional endurance; not a 500-player capacity test' };
const save = () => saveReport(directory, report);
const env = new Environment(directory, artifacts, cancelled);
report.project = env.project;
await save(); console.log(directory);
try {
  await env.init(false, true); report.status = 'running';
  await soak(env, report, save, { smoke: profile === 'smoke5', sampling: profile === 'sampling10', threeHour: profile === 'soak3h' });
  report.status = profile + '-passed';
} catch (error) {
  report.status = cancelled() ? 'cancelled' : 'failed'; report.error = String(error); report.stack = error.stack; process.exitCode = 1;
} finally {
  report.cleanup = await env.close(); report.processes = env.processes; report.events = env.events; report.lifecycle = env.lifecycleEvents;
  if (Object.values(report.cleanup).some(value => value !== 'stopped')) { report.status = 'failed'; report.cleanupFailed = true; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); await save(); console.log(JSON.stringify({ status: report.status, report: path.join(directory, 'report.json') }));
}
