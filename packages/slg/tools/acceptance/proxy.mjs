import assert from 'node:assert/strict';
import { createServer, connect } from 'node:net';

/** 正式Rust codec解码；按连接和rpcId关联故障，不记录Hello密钥。 / Decode through the official codec and correlate by connection/rpcId. */
export async function faultProxy(upstreamPort, decode) {
  const sockets = new Set(), events = [];
  let rule, hit, held = [], serial = 0, failure;
  const server = createServer(down => {
    const connection = ++serial, pending = new Map();
    const up = connect(upstreamPort, '127.0.0.1');
    sockets.add(down); sockets.add(up);
    for (const socket of [down, up]) {
      socket.on('error', () => {});
      socket.on('close', () => { sockets.delete(socket); down.destroy(); up.destroy(); });
    }
    for (const [socket, target, direction] of [[down, up, 'request'], [up, down, 'response']]) {
      let buffer = Buffer.alloc(0), chain = Promise.resolve(), queuedBytes = 0;
      socket.on('data', bytes => {
        buffer = Buffer.concat([buffer, bytes]);
        if (buffer.length > 16 * 1024 * 1024) { failure = Error('proxy buffer bound exceeded'); socket.destroy(); return; }
        while (buffer.length >= 4) {
          const length = buffer.readUInt32BE();
          if (length > 8388608) { failure = Error('frame bound exceeded'); socket.destroy(); return; }
          if (buffer.length < length + 4) break;
          const frame = Buffer.from(buffer.subarray(0, length + 4)); buffer = buffer.subarray(length + 4);
          queuedBytes += frame.length;
          if (queuedBytes > 16 * 1024 * 1024) { failure = Error('decode queue bound exceeded'); socket.destroy(); return; }
          chain = chain.then(async () => {
            const value = await decode({ command: 'decode', direction, bytes: [...frame.subarray(4)] });
            const event = { ...value, direction, connection, at: Date.now() };
            if (direction === 'request' && value.rpcId !== undefined) pending.set(value.rpcId, value);
            if (pending.size > 1000) throw Error('pending requests bound exceeded');
            const request = direction === 'request' ? value : pending.get(value.rpcId);
            if (direction === 'response') pending.delete(value.rpcId);
            events.push(event);
            if (events.length > 10000) throw Error('proxy evidence bound exceeded');
            if (rule && !hit && rule.direction === direction && rule.match(request, value)) {
              hit = { event, request }; held.push(() => target.write(frame)); return;
            }
            target.write(frame);
          }).catch(error => { failure = error; down.destroy(); up.destroy(); }).finally(() => { queuedBytes -= frame.length; });
        }
      });
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { port: server.address().port, events,
    arm(direction, match) { assert.ok(!rule); rule = { direction, match }; hit = undefined; },
    hit() { if (failure) throw failure; return hit; },
    release() { const pending = held; held = []; rule = undefined; pending.forEach(send => send()); },
    reset() { held = []; rule = undefined; hit = undefined; for (const socket of sockets) socket.destroy(); },
    disconnect() { for (const socket of sockets) socket.destroy(); },
    loads(record, since = 0) { if (failure) throw failure; return events.slice(since).filter(e => e.direction === 'request' && ['load', 'load_multi'].includes(e.kind) && e.records?.some(r => r.namespace === record.namespace && r.key === record.key)).length; },
    async close() { rule = undefined; held = []; for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); if (failure) throw failure; },
  };
}
