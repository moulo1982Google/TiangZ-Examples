import assert from "node:assert/strict";
import { SlgConnection } from "../client/cocos/assets/scripts/SlgConnection";

/** 真实连接独立测试进程，不使用模拟响应。 */
export async function verify(ensureRunning: () => void, port = 18001): Promise<void> {
  const deadline = Date.now() + 25_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    ensureRunning();
    let connection = new SlgConnection("127.0.0.1", port);
    const pump = setInterval(() => connection.update(), 10);
    try {
      const snapshot = await connection.snapshot();
      assert.equal(snapshot.worldName, "边境原野");
      assert.equal(snapshot.width, 12);
      assert.equal(snapshot.height, 8);
      assert.equal(snapshot.sites.length, 4);
      assert.equal(new Set(snapshot.sites.map(site => site.id)).size, 4);
      assert.equal(snapshot.sites.filter(site => site.kind === "city").length, 1);
      for (const site of snapshot.sites) { assert.ok(site.x < snapshot.width); assert.ok(site.y < snapshot.height); }
      assert.deepEqual((await connection.snapshot()).sites, snapshot.sites);
      const player = "smoke_player";
      const call = async (sequence: number, action: string, target = 0, amount = 0) => {
        let last: unknown;
        for (let attempt = 0; attempt < 20; attempt++) {
          try { return await connection.game({ player, sequence, action, target, amount }); }
          catch (error) { last = error; await new Promise(resolve => setTimeout(resolve, 100)); }
        }
        throw last;
      };
      const initial = await call(0, "snapshot"); assert.equal(initial.persisted, false); assert.equal(initial.food, 3000);
      const upgraded = await call(1, "upgrade-building", 1);
      assert.equal(upgraded.food, 2800); assert.equal((await call(1, "upgrade-building", 1)).food, 2800);
      const drawn = await call(2, "draw-hero"); assert.equal(drawn.heroes.reduce((sum, hero) => sum + hero.copies, 0), 2);
      assert.equal(drawn.receipt?.sequence, 2); assert.ok(drawn.receipt!.heroId > 0);
      const leveled = await call(3, "upgrade-hero", 1); assert.equal(leveled.heroes[0]!.level, 2);
      const marching = await call(4, "march", 2, 1); assert.equal(marching.marches.length, 1); assert.equal(marching.troops, 80);
      const rejected = await call(5, "march", 3, 1); assert.equal(rejected.food, marching.food); assert.match(rejected.report, /操作未执行/);
      assert.equal(rejected.receipt?.accepted, false);
      connection.close();
      // 模拟后台没有玩家请求；测试夹具可以等待时间，业务不可以。
      await new Promise(resolve => setTimeout(resolve, 11000));
      connection = new SlgConnection("127.0.0.1", port);
      await connection.snapshot();
      const replay = await call(5, "march", 3, 1);
      assert.deepEqual(replay.receipt, rejected.receipt);
      const end = Date.now() + 15000;
      while (true) {
        const current = await call(0, "snapshot");
        if (!current.marches.length) { assert.equal(current.tiles.find(tile => tile.id === 2)!.owner, player); assert.equal(current.troops, 98); assert.equal(current.buildings[0]!.level, 2); break; }
        assert.ok(Date.now() < end, "行军到期未结算");
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      console.log("[SLG] 建筑升级、武将招募/升级、行军占地、回执及断开11秒重连通过；本轮内存模式，不代表数据库恢复或小程序真机验收。");
      console.log("[SLG] 服务端快照：城池、林地、农田、矿场；重复 RPC 一致");
      return;
    } catch (error) {
      if (error instanceof assert.AssertionError) throw error;
      lastError = error;
    } finally {
      clearInterval(pump);
      connection.close();
    }
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  throw new Error(`SLG 联调超时：${String(lastError)}`);
}
