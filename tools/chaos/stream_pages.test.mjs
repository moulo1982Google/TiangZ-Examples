import { test } from 'node:test';
import assert from 'node:assert/strict';
import { streamPages, commandFailure } from './stream_pages.mjs';
test('pagination preserves duplicate business events across exclusive page boundaries', () => {
  const calls = [];
  const pages = [[['9007199254740993-0', ['event_id', 'a']], ['9007199254740993-1', ['event_id', 'a']]], [['9007199254740994-0', ['event_id', 'b']]], []];
  const result = [...streamPages((start, end, count) => { calls.push([start, end, count]); return pages.shift(); }, { count: 2 })];
  assert.equal(result.length, 3);
  assert.deepEqual(calls.map(x => x[0]), ['-', '(9007199254740993-1', '(9007199254740994-0']);
});
test('stuck cursor, malformed data and read failures cannot pass', () => {
  assert.throws(() => [...streamPages(() => [['1-0', []]])], /advance/);
  assert.throws(() => [...streamPages(() => [['bad', []]])], /invalid/);
  assert.throws(() => [...streamPages(() => { throw Error('read failed'); })], /read failed/);
});
test('failure diagnostics retain exit details without command or credential output', () => {
  const result = commandFailure(Object.assign(Error('secret'), { code: 'ENOBUFS', status: 1, signal: 'SIGTERM', stderr: 'secret' }));
  assert.equal(result.code, 'ENOBUFS'); assert.equal(result.status, 1);
  assert.equal(JSON.stringify(result).includes('secret'), false);
});
