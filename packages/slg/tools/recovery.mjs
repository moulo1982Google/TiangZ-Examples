import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile, cp, access } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertIncome, assertReceipt } from './acceptance/assertions.mjs';
import { faultProxy as decodedProxy } from './acceptance/proxy.mjs';
import { startProbe, dbRoot, executable } from './acceptance/environment.mjs';

const root = path.resolve(import.meta.dirname, '..');
const engine = path.resolve(root, '../../../TiangZ');
const action = process.argv[2] ?? 'plan';
const cases = ['building-before-commit', 'draw-lost-ack', 'hero-lost-ack', 'march-before-commit', 'settlement-lost-ack', 'tile-competition', 'offline-production'];
if (action === 'plan') { console.log(JSON.stringify({ cases, players: 3, storage: 'new isolated compose project; never uses existing SLG DB', duration: 'about 2 minutes after build/startup', status: 'not executed' }, null, 2)); process.exit(0); }
if (action !== 'check' && (action !== 'run' || process.argv[3] !== '--confirm' || process.argv[4] !== 'isolated-slg-crash-test' || process.argv.length !== 5)) throw Error('run requires --confirm isolated-slg-crash-test');
const binary = path.join(engine, 'target/debug', process.platform === 'win32' ? 'TiangZ.exe' : 'TiangZ');
await access(binary); await access(path.join(root, 'dist/model.js'));
await access(path.join(dbRoot, 'target/debug', executable('dbproxy_acceptance_probe')));
if (action === 'check') { console.log('SLG artifacts exist; no Docker access or runtime validation'); process.exit(0); }
const base = path.join(root, 'temp/recovery'); await mkdir(base, { recursive: true });
const directory = await mkdtemp(path.join(base, 'run-'));
const project = `slg-recovery-${randomBytes(5).toString('hex')}`;
const report = { status: 'running', project, directory, startedAt: new Date().toISOString(), cases: [], processes: [], cleanup: {} };
const save = () => writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let cancelled = false, game, client, pump, proxy, startedStorage = false, serial = 0;
process.on('message', message => { if (message?.action === 'cancel') cancelled = true; });
process.once('SIGINT', () => { cancelled = true; }); process.once('SIGTERM', () => { cancelled = true; });
async function until(check, label, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (cancelled) throw Error('cancelled'); if (await check()) return; await sleep(50); }
  throw Error(`timeout: ${label}`);
}
async function command(file, args, capture = false) {
  const child = spawn(file, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout.on('data', b => { output += b; }); child.stderr.on('data', b => { if (!capture) process.stderr.write(b); });
  const timer = setTimeout(() => child.kill('SIGKILL'), 180000);
  try { const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); }); if (code !== 0) throw Error(`${file} failed (${code})`); }
  finally { clearTimeout(timer); }
  return output.trim();
}
const compose = (...args) => command('docker', ['compose', '-p', project, '-f', path.join(directory, 'compose.json'), ...args]);
async function port() { const s = createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r)); const p = s.address().port; await new Promise(r => s.close(r)); return p; }
async function rows() {
  const id = await compose('ps', '-q', 'postgres'); assert.ok(id);
  const result = await command('docker', ['exec', id, 'psql', '-U', 'slg', '-d', 'slg', '-tAc', "SELECT coalesce(json_agg(json_build_object('namespace',namespace,'key',record_key,'revision',revision,'value',convert_from(payload,'UTF8')::json)), '[]') FROM dbproxy_snapshots"], true);
  return JSON.parse(result);
}
const playerRow = (data, player) => data.find(r => r.namespace === 'slg.demo.player.v1' && r.key === `realm-41/${player}`)?.value;
const worldRow = data => data.find(r => r.namespace === 'slg.demo.world.v1')?.value;

