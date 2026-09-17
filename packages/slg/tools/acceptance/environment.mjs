import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { createInterface } from 'node:readline';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { faultProxy } from './proxy.mjs';

export const root = path.resolve(import.meta.dirname, '../..');
export const engine = path.resolve(root, '../../../TiangZ');
export const dbRoot = path.resolve(root, '../../../TiangZ-DBProxy');
export const executable = name => name + (process.platform === 'win32' ? '.exe' : '');
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function until(check, label, milliseconds = 20000) {
  const end = Date.now() + milliseconds;
  while (Date.now() < end) { if (await check()) return; await sleep(50); }
  throw Error(`deadline exceeded: ${label}`);
}

/** 所有子进程有时限，错误不回显密钥/连接串参数。 / Bound child lifetimes and avoid echoing credential arguments. */
export async function command(file, args, options = {}) {
  const { timeout = 180000, cooperative = false, cancelled = () => false, ...spawnOptions } = options;
  const child = spawn(file, args, { windowsHide: true, stdio: cooperative ? ['ignore', 'pipe', 'pipe', 'ipc'] : ['ignore', 'pipe', 'pipe'], ...spawnOptions });
  let out = '';
  child.stdout.on('data', b => { out += b; }); child.stderr.resume();
  let stopping = false, force;
  const stop = () => {
    if (stopping) return; stopping = true;
    if (cooperative && child.connected) { child.send({ action: 'cancel' }, () => {}); force = setTimeout(() => child.kill(), 180000); }
    else child.kill();
  };
  const timer = setTimeout(stop, timeout);
  const poll = cooperative ? setInterval(() => { if (cancelled()) stop(); }, 250) : undefined;
  try {
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
    if (code !== 0 || stopping) throw Object.assign(Error(`${path.basename(file)} exited ${code}${stopping ? ' after cancellation/deadline' : ''}`), { stdout: out.trim() });
    return out.trim();
  } finally { clearTimeout(timer); clearTimeout(force); clearInterval(poll); }
}
async function port() { const server = createServer(); await new Promise(r => server.listen(0, '127.0.0.1', r)); const value = server.address().port; await new Promise(r => server.close(r)); return value; }

/** 记录源码文件哈希，包含未提交和未跟踪源码；不复制凭据。 / Hash tracked and untracked source without copying credentials. */
export async function sourceState(repository) {
  const names = (await command('git', ['ls-files', '-c', '-o', '--exclude-standard', '-z'], { cwd: repository })).split('\0');
  const files = {};
  for (const name of [...new Set(names)].sort()) {
    if (!/\.(rs|ts|mjs|proto|toml|lock|json)$/.test(name) || /(^|\/)(target|node_modules|dist|temp|logs|\.vscode|\.tiangz)\//.test(name)) continue;
    try { files[name] = hash(await readFile(path.join(repository, name))); } catch (e) { if (e.code !== 'ENOENT') throw e; files[name] = 'deleted'; }
  }
  return { commit: await command('git', ['rev-parse', 'HEAD'], { cwd: repository }), fingerprint: hash(JSON.stringify(files)), files };
}

/** JSON行通道调用正式Rust工具；退出时拒绝所有未完成请求。 / JSON-lines channel to the official Rust fixture. */
export function startProbe(env) {
  const child = spawn(path.join(dbRoot, 'target/debug', executable('dbproxy_acceptance_probe')), [], { windowsHide: true, env: { ...process.env, ...env, DBPROXY_ACCEPTANCE_ISOLATED: '1' }, stdio: ['pipe', 'pipe', 'pipe'] });
  let sequence = 0, stopped = false;
  const pending = new Map();
  const lines = createInterface({ input: child.stdout });
  child.stderr.resume();
  const failPending = error => { for (const slot of pending.values()) { clearTimeout(slot.timer); slot.reject(error); } pending.clear(); };
  child.stdin.on('error', () => { stopped = true; failPending(Error('probe input closed')); });
  lines.on('line', line => {
    try { const result = JSON.parse(line); const slot = pending.get(result.id); if (!slot) return; pending.delete(result.id); clearTimeout(slot.timer); result.ok ? slot.resolve(result.value) : slot.reject(Object.assign(Error(result.error), { code: result.code })); }
    catch { stopped = true; failPending(Error('invalid probe response')); child.kill(); }
  });
  const exited = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  exited.then(() => { stopped = true; failPending(Error('probe exited')); }, () => { stopped = true; failPending(Error('probe failed to start')); });
  return { async call(request) {
    if (stopped) throw Error('probe is closed');
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(Error('probe request deadline')); }, 35000);
      pending.set(id, { resolve, reject, timer }); child.stdin.write(JSON.stringify({ ...request, id }) + '\n');
    });
  }, async close() { child.stdin.end(); const timer = setTimeout(() => child.kill(), 2000); try { const code = await exited; assert.equal(code, 0); } finally { clearTimeout(timer); } } };
}

