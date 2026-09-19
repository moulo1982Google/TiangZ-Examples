import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createServer, connect } from 'node:net';
import { once } from 'node:events';
import path from 'node:path';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { parse, confirmation, cases, smoke30 } from './plan.mjs';
import { assertIncome, assertReceipt } from './assertions.mjs';
import { faultProxy } from './proxy.mjs';
import { until, command } from './environment.mjs';

test('failed child preserves stdout and stderr evidence', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'slg-command-log-'));
  try {
    const logFile = path.join(directory, 'child.log');
    await assert.rejects(command(process.execPath, ['-e', 'console.log("probe-started"); console.error("assertion-detail"); process.exitCode = 101;'], { logFile }), /exited 101/);
    const evidence = await readFile(logFile, 'utf8');
    assert.match(evidence, /probe-started/);
    assert.match(evidence, /assertion-detail/);
  } finally { await rm(directory, { recursive: true }); }
});

test('plan and rejected arguments never require Docker or artifacts', () => {
  const script = path.resolve(import.meta.dirname, '../authoritative_acceptance.mjs');
  const run = args => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env: { ...process.env, PATH: '' }, timeout: 5000 });
  const result = run([]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).cases.length, Object.keys(cases).length);
  for (const args of [['run'], ['run', '--confirm', 'yes'], ['run', '--players', '500'], ['plan', '--cases', 'A1,A1'], ['plan', '--rounds', '4'], ['plan', '--cases', 'missing'], ['plan', '--cases', 'constructor'], ['check', '--confirm', confirmation]]) {
    assert.notEqual(run(args).status, 0, args.join(' '));
  }
});

test('a subset or fewer than three rounds cannot be full acceptance', () => {
  assert.equal(parse(['run', '--confirm', confirmation]).fullAcceptance, true);
  assert.equal(parse(['run', '--confirm', confirmation, '--rounds', '1']).fullAcceptance, false);
  assert.equal(parse(['run', '--confirm', confirmation, '--cases', 'A1']).fullAcceptance, false);
});

test('income permits a minute boundary but rejects duplicate income and duplicate charge', () => {
  const before = { food: 3000, producedAt: 60000 };
  assertIncome(before, { food: 3100, nextProductionAt: 180000 });
  assertIncome(before, { food: 2900, producedAt: 120000 }, 200);
  assert.throws(() => assertIncome(before, { food: 3200, producedAt: 120000 }));
  assert.throws(() => assertIncome(before, { food: 2700, producedAt: 120000 }, 200));
  assert.throws(() => assertIncome(before, { food: 3000, producedAt: 60001 }));
});

test('receipt identity and original result must survive a changing report', () => {
  const receipt = { sequence: 2, action: 'draw-hero', accepted: true, report: 'original' };
  assertReceipt({ ...receipt }, receipt);
  assert.throws(() => assertReceipt({ ...receipt, report: 'later battle' }, receipt));
  assert.throws(() => assertReceipt({ ...receipt, sequence: 3 }, receipt));
});

// 本测试的JSON codec只验证代理帧边界；生产夹具使用正式Rust protobuf解码。
// This JSON test codec checks proxy framing; the actual fixture uses the official Rust protobuf codec.
function frame(value) {
  const data = Buffer.from(JSON.stringify(value));
  const header = Buffer.alloc(4); header.writeUInt32BE(data.length);
  return Buffer.concat([header, data]);
}
async function fixture(t) {
  const received = [], sockets = new Set();
  const server = createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {});
    let buffer = Buffer.alloc(0);
    socket.on('data', bytes => {
      buffer = Buffer.concat([buffer, bytes]);
      while (buffer.length >= 4 && buffer.length >= 4 + buffer.readUInt32BE()) {
        const end = 4 + buffer.readUInt32BE();
        const request = JSON.parse(buffer.subarray(4, end)); buffer = buffer.subarray(end);
        received.push(request);
        socket.write(frame({ kind: 'response', rpcId: request.rpcId, error: request.error ?? null }));
      }
    });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const proxy = await faultProxy(server.address().port, async request => JSON.parse(Buffer.from(request.bytes)));
  const client = connect(proxy.port, '127.0.0.1'); client.on('error', () => {}); client.resume(); await once(client, 'connect');
  t.after(async () => { client.destroy(); await proxy.close(); for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); });
  return { client, proxy, received };
}

test('proxy decodes fragmented/coalesced frames and associates errors with the exact RPC', { timeout: 5000 }, async t => {
  const { client, proxy, received } = await fixture(t);
  const record = { namespace: 'slg.demo.player.v1', key: 'realm-41/alice' };
  proxy.arm('response', request => request?.rpcId === 2);
  const first = frame({ kind: 'load', rpcId: 1, records: [record] });
  client.write(first.subarray(0, 2));
  client.write(Buffer.concat([first.subarray(2), frame({ kind: 'commit', rpcId: 2, operationId: 'target', error: 3001 })]));
  await until(() => proxy.hit(), 'correlated response', 2000);
  assert.equal(received.length, 2);
  assert.equal(proxy.hit().request.operationId, 'target');
  assert.equal(proxy.hit().event.error, 3001);
  assert.equal(proxy.loads(record), 1);
  assert.equal(proxy.loads(record, proxy.events.length), 0);
  proxy.release();
});

test('reset discards a held pre-commit request; release cannot publish it later', { timeout: 5000 }, async t => {
  const { client, proxy, received } = await fixture(t);
  proxy.arm('request', request => request?.kind === 'commit');
  client.write(frame({ kind: 'commit', rpcId: 7 }));
  await until(() => proxy.hit(), 'held request', 2000);
  assert.equal(received.length, 0);
  const closed = once(client, 'close'); proxy.reset(); await closed;
  proxy.release();
  assert.equal(received.length, 0);
  assert.equal(proxy.hit(), undefined);
});

test('cooperative child cancellation preserves cleanup output', { timeout: 5000 }, async () => {
  await assert.rejects(command(process.execPath, ['-e', "process.on('message',m=>{if(m.action==='cancel'){console.log('cleanup-complete');process.disconnect();}})"], { timeout: 50, cooperative: true }), error => {
    assert.match(error.message, /cancellation/);
    assert.equal(error.stdout, 'cleanup-complete');
    return true;
  });
});

test('smoke30 freezes duration, coverage and single round without claiming the full matrix', () => {
  const plan = parse(['plan', '--profile', 'smoke30']);
  assert.deepEqual(plan.selected, smoke30); assert.equal(plan.durationMs, 1800000); assert.equal(plan.rounds, 1);
  assert.equal(plan.fullAcceptance, false); assert.deepEqual(plan.pendingCoverage, {});
  for (const option of ['--cases', '--rounds']) assert.throws(() => parse(['plan', '--profile', 'smoke30', option, '1']));
});

test('acceptance90 covers every implemented case with a budget and post-fault observation', () => {
  const plan = parse(['plan', '--profile', 'acceptance90']);
  assert.deepEqual(plan.selected, Object.keys(cases)); assert.equal(plan.rounds, 1);
  assert.equal(plan.durationMs, 5400000); assert.equal(plan.recoveryObservationMs, 180000);
  assert.equal(plan.fullAcceptance, false);
});
