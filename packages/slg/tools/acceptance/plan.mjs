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
  H1: 'paired publication under SLG traffic', H2a: 'code-only pair', H2b: 'configuration-only pair',
  H3: 'bounded requests during verified ingress pause', H4: 'drain budget rejection with original operation replay',
  H5a: 'generated configuration validation rejection', H5b: 'evaluation failure', H5c: 'pair integrity rejection', H5d: 'mid-install failure restores old methods and configuration',
  'H3-F1': 'disconnect during pause with original receipt replay', 'H3-F2': 'bounded ingress saturation with explicit failure', 'H3-F3': 'client timeout does not cancel committed work',
  H6: 'rollback preserves confirmed assets', H7a: 'deadline and minute boundary during successful drain',
  H7b: 'deadline and minute boundary during aborted drain', H8: 'ten same-process candidate attempts with continuous resource gates',
  H9a: 'Model incompatibility', H9b: 'protocol incompatibility', H9c: 'cold Model configuration incompatibility', H9d: 'Luban schema incompatibility',
  J1a: 'committed but DB ACK held during hotfix', J1b: 'pre-commit request held during hotfix',
  J2: 'restart with the applied startup pair', J3a: 'rollback and restart after client-unknown commit', J3b: 'rollback before client request delivery',
});
export const pendingCoverage = Object.freeze({});
export const smoke30 = Object.freeze(['A2', 'A3', 'B1', 'B3', 'B4', 'C', 'H1', 'H2a', 'H2b', 'H3', 'H4', 'H5c', 'H6', 'H7a', 'H7b', 'J1a', 'J1b', 'J2', 'J3a', 'J3b']);

/** 默认只计划；未知参数及缺确认在任何I/O之前拒绝。 / Plan by default; reject invalid arguments before any I/O. */
export function parse(args) {
  const action = args[0] ?? 'plan';
  if (!['plan', 'check', 'build', 'build-hotfix', 'run'].includes(action)) throw Error('unknown action');
  const options = new Map();
  for (let i = 1; i < args.length; i += 2) {
    if (!['--cases', '--rounds', '--confirm', '--profile'].includes(args[i]) || !args[i + 1] || options.has(args[i])) throw Error('invalid or duplicate option');
    options.set(args[i], args[i + 1]);
  }
  const profile = options.get('--profile') ?? 'matrix';
  if (!['matrix', 'smoke30', 'acceptance90'].includes(profile)) throw Error('unknown profile');
  if (profile !== 'matrix' && (options.has('--cases') || options.has('--rounds'))) throw Error('named profiles have fixed cases and one round');
  const selected = profile === 'smoke30' ? [...smoke30] : options.has('--cases') ? options.get('--cases').split(',') : Object.keys(cases);
  if (!selected.length || new Set(selected).size !== selected.length || selected.some(id => !Object.hasOwn(cases, id))) throw Error('unknown or duplicate case');
  const rounds = profile !== 'matrix' ? 1 : Number(options.get('--rounds') ?? 3);
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > 3) throw Error('rounds must be 1..3');
  if (action === 'run' && options.get('--confirm') !== confirmation) throw Error(`run requires --confirm ${confirmation}`);
  if (action !== 'run' && options.has('--confirm')) throw Error('confirmation only belongs to run');
  return { action, selected, rounds, profile, durationMs: profile === 'smoke30' ? 1800000 : profile === 'acceptance90' ? 5400000 : null, recoveryObservationMs: profile === 'acceptance90' ? 180000 : 0, pendingCoverage, players: 3, status: 'not-run',
    fullAcceptance: rounds === 3 && selected.length === Object.keys(cases).length, implementedMatrix: rounds === 3 && selected.length === Object.keys(cases).length,
    isolation: 'new environment per case and round; never reuse development databases',
    minimumRealWait: selected.includes('A2') ? 'five minutes per round, plus setup' : null };
}