export class Environment {
  constructor(directory, artifacts, cancelled) { this.directory = directory; this.artifacts = artifacts; this.cancelled = cancelled; this.project = `slg-acceptance-${randomBytes(6).toString('hex')}`; this.processes = []; this.proxies = []; this.clients = new Set(); this.events = []; this.token = randomBytes(24).toString('hex'); }
  compose(...args) { return command('docker', ['compose', '-p', this.project, '-f', path.join(this.directory, 'compose.json'), ...args]); }
  async sql(statement) { return this.compose('exec', '-T', 'postgres', 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'slg', '-d', 'slg', '-tAc', statement); }
  async rows() { return JSON.parse(await this.sql("SELECT coalesce(json_agg(json_build_object('namespace',namespace,'key',record_key,'revision',revision,'value',convert_from(payload,'UTF8')::json)), '[]') FROM dbproxy_snapshots WHERE namespace LIKE 'slg.demo.%'")); }
  async player(id = 'alice') { const row = (await this.rows()).find(r => r.namespace === 'slg.demo.player.v1' && r.key === `realm-41/${id}`); assert.ok(row, 'player must exist'); return row; }
  record(id = 'alice') { return { namespace: 'slg.demo.player.v1', key: `realm-41/${id}` }; }
  endpoint(index = 0) { return `127.0.0.1:${this.dbPorts[index]}`; }
  async probe(request) { return this.helper.call({ endpoint: this.endpoint(), ...request }); }
  async redis(...args) { return this.compose('exec', '-T', 'cache', 'redis-cli', ...args.map(String)); }
  async metrics(index = 0) { const response = await fetch(`http://127.0.0.1:${this.healthPorts[index]}/metrics`, { signal: AbortSignal.timeout(2000) }); assert.ok(response.ok); return response.text(); }
  async resources() {
    const containers = (await this.compose('ps', '-q')).split(/\s+/).filter(Boolean);
    return { at: new Date().toISOString(), containers: await command('docker', ['stats', '--no-stream', '--format', '{{json .}}', ...containers]), postgres: await this.sql("SELECT json_build_object('version',current_setting('server_version'),'maxConnections',current_setting('max_connections'),'sharedBuffers',current_setting('shared_buffers'))"), metrics: await Promise.all([this.metrics(0), this.metrics(1)]) };
  }
  async wait(ms) { const end = Date.now() + ms; while (Date.now() < end) { if (this.cancelled()) throw Error('cancelled'); await sleep(Math.min(250, end - Date.now())); } }
  async ready(index) { await until(async () => { try { return (await fetch(`http://127.0.0.1:${this.healthPorts[index]}/ready`, { signal: AbortSignal.timeout(500) })).ok; } catch { return false; } }, 'DBProxy ready', 60000); }
  async service(action, name) {
    assert.ok(['stop', 'start', 'restart', 'kill'].includes(action)); assert.ok(['postgres', 'cache', 'dbproxy-a', 'dbproxy-b'].includes(name));
    this.events.push({ action, service: name, at: Date.now() });
    if (action === 'kill') await this.compose('kill', '-s', 'SIGKILL', name); else await this.compose(action, name);
  }
  async init(shortTtl = false) {
    this.shortTtl = shortTtl;
    await mkdir(this.directory, { recursive: true });
    await cp(shortTtl ? this.artifacts.shortDist : path.join(root, 'dist'), path.join(this.directory, 'dist'), { recursive: true });
    await mkdir(path.join(this.directory, 'configs'));
    this.dbPorts = [await port(), await port()]; this.healthPorts = [await port(), await port()]; const cachePort = await port(), pgPort = await port();
    const password = randomBytes(24).toString('hex');
    const dbConfig = JSON.parse(await readFile(path.join(root, 'infra/dbproxy/config.json'), 'utf8')); delete dbConfig.$schema;
    dbConfig.storage.authoritativeReadNamespaces = [];
    dbConfig.storage.cacheRedisUrlEnv = 'DBPROXY_CACHE_REDIS_URL';
    await writeFile(path.join(this.directory, 'db.json'), JSON.stringify(dbConfig));
    this.dbConfig = dbConfig;
    const services = {
      postgres: { image: 'postgres:18.4-bookworm', environment: { POSTGRES_USER: 'slg', POSTGRES_DB: 'slg', POSTGRES_PASSWORD: password }, volumes: ['pg:/var/lib/postgresql'], ports: [`127.0.0.1:${pgPort}:5432`], mem_limit: '1g', cpus: 2, healthcheck: { test: ['CMD', 'pg_isready', '-h', '127.0.0.1', '-U', 'slg', '-d', 'slg'], interval: '1s', timeout: '3s', retries: 60 } },
      redis: { image: 'redis:8.8.1-trixie', command: ['redis-server', '--appendonly', 'yes'], volumes: ['queue:/data'] },
      cache: { image: 'redis:8.8.1-trixie', command: ['redis-server', '--appendonly', 'no', '--save', ''], tmpfs: ['/data'], ports: [`127.0.0.1:${cachePort}:6379`] },
    };
    for (const [i, name] of ['dbproxy-a', 'dbproxy-b'].entries()) services[name] = {
      image: this.artifacts.imageId, command: ['--config', '/app/config.json'],
      environment: { DBPROXY_AUTH_TOKEN: this.token, DBPROXY_POSTGRES_URL: `postgres://slg:${password}@postgres:5432/slg`, DBPROXY_REDIS_URL: 'redis://redis:6379/0', DBPROXY_CACHE_REDIS_URL: 'redis://cache:6379/0' },
      ports: [`127.0.0.1:${this.dbPorts[i]}:7800`, `127.0.0.1:${this.healthPorts[i]}:9090`],
      volumes: [`${path.join(this.directory, 'db.json').replaceAll('\\', '/')}:/app/config.json:ro`],
      depends_on: { postgres: { condition: 'service_healthy' } },
    };
    await writeFile(path.join(this.directory, 'compose.json'), JSON.stringify({ services, volumes: { pg: {}, queue: {} } }), { mode: 0o600 });
    this.storageStarted = true; await this.compose('up', '-d', '--wait', '--wait-timeout', '90');
    await this.ready(0); await this.ready(1);
    this.probeEnv = { DBPROXY_AUTH_TOKEN: this.token, DBPROXY_CACHE_REDIS_URL: `redis://127.0.0.1:${cachePort}/0`, DBPROXY_REDIS_URL: `redis://127.0.0.1:${cachePort}/0`, DBPROXY_POSTGRES_URL: `postgres://slg:${password}@127.0.0.1:${pgPort}/slg` };
    this.helper = startProbe(this.probeEnv);
    this.info = await this.probe({ command: 'info' });
    for (const p of this.dbPorts) this.proxies.push(await faultProxy(p, request => this.probe(request)));
    const require = createRequire(path.join(engine, 'package.json'));
    await require('esbuild').build({ entryPoints: [path.join(root, 'client/cocos/assets/scripts/SlgConnection.ts')], outfile: path.join(this.directory, 'client.mjs'), bundle: true, format: 'esm', platform: 'node' });
    this.Connection = (await import(pathToFileURL(path.join(this.directory, 'client.mjs')).href)).SlgConnection;
    this.config = JSON.parse(await readFile(path.join(root, 'configs/dev/all-in-one.json'), 'utf8'));
    Object.assign(this.config.process.persistence.dbProxy, { endpoint: `127.0.0.1:${this.proxies[0].port}`, endpoints: this.proxies.map(p => `127.0.0.1:${p.port}`), clientPoolSize: 4 });
    this.config.process.observability.health.port = await port(); this.config.scenes[0].port = await port();
    await writeFile(path.join(this.directory, 'runtime.json'), JSON.stringify(this.config));
    await this.startGame();
    for (const name of ['alice', 'bob', 'income']) await this.call(name);
    this.baseline = await this.rows();
  }
  connectClient() { const client = new this.Connection('127.0.0.1', this.config.scenes[0].port); const pump = setInterval(() => client.update(), 10); this.clients.add({ client, pump }); return client; }
  disconnectClients() { for (const { client, pump } of this.clients) { clearInterval(pump); client.close(); } this.clients.clear(); this.client = undefined; }
  async startGame() {
    assert.ok(!this.game);
    const child = spawn(path.join(engine, 'target/debug', executable('TiangZ')), [`--runtime-root=${this.directory}`, path.join(this.directory, 'runtime.json')], { cwd: this.directory, windowsHide: true, env: { ...process.env, TIANGZ_DBPROXY_AUTH_TOKEN: this.token, TIANGZ_WATCHER_CONTROL: 'stdin' }, stdio: ['pipe', 'pipe', 'pipe'] });
    const log = createWriteStream(path.join(this.directory, `game-${this.processes.length + 1}.log`)); child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
    child.stdin.on('error', () => {});
    const exited = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', code => { log.end(); resolve(code); }); });
    exited.catch(() => {});
    this.game = { child, exited }; this.processes.push({ pid: child.pid, startedAt: Date.now() });
    await until(async () => { if (this.cancelled()) throw Error('cancelled'); if (child.exitCode !== null) throw Error(`game exited ${child.exitCode}`); try { return (await fetch(`http://127.0.0.1:${this.config.process.observability.health.port}/ready`, { signal: AbortSignal.timeout(500) })).ok; } catch { return false; } }, 'game ready', 30000);
    this.client = this.connectClient();
  }
  async stopGame(crash = false) {
    this.disconnectClients();
    if (!this.game) return;
    const current = this.game; this.game = undefined;
    if (crash) current.child.kill('SIGKILL'); else if (current.child.exitCode === null && current.child.stdin.writable) current.child.stdin.end('shutdown\n');
    let forced = false; const timer = setTimeout(() => { forced = true; current.child.kill(); }, 12000);
    try { const code = await current.exited; this.processes.at(-1).stopped = { crash, code, forced, at: Date.now() }; assert.ok(!forced && (crash || code === 0), 'game cleanup failed'); }
    finally { clearTimeout(timer); }
    this.proxies.forEach(p => p.disconnect());
  }
  async call(player = 'alice', sequence = 0, action = 'snapshot', target = 0, amount = 0, client = this.client) {
    if (!client) this.client = client = this.connectClient();
    const deadline = Date.now() + 10000;
    do {
      if (this.cancelled()) throw Error('cancelled');
      try { const value = await client.game({ player, sequence, action, target, amount }); assert.equal(value.persisted, true); return value; }
      catch (error) { if (!/正在结算/.test(String(error))) throw error; await this.wait(100); }
    } while (Date.now() < deadline);
    throw Error('business recovery deadline exceeded');
  }
  async close() {
    const cleanup = {};
    for (const [name, action] of [
      ['game', () => this.stopGame(false)],
      ['proxies', async () => { for (const p of this.proxies) await p.close(); }],
      ['probe', () => this.helper?.close()],
      ['storage', async () => { if (this.storageStarted) await this.compose('stop'); }],
    ]) { try { await action(); cleanup[name] = 'stopped'; } catch (error) { cleanup[name] = String(error); } }
    return cleanup;
  }
}
