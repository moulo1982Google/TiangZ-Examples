import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(new URL('../../../../TiangZ/package.json', import.meta.url));
const result = await require('esbuild').build({ entryPoints: [fileURLToPath(new URL('../client/cocos/assets/scripts/SlgBootstrap.ts', import.meta.url))],
  bundle: true, write: false, format: 'esm', platform: 'node', plugins: [{ name: 'fake-cocos', setup(ctx) {
    ctx.onResolve({ filter: /^(cc|\.\/SlgConnection)$/ }, args => ({ path: args.path, namespace: 'fake' }));
    ctx.onLoad({ filter: /.*/, namespace: 'fake' }, args => ({ contents: args.path === 'cc' ? `
      export const _decorator={ccclass:()=>target=>target,property:()=>{}};
      export class Component {}
      export const Camera={},Canvas={},Color=class{},Graphics={},Label={},Layers={},Node={},ResolutionPolicy={},UITransform={},view={};
      export const sys={localStorage:{getItem:key=>globalThis.__slgUi.storage.get(key),setItem:(key,v)=>globalThis.__slgUi.storage.set(key,v),removeItem:key=>globalThis.__slgUi.storage.delete(key)}};
      export const game={on(){},off(){}}; export const Game={EVENT_HIDE:'hide',EVENT_SHOW:'show'};
    ` : `export class SlgConnection {
      constructor(){globalThis.__slgUi.connections.push(this);this.closed=false;}
      snapshot(){return globalThis.__slgUi.snapshot();}
      game(request){globalThis.__slgUi.requests.push(structuredClone(request));return globalThis.__slgUi.game(request);}
      update(){} close(){this.closed=true;}
    }` }));
  } }] });
const { SlgBootstrap } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
function fixture() {
  const control = globalThis.__slgUi = { storage: new Map(), requests: [], connections: [], snapshot: async () => ({ worldName: 'test', sites: [] }), game: async () => ({ sequence: 0 }) };
  const ui = new SlgBootstrap(); ui.player = 'alice'; ui.status = { string: '' }; ui.draw = () => {}; ui.showGame = value => { ui.gameState = value; };
  return { ui, control };
}
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
test('foreground replaces connection and retrieves a complete player snapshot even if socket looked alive', async () => {
  const { ui, control } = fixture(); await ui.refresh(); const first = control.connections[0];
  ui.onBackground(); assert.equal(first.closed, true); assert.equal(ui.gameState, undefined);
  ui.onForeground(); await flush(); assert.equal(control.connections.length, 2);
  assert.equal(control.requests.length, 2); assert.equal(control.requests[1].action, 'snapshot');
  ui.onDestroy();
});
test('unconfirmed command survives background and is cleared only by matching receipt', async () => {
  const { ui, control } = fixture();
  const pending = { player: 'alice', sequence: 1, action: 'draw-hero', target: 0, amount: 0 };
  ui.pending = pending; control.storage.set('slg.demo.pending.alice', JSON.stringify(pending));
  control.game = async () => ({ sequence: 1, receipt: { sequence: 1, fingerprint: '["draw-hero",0,0]', accepted: true, heroId: 3 } });
  ui.onBackground(); assert.deepEqual(ui.pending, pending); ui.onForeground(); await flush();
  assert.deepEqual(control.requests[0], pending); assert.equal(ui.pending, undefined); assert.equal(control.storage.size, 0);
  ui.onDestroy();
});
test('old callback cannot clear pending or release the new connection busy state', async () => {
  const { ui, control } = fixture(); let finishOld, finishNew;
  control.game = () => new Promise(resolve => { finishOld = resolve; });
  const old = ui.refresh(); await flush(); ui.onBackground();
  control.game = () => new Promise(resolve => { finishNew = resolve; });
  ui.onForeground(); await flush(); assert.equal(ui.busy, true);
  finishOld({ sequence: 99 }); await old; assert.equal(ui.busy, true); assert.equal(ui.gameState, undefined);
  finishNew({ sequence: 0 }); await flush(); assert.equal(ui.busy, false); assert.equal(ui.gameState.sequence, 0); ui.onDestroy();
});
test('mismatching receipt cannot erase the saved operation', async () => {
  const { ui, control } = fixture(); ui.pending = { player: 'alice', sequence: 1, action: 'draw-hero', target: 0, amount: 0 };
  control.game = async () => ({ sequence: 2, receipt: { sequence: 2, fingerprint: 'different' } });
  await ui.refresh(); assert.ok(ui.pending); assert.match(ui.status.string, /回执不匹配/); ui.onDestroy();
});
