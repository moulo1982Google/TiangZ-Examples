export const confirmation = 'isolated-slg-authoritative-test';
export const cases = Object.freeze({
  A1: 'retained reconnect without storage loads', A2: 'real five-minute residency expiry',
  A3: 'cold recovery with an old positive cache', A4: 'cold recovery with negative cache',
  A5: 'offline deadlines after eviction using a separately built short-TTL fixture',
  B1: 'committed write during cache write timeout', B2: 'cold recovery during cache outage',
  B3: 'primary unavailable must not fall back to cache', B4: 'DBProxy A kill, B failover and A restart',
  B5: 'cache restart and old cache restoration', B6: 'old cache repair cannot overwrite newer revision',
  C: 'seven game crash scenarios with receipts and time-aware reconciliation',
  D1: 'concurrent atomic batch snapshot probe', D2: 'single cached read fences', D3: 'batch cached read fences',
  D4: 'peer restart fences and namespace guard', D5: 'legacy/current handshake compatibility',
});

/** 默认只计划；未知参数及缺确认在任何I/O之前拒绝。 / Plan by default; reject invalid arguments before any I/O. */
export function parse(args) {
  const action = args[0] ?? 'plan';
  if (!['plan', 'check', 'build', 'run'].includes(action)) throw Error('unknown action');
  const options = new Map();
  for (let i = 1; i < args.length; i += 2) {
    if (!['--cases', '--rounds', '--confirm'].includes(args[i]) || !args[i + 1] || options.has(args[i])) throw Error('invalid or duplicate option');
    options.set(args[i], args[i + 1]);
  }
  const selected = options.has('--cases') ? options.get('--cases').split(',') : Object.keys(cases);
  if (!selected.length || new Set(selected).size !== selected.length || selected.some(id => !Object.hasOwn(cases, id))) throw Error('unknown or duplicate case');
  const rounds = Number(options.get('--rounds') ?? 3);
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > 3) throw Error('rounds must be 1..3');
  if (action === 'run' && options.get('--confirm') !== confirmation) throw Error(`run requires --confirm ${confirmation}`);
  if (action !== 'run' && options.has('--confirm')) throw Error('confirmation only belongs to run');
  return { action, selected, rounds, players: 3, status: 'not-run',
    fullAcceptance: rounds === 3 && selected.length === Object.keys(cases).length,
    isolation: 'new environment per case and round; never reuse development databases',
    minimumRealWait: selected.includes('A2') ? 'five minutes per round, plus setup' : null };
}
