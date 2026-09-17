// 有界分页，拒绝游标不前进；COUNT限制单次响应，截止时间限制持续增长的Stream。
export function* streamPages(read, { count = 256, deadlineMs = 180000 } = {}) {
  const deadline = Date.now() + deadlineMs;
  let last;
  const compare = (a, b) => {
    const [am, as] = a.split('-').map(BigInt), [bm, bs] = b.split('-').map(BigInt);
    return am > bm || (am === bm && as > bs);
  };
  while (true) {
    if (Date.now() > deadline) throw Error('Stream pagination deadline exceeded');
    const page = read(last ? `(${last}` : '-', '+', count);
    if (!Array.isArray(page) || page.length > count) throw Error('invalid Stream page');
    if (!page.length) return;
    for (const entry of page) {
      if (!Array.isArray(entry) || !/^\d+-\d+$/.test(entry[0]) || !Array.isArray(entry[1]) || entry[1].length % 2) throw Error('invalid Stream entry');
      if (last && !compare(entry[0], last)) throw Error('Stream cursor did not advance');
      last = entry[0];
      yield entry;
    }
  }
}

// 不保存命令全文、环境、stdout/stderr，避免认证信息进入最终报告。
export function commandFailure(error) {
  return { name: error.name, code: error.code ?? null, status: error.status ?? null,
    signal: error.signal ?? null, stderrBytes: Buffer.byteLength(error.stderr ?? ''),
    at: new Date().toISOString() };
}
