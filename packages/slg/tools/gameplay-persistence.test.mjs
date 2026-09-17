import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const requireEngine = createRequire(new URL("../../../../TiangZ/package.json", import.meta.url));
const { build } = requireEngine("esbuild");
const result = await build({ entryPoints: [fileURLToPath(new URL("../modules/slg/src/hotfix/SlgGameSystem.ts", import.meta.url))], bundle: true, write: false, format: "esm", platform: "node", plugins: [{ name: "fake-host", setup(context) {
  context.onResolve({ filter: /^#tiangz\// }, args => ({ path: args.path, namespace: "fake" }));
  context.onLoad({ filter: /.*/, namespace: "fake" }, args => ({ contents: args.path === "#tiangz/model" ? `
    export const systemFor=()=>target=>target;
    export const IsVersionedEntityRevisionConflict=error=>error.code==='conflict';
    export const utf8Encode=text=>new TextEncoder().encode(text);
    export const utf8Decode=bytes=>new TextDecoder().decode(bytes);
  ` : `export class SlgGameComponent {
    durable=true; startupRetries=0; IsDisposed=false; activePlayers=new Set(); memoryPlayers=new Map(); memoryWorld;
    settings={keepAliveMs:300000,maxResidents:32,maxPlayers:32,retryDelayMs:1000,maxTimerRetries:5};
    residents=new Map(); playerBusy=new Set(); pendingPlayers=new Map(); world; worldRevision=0n;
    worldBusy; worldPending; initialized=false; initializing; deadlines=new Map(); playerTimers=new Map(); timerRetries=new Map();
    nextTimer=0; NewOnceTimer(){return ++this.nextTimer;} CancelTimer(){}
  }` }));
} }] });
const { SlgGameSystem } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
const serialize = value => JSON.stringify(value, (_, item) => typeof item === "bigint" ? `${item}n` : item);
class Store {
  rows = new Map(); receipts = new Map(); applied = 0; loads = 0; commits = []; failBefore = false; failAfter = false;
  key(record) { return record.namespace + "/" + record.key; }
  async Load(record) { this.loads++; const row = this.rows.get(this.key(record)); return row && structuredClone(row); }
  async CommitRecords(commit) {
    this.commits.push(structuredClone(commit));
    const fingerprint = serialize(commit);
    if (this.receipts.has(commit.operationId)) { assert.equal(this.receipts.get(commit.operationId), fingerprint, "retry must preserve all original fields"); return; }
    if (this.failBefore) { this.failBefore = false; throw Error("transport unavailable before commit"); }
    for (const write of commit.writes) if ((this.rows.get(this.key(write.record))?.revision ?? 0n) !== write.expectedRevision) throw Object.assign(Error("CAS conflict"), { code: "conflict" });
    for (const write of commit.writes) this.rows.set(this.key(write.record), { ...structuredClone(write), revision: write.expectedRevision + 1n });
    this.receipts.set(commit.operationId, fingerprint); this.applied++;
    if (this.failAfter) { this.failAfter = false; throw Error("ACK lost after commit"); }
  }
}
const host = store => Object.assign(new SlgGameSystem(), { records: store });
const request = (action = "snapshot", sequence = 0, target = 0, amount = 0) => ({ player: "alice", action, sequence, target, amount });
test("lost commit ACK retries immutable request and does not charge twice", async () => {
  const store = new Store(), game = host(store); await game.Execute(request());
  store.failAfter = true; await assert.rejects(game.Execute(request("draw-hero", 1)));
  assert.ok(game.pendingPlayers.has("alice")); const recovered = await game.Execute(request("draw-hero", 1));
  assert.equal(recovered.food, 2700); assert.equal(recovered.heroes.reduce((sum, h) => sum + h.copies, 0), 2); assert.equal(store.applied, 2);
});
test("new owner after crash reloads committed receipt sequence", async () => {
  const store = new Store(), old = host(store); await old.Execute(request()); store.failAfter = true;
  await assert.rejects(old.Execute(request("upgrade-building", 1, 1)));
  const restarted = host(store), recovered = await restarted.Execute(request("upgrade-building", 1, 1));
  assert.equal(recovered.food, 2800); assert.equal(recovered.sequence, 1); assert.equal(store.applied, 2);
});
test("storage outage never falls back to memory and safely retries", async () => {
  const store = new Store(), game = host(store); store.failBefore = true;
  await assert.rejects(game.Execute(request())); assert.equal(game.memoryPlayers.size, 0); assert.equal(store.rows.size, 0);
  const state = await game.Execute(request()); assert.equal(state.persisted, true); assert.equal(state.food, 3000); assert.equal(store.rows.size, 2);
});
test("concurrent same-player commands use CAS to avoid a double draw", async () => {
  const store = new Store(), a = host(store), b = host(store); await a.Execute(request());
  await Promise.allSettled([a.Execute(request("draw-hero", 1)), b.Execute(request("draw-hero", 1))]);
  const state = await host(store).Execute(request()); assert.equal(state.food, 2700); assert.equal(state.sequence, 1); assert.equal(store.applied, 2);
});
test("business rejection consumes identity but not resources", async () => {
  const store = new Store(), game = host(store); await game.Execute(request());
  const state = await game.Execute(request("upgrade-hero", 1, 99));
  assert.equal(state.sequence, 1); assert.equal(state.food, 3000); assert.match(state.report, /操作未执行/);
  assert.equal((await game.Execute(request("upgrade-hero", 1, 99))).food, 3000);
});
test("unknown schema is rejected rather than reset to starter assets", async () => {
  const store = new Store(), game = host(store); await game.Execute(request());
  for (const row of store.rows.values()) row.schemaVersion = 999;
  await assert.rejects(host(store).Execute(request()), /版本不兼容/); assert.equal(store.applied, 1);
});
test("competing players cannot reserve the same tile or lose troops on failed CAS", async () => {
  const store = new Store(), a = host(store), b = host(store);
  await a.Execute(request()); await b.Execute({ ...request(), player: "bob" });
  await Promise.allSettled([a.Execute(request("march", 1, 2, 1)), b.Execute({ ...request("march", 1, 2, 1), player: "bob" })]);
  const alice = await host(store).Execute(request()), bob = await host(store).Execute({ ...request(), player: "bob" });
  assert.equal(alice.marches.length + bob.marches.length, 1);
  assert.equal(alice.troops + bob.troops, 180); assert.equal(alice.food + bob.food, 5900);
});
test("timer reloads persisted player registry and settles offline production once", async () => {
  const store = new Store(); await host(store).Execute(request());
  const key = "slg.demo.player.v1/realm-41/alice", row = store.rows.get(key);
  const value = JSON.parse(new TextDecoder().decode(row.payload)); value.producedAt = Date.now() - 120000;
  row.payload = new TextEncoder().encode(JSON.stringify(value));
  const restarted = host(store); await restarted.Tick(); await restarted.Tick();
  assert.ok(restarted.activePlayers.has("alice")); assert.equal((await restarted.Execute(request())).food, 3200);
});

test("resident snapshots never Load; player-only changes never write world", async () => {
  const store = new Store(), game = host(store); await game.Execute(request());
  const loads = store.loads, worldRev = game.worldRevision;
  await game.Execute(request()); await game.Execute(request("draw-hero", 1));
  await game.Execute(request("upgrade-building", 2, 1));
  assert.equal(store.loads, loads); assert.equal(game.worldRevision, worldRev);
  assert.deepEqual(store.commits.slice(1).map(c => c.writes.length), [1, 1]);
});

test("keepalive expiry reloads player once and preserves committed assets", async t => {
  let now = 1000000; t.mock.method(Date, "now", () => now);
  const store = new Store(), game = host(store); game.settings.keepAliveMs = 5000;
  await game.Execute(request()); await game.Execute(request("draw-hero", 1));
  const loads = store.loads;
  now += 4999; await game.Execute(request()); assert.equal(store.loads, loads);
  now += 5001; await game.OnPlayerDue("alice"); assert.equal(game.residents.size, 0);
  const restored = await game.Execute(request()); assert.equal(store.loads, loads + 1); assert.equal(restored.food, 2700);
});

test("offline march survives cache eviction and settles without a foreground request", async t => {
  let now = 1000000; t.mock.method(Date, "now", () => now);
  const store = new Store(), game = host(store); game.settings.keepAliveMs = 1000;
  await game.Execute(request()); await game.Execute(request("march", 1, 2, 1));
  now += 1001; await game.OnPlayerDue("alice"); assert.equal(game.residents.size, 0); assert.ok(game.deadlines.has("alice"));
  now += 9000; await game.OnPlayerDue("alice");
  const saved = JSON.parse(new TextDecoder().decode(store.rows.get("slg.demo.player.v1/realm-41/alice").payload));
  assert.equal(saved.march, null); assert.equal(saved.troops, 98); assert.equal(game.world.tiles[0].owner, "alice");
  assert.equal(game.residents.size, 0); assert.equal(game.deadlines.has("alice"), false);
});

test("restart rebuilds building and march deadlines before any player reconnects", async t => {
  let now = 1000000; t.mock.method(Date, "now", () => now);
  const store = new Store(), old = host(store);
  await old.Execute(request()); await old.Execute(request("upgrade-building", 1, 1)); await old.Execute(request("march", 2, 2, 1));
  const game = host(store); await game.Tick(); assert.equal(game.residents.size, 0); assert.ok(game.playerTimers.has("alice"));
  now += 10000; await game.OnPlayerDue("alice");
  const saved = JSON.parse(new TextDecoder().decode(store.rows.get("slg.demo.player.v1/realm-41/alice").payload));
  assert.equal(saved.buildings[0].level, 2); assert.equal(saved.march, null);
});

test("draw receipt survives lost ACK, battle report and process restart", async t => {
  let now = 1000000; t.mock.method(Date, "now", () => now);
  const store = new Store(), old = host(store); await old.Execute(request()); await old.Execute(request("march", 1, 2, 1));
  store.failAfter = true; await assert.rejects(old.Execute(request("draw-hero", 2)));
  const game = host(store); await game.Tick(); now += 10000; await game.OnPlayerDue("alice");
  const state = await game.Execute(request("draw-hero", 2));
  assert.match(state.report, /地块/); assert.match(state.receipt.message, /招募获得/);
  assert.equal(state.receipt.sequence, 2); assert.ok(state.receipt.heroId > 0);
  assert.equal(state.food, 2600); assert.equal(state.heroes.reduce((n, h) => n + h.copies, 0), 2);
});

test("a slow player commit does not block another player's confirmed operation", async () => {
  const store = new Store(), game = host(store); await game.Execute(request()); await game.Execute({ ...request(), player: "bob" });
  const original = store.CommitRecords.bind(store); let release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  store.CommitRecords = async commit => {
    if (commit.writes[0].record.key.endsWith("/alice")) { entered(); await new Promise(resolve => { release = resolve; }); }
    return original(commit);
  };
  const alice = game.Execute(request("draw-hero", 1)); await started;
  try {
    const bob = await game.Execute({ ...request("draw-hero", 1), player: "bob" });
    assert.equal(bob.food, 2700);
    await assert.rejects(game.Execute(request()), /正在结算/);
  } finally { release(); await alice; }
});

test("unrelated pending snapshot cannot overwrite a newer world mutation", async () => {
  const store = new Store(), game = host(store); await game.Execute(request()); await game.Execute({ ...request(), player: "bob" });
  store.failAfter = true; await assert.rejects(game.Execute(request("draw-hero", 1)));
  await game.Execute({ ...request("march", 1, 2, 1), player: "bob" });
  const state = await game.Execute(request("draw-hero", 1)); assert.equal(state.tiles[0].reservedBy, "bob");
});

test("unknown world transaction blocks other map changes, not other player-only changes", async () => {
  const store = new Store(), game = host(store); await game.Execute(request()); await game.Execute({ ...request(), player: "bob" });
  store.failAfter = true; await assert.rejects(game.Execute(request("march", 1, 2, 1)));
  await assert.rejects(game.Execute({ ...request("march", 1, 3, 1), player: "bob" }), /地图正在结算/);
  const bob = await game.Execute({ ...request("draw-hero", 1), player: "bob" }); assert.equal(bob.food, 2700);
  await game.Execute(request("march", 1, 2, 1)); assert.equal(game.worldPending, undefined);
});

test("missing registered player fails closed, not a new account", async () => {
  const store = new Store(); await host(store).Execute(request()); store.rows.delete("slg.demo.player.v1/realm-41/alice");
  await assert.rejects(host(store).Execute(request()), /存档缺失/); assert.equal(store.applied, 1);
});

test("capacity rejects active eviction and timer failures stop after bounded retries", async t => {
  let now = 1000000; t.mock.method(Date, "now", () => now);
  const store = new Store(), game = host(store); game.settings.maxResidents = 1;
  await game.Execute(request());
  await assert.rejects(game.Execute({ ...request(), player: "bob" }), /驻留容量/);
  store.failBefore = true; await assert.rejects(game.Execute(request("draw-hero", 1)));
  now += 300001;
  const original = store.CommitRecords.bind(store); store.CommitRecords = async () => { throw Error("offline"); };
  for (let i = 0; i < 5; i++) await assert.rejects(game.OnPlayerDue("alice"), /offline/);
  assert.ok(game.pendingPlayers.has("alice")); assert.ok(game.residents.has("alice")); assert.equal(game.playerTimers.has("alice"), false);
  store.CommitRecords = original;
  const restored = await game.Execute(request("draw-hero", 1)); assert.equal(restored.receipt.sequence, 1);
});