// 正式协议解码并关联请求；不靠原始字节猜测回包。
// Decode official frames and correlate requests rather than guessing response bytes.
async function faultProxy(upstreamPort) {
  const helper = startProbe({});
  const proxy = await decodedProxy(upstreamPort, request => helper.call(request));
  return { port: proxy.port, events: proxy.events,
    arm(phase, player, tokens) {
      proxy.arm(phase === 'before' ? 'request' : 'response', request => request?.kind === 'commit'
        && request.operationId.startsWith(`slg-demo:${player}:`)
        && tokens.every(t => JSON.stringify(request.writes).includes(t)));
    },
    hit() { const hit = proxy.hit(); if (hit?.event.direction === 'response') assert.equal(hit.event.error, null, 'target commit must be successful'); return hit; },
    release() { proxy.release(); },
    reset() { proxy.reset(); },
    async close() { try { await proxy.close(); } finally { await helper.close(); } },
  };
}
let SlgConnection, config;
async function startGame() {
  const child = spawn(binary, [`--runtime-root=${directory}`, path.join(directory, 'runtime.json')], { cwd: directory, env: { ...process.env, TIANGZ_DBPROXY_AUTH_TOKEN: token, TIANGZ_WATCHER_CONTROL: 'stdin' }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const log = createWriteStream(path.join(directory, `game-${++serial}.log`));
  child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
  child.stdin.on('error', () => {});
  const exited = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', code => { log.end(); resolve(code); }); });
  exited.catch(() => {});
  game = { child, exited }; report.processes.push({ pid: child.pid, generation: serial });
  await until(async () => { if (child.exitCode !== null) throw Error(`game exited ${child.exitCode}`); try { return (await fetch(`http://127.0.0.1:${config.process.observability.health.port}/ready`, { signal: AbortSignal.timeout(500) })).ok; } catch { return false; } }, 'game ready');
  client = new SlgConnection('127.0.0.1', config.scenes[0].port); pump = setInterval(() => client.update(), 10);
}
async function stopGame(crash) {
  if (!game) return;
  clearInterval(pump); client?.close();
  const current = game; game = undefined;
  if (crash) { current.child.kill('SIGKILL'); report.processes.at(-1).killed = true; }
  else if (current.child.exitCode === null && current.child.stdin.writable) current.child.stdin.end('shutdown\n');
  let timedOut = false; const timer = setTimeout(() => { timedOut = true; current.child.kill('SIGKILL'); }, 10000);
  try { const code = await current.exited; if (timedOut || (!crash && code !== 0)) throw Error(`game cleanup failed ${code}`); }
  finally { clearTimeout(timer); }
  proxy.reset();
}
async function call(player, sequence = 0, action = 'snapshot', target = 0, amount = 0) {
  let error;
  for (let i = 0; i < 30; i++) {
    if (cancelled) throw Error('cancelled');
    try { const value = await client.game({ player, sequence, action, target, amount }); assert.equal(value.persisted, true); return value; }
    catch (e) { error = e; if (!/正在结算/.test(String(e))) throw e; await sleep(100); }
  }
  throw error;
}
async function test(name, body) { console.log(`[slg-recovery] ${name}`); const item = { name, status: 'running' }; report.cases.push(item); await save(); try { item.evidence = await body(); item.status = 'passed'; } catch (e) { item.status = 'failed'; item.error = String(e); throw e; } finally { await save(); } }
async function crashAt(phase, player, tokens, send) {
  proxy.arm(phase, player, tokens);
  const request = send().then(value => ({ value }), error => ({ error: String(error) }));
  await until(() => proxy.hit(), `${phase} commit observed`);
  const boundary = proxy.hit(); const persisted = await rows();
  await stopGame(true); await request;
  return { boundary, persisted };
}
const token = randomBytes(24).toString('hex');
try {
  report.controllerSha256 = createHash('sha256').update(await readFile(import.meta.filename)).digest('hex');
  report.binarySha256 = createHash('sha256').update(await readFile(binary)).digest('hex');
  report.dbImage = await command('docker', ['image', 'inspect', process.env.SLG_RECOVERY_IMAGE_ID ?? 'tiangz-slg-dbproxy:dev', '--format', '{{.Id}}'], true);
  await cp(path.join(root, 'dist'), path.join(directory, 'dist'), { recursive: true });
  await mkdir(path.join(directory, 'configs'));
  for (const name of ['model.js', 'hotfix.js']) report[`${name}Sha256`] = createHash('sha256').update(await readFile(path.join(directory, 'dist', name))).digest('hex');
  const require = createRequire(path.join(engine, 'package.json'));
  await require('esbuild').build({ entryPoints: [path.join(root, 'client/cocos/assets/scripts/SlgConnection.ts')], bundle: true, platform: 'node', format: 'esm', outfile: path.join(directory, 'client.mjs') });
  ({ SlgConnection } = await import(pathToFileURL(path.join(directory, 'client.mjs')).href));
  const dbPort = await port(), health = await port();
  const dbConfig = JSON.parse(await readFile(path.join(root, 'infra/dbproxy/config.json'), 'utf8')); delete dbConfig.$schema; dbConfig.storage.authoritativeReadNamespaces = [];
  await writeFile(path.join(directory, 'db.json'), JSON.stringify(dbConfig));
  const databasePassword = randomBytes(16).toString('hex');
  const composeConfig = { services: {
    postgres: { image: 'postgres:18.4-bookworm', environment: { POSTGRES_USER: 'slg', POSTGRES_DB: 'slg', POSTGRES_PASSWORD: databasePassword }, volumes: ['pg:/var/lib/postgresql'], healthcheck: { test: ['CMD-SHELL', 'pg_isready -h 127.0.0.1 -U slg -d slg'], interval: '1s', timeout: '3s', retries: 60 } },
    redis: { image: 'redis:8.8.1-trixie', command: ['redis-server', '--appendonly', 'yes'], volumes: ['redis:/data'] },
    dbproxy: { image: report.dbImage, environment: { DBPROXY_AUTH_TOKEN: token, DBPROXY_POSTGRES_URL: `postgres://slg:${databasePassword}@postgres:5432/slg`, DBPROXY_REDIS_URL: 'redis://redis:6379/0', RUST_LOG: 'info' }, ports: [`127.0.0.1:${dbPort}:7800`, `127.0.0.1:${health}:9090`], volumes: [`${path.join(directory, 'db.json').replaceAll('\\', '/')}:/app/config.json:ro`], command: ['--config', '/app/config.json'], depends_on: { postgres: { condition: 'service_healthy' }, redis: { condition: 'service_started' } } } }, volumes: { pg: {}, redis: {} } };
  await writeFile(path.join(directory, 'compose.json'), JSON.stringify(composeConfig), { mode: 0o600 });
  startedStorage = true; await compose('up', '-d', '--wait', '--wait-timeout', '90');
  await until(async () => { try { return (await fetch(`http://127.0.0.1:${health}/dependencies`, { signal: AbortSignal.timeout(1000) })).ok; } catch { return false; } }, 'DB dependencies', 60000);
  proxy = await faultProxy(dbPort);
  config = JSON.parse(await readFile(path.join(root, 'configs/dev/all-in-one.json'), 'utf8'));
  config.process.persistence.dbProxy.endpoint = `127.0.0.1:${proxy.port}`; config.process.persistence.dbProxy.clientPoolSize = 4;
  config.process.observability.health.port = await port(); config.scenes[0].port = await port();
  await writeFile(path.join(directory, 'runtime.json'), JSON.stringify(config));
  report.runtimeConfigSha256 = createHash('sha256').update(JSON.stringify(config)).digest('hex');
  report.protocolLockSha256 = createHash('sha256').update(await readFile(path.join(root, 'modules/slg/proto/schema.lock.json'))).digest('hex');
  await startGame(); await call('alice'); await call('bob'); await call('income');
  await test('building-before-commit', async () => {
    const baseline = playerRow(await rows(), 'alice');
    const e = await crashAt('before', 'alice', ['"sequence":1'], () => call('alice', 1, 'upgrade-building', 1));
    assert.equal(playerRow(e.persisted, 'alice').sequence, 0); assert.deepEqual(playerRow(e.persisted, 'alice'), baseline);
    await startGame(); const first = await call('alice', 1, 'upgrade-building', 1); const duplicate = await call('alice', 1, 'upgrade-building', 1);
    assertIncome(playerRow(e.persisted, 'alice'), first, 200); assert.equal(duplicate.buildings[0].dueAt, first.buildings[0].dueAt);
    await stopGame(true); await startGame(); const recovered = await call('alice'); assert.equal(recovered.buildings[0].dueAt, first.buildings[0].dueAt);
    await until(async () => (await call('alice')).buildings[0].level === 2, 'building completion');
    assert.equal((await call('alice')).buildings[0].level, 2); return e;
  });
  await test('draw-lost-ack', async () => {
    const e = await crashAt('after', 'alice', ['"sequence":2'], () => call('alice', 2, 'draw-hero'));
    const saved = playerRow(e.persisted, 'alice'); assert.equal(saved.sequence, 2); assert.equal(saved.heroes.reduce((n, h) => n + h.copies, 0), 2);
    await startGame(); const replay = await call('alice', 2, 'draw-hero'); assert.deepEqual(replay.heroes, saved.heroes); assertIncome(saved, replay); assertReceipt(replay.receipt, saved.receipt);
    // 让另一玩家的战报在抽卡提交后变化，仍以原序号恢复独立回执。
    // Change another player's battle report after a draw commit, then replay the original receipt.
    await call('income', 1, 'march', 4, 1);
    const receiptCrash = await crashAt('after', 'income', ['"sequence":2'], () => call('income', 2, 'draw-hero'));
    const original = playerRow(receiptCrash.persisted, 'income');
    await startGame();
    await until(async () => playerRow(await rows(), 'income').march === null, 'offline battle changes report');
    const settled = playerRow(await rows(), 'income');
    assert.notEqual(settled.report, original.report); assertReceipt(settled.receipt, original.receipt);
    const replayAfterBattle = await call('income', 2, 'draw-hero');
    assertReceipt(replayAfterBattle.receipt, original.receipt); assert.deepEqual(replayAfterBattle.heroes, original.heroes);
    assert.equal(replayAfterBattle.troops, settled.troops); assertIncome(settled, replayAfterBattle);
    return { ...e, replay, receiptCrash, settled, replayAfterBattle };
  });
  await test('hero-lost-ack', async () => {
    const before = await call('alice'); const e = await crashAt('after', 'alice', ['"sequence":3'], () => call('alice', 3, 'upgrade-hero', 1));
    const saved = playerRow(e.persisted, 'alice'); assert.equal(saved.heroes[0].level, 2); assertIncome(before, saved, 100);
    await startGame(); const replay = await call('alice', 3, 'upgrade-hero', 1); assert.deepEqual(replay.heroes, saved.heroes); assertReceipt(replay.receipt, saved.receipt); assertIncome(saved, replay); return { ...e, replay };
  });
  await test('march-before-commit', async () => {
    const e = await crashAt('before', 'alice', ['"sequence":4'], () => call('alice', 4, 'march', 2, 1));
    assert.equal(playerRow(e.persisted, 'alice').troops, 100); assert.equal(worldRow(e.persisted).tiles[0].reservedBy, '');
    await startGame(); const first = await call('alice', 4, 'march', 2, 1); assert.equal(first.troops, 80);
    await stopGame(true); await startGame(); const again = await call('alice', 4, 'march', 2, 1); assert.deepEqual(again.marches, first.marches); assert.equal(again.troops, 80); return e;
  });
  await test('settlement-lost-ack', async () => {
    const e = await crashAt('after', 'alice', ['"sequence":4', '"march":null'], async () => { await sleep(11000); return call('alice'); });
    const saved = playerRow(e.persisted, 'alice'); assert.equal(saved.march, null); assert.equal(saved.troops, 98); assert.equal(worldRow(e.persisted).tiles[0].owner, 'alice');
    await startGame(); for (let i = 0; i < 2; i++) { const again = await call('alice'); assert.equal(again.troops, 98); assert.equal(again.tiles[0].reservedBy, ''); } return e;
  });
  await test('tile-competition', async () => {
    const before = { alice: await call('alice'), bob: await call('bob') };
    await call('income');
    proxy.arm('before', 'alice', ['"sequence":5']);
    const alice = call('alice', 5, 'march', 3, 1); alice.catch(() => {});
    await until(() => proxy.hit(), 'world commit held');
    const hold = proxy.hit();
    const bob = call('bob', 1, 'march', 3, 1); bob.catch(() => {});
    const started = Date.now();
    const thirdClient = new SlgConnection('127.0.0.1', config.scenes[0].port);
    const thirdPump = setInterval(() => thirdClient.update(), 10);
    let third;
    try {
      let timer;
      try { third = await Promise.race([thirdClient.game({ player:'income',sequence:0,action:'snapshot',target:0,amount:0 }), new Promise((_,reject) => { timer=setTimeout(()=>reject(Error('unrelated resident blocked by world commit')),2000); })]); }
      finally { clearTimeout(timer); }
    } finally { clearInterval(thirdPump); thirdClient.close(); proxy.release(); }
    assert.equal(third.persisted, true);
    const thirdLatencyMs = Date.now() - started;
    const results = [await alice, await bob];

    assert.equal(results.filter(r => r.marches.length === 1).length, 1);
    const loser = results.find(r => !r.marches.length); assert.match(loser.report, /操作未执行/);
    for (const result of results) {
      const previous = before[result.player];
      const produced = (result.nextProductionAt - previous.nextProductionAt) / 60000 * 100;
      assert.equal(result.food, previous.food + produced - (result.marches.length ? 100 : 0));
      assert.equal(result.troops, previous.troops - (result.marches.length ? 20 : 0));
    }
    const data = await rows(); assert.equal(playerRow(data, loser.player).troops, loser.player === 'alice' ? 98 : 100);
    return { players: results, persisted: data, heldCommit: hold, third, thirdLatencyMs };
  });
  await test('offline-production', async () => {
    const before = playerRow(await rows(), 'income'); await stopGame(true);
    console.log('[slg-recovery] offline for 65 seconds; no game process running');
    for (let i = 0; i < 65; i++) { if (cancelled) throw Error('cancelled'); await sleep(1000); }
    await startGame(); const result = await call('income');
    const saved = playerRow(await rows(), 'income'); const minutes = (saved.producedAt - before.producedAt) / 60000;
    assert.ok(Number.isInteger(minutes) && minutes >= 1); assert.equal(saved.food, before.food + minutes * 100);
    assert.equal(saved.producedAt, before.producedAt + Math.floor((result.serverTime - before.producedAt) / 60000) * 60000);
    assertIncome(result, await call('income'));
    await call('alice'); await call('bob');
    const final = await rows(); const world = worldRow(final);
    for (const id of ['alice', 'bob']) {
      const p = playerRow(final, id); assert.equal(p.march, null);
      assert.equal(world.tiles.some(t => t.reservedBy === id), false);
    }
    return { before, after: saved, minutes, final };
  });
  assert.deepEqual(report.cases.map(c => c.name), cases); report.status = 'passed';
} catch (error) { report.status = 'failed'; report.error = String(error); process.exitCode = 1; console.error(error); }
finally {
  try { await stopGame(false); report.cleanup.game = 'stopped'; } catch (e) { report.cleanup.game = String(e); report.status = 'failed'; process.exitCode = 1; }
  try { await proxy?.close(); } catch (e) { report.cleanup.proxy = String(e); report.status = 'failed'; process.exitCode = 1; }
  if (startedStorage) { try { await compose('stop'); report.cleanup.storage = 'stopped; isolated containers and volumes retained'; } catch (e) { report.cleanup.storage = String(e); report.status = 'failed'; process.exitCode = 1; } }
  if (proxy) await writeFile(path.join(directory, 'rpc-events.json'), JSON.stringify(proxy.events, null, 2));
  report.finishedAt = new Date().toISOString(); await save(); console.log(`[slg-recovery] ${report.status}: ${directory}/report.json`);
  if (process.connected) process.disconnect();
}
