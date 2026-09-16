import assert from "node:assert/strict";
import { SlgConnection } from "../client/cocos/assets/scripts/SlgConnection";

/** 真实连接独立测试进程，不使用模拟响应。 */
export async function verify(ensureRunning: () => void, port = 18001): Promise<void> {
  const deadline = Date.now() + 25_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    ensureRunning();
    const connection = new SlgConnection("127.0.0.1", port);
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
