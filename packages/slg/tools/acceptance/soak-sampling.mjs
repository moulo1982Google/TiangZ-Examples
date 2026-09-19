import assert from 'node:assert/strict';
import { idle } from './hotfix-resources.mjs';

/** 等待两个不同发布周期的空闲快照；旧快照和忙样本保留为证据，不静默丢失采样名额。 / Await two distinct idle publications; retain stale and busy observations instead of silently losing a sampling slot. */
export async function settledResourceSample({ read, wait, observe, timeoutMs = 60000, now = () => performance.now() }) {
  const began = now(); let firstPublication, lastPublication, consecutive = 0;
  while (now() - began < timeoutMs) {
    const value = await read();
    assert.ok(Number.isFinite(value.publishedAt), 'missing resource publication timestamp');
    firstPublication ??= value.publishedAt;
    const fresh = value.publishedAt > firstPublication && value.publishedAt > (lastPublication ?? -Infinity);
    await observe({ ...value, fresh, idle: idle(value.sample), waitedMs: now() - began });
    if (fresh) {
      consecutive = idle(value.sample) ? consecutive + 1 : 0;
      lastPublication = value.publishedAt;
      if (consecutive >= 2) return { ...value, waitedMs: now() - began };
    }
    await wait(Math.min(500, Math.max(0, timeoutMs - (now() - began))));
  }
  throw Error(`resource sample did not settle within ${timeoutMs}ms`);
}

/** 提前拒绝已经无法满足数量的观察窗口，不能等八小时结束才发现缺样。 / Reject an unattainable sample target during the window rather than only at the end of the run. */
export function samplingProgress(collected, required, nextAt, endAt, intervalMs) {
  const remainingSlots = Math.max(0, Math.ceil((endAt - nextAt) / intervalMs));
  assert.ok(collected + remainingSlots >= required, `insufficient remaining recovery slots: collected=${collected}, remaining=${remainingSlots}, required=${required}`);
  return { collected, required, remainingSlots };
}

/** 全部恢复期样本必须达到原定数量并来自同一进程。 / Recovery samples must meet the original count and share one process identity. */
export function requireRecoverySamples(samples, required = 20) {
  assert.ok(samples.length >= required, `insufficient recovery samples: ${samples.length}/${required}`);
  assert.ok(samples.every(s => idle(s) && s.pid === samples[0].pid), 'recovery samples must be idle in the same process');
}
