import { test } from "node:test";
import assert from "node:assert/strict";
import { apply, newPlayer, newWorld, settle } from "../modules/slg/src/hotfix/Gameplay.ts";
const fresh = () => ({ player: newPlayer("alice", 1000), world: newWorld() });
const command = (sequence, action, target = 0, amount = 0) => ({ player: "alice", sequence, action, target, amount });
test("income uses complete minutes and never double pays after restore", () => {
  const state = fresh(); settle(state, 60999); assert.equal(state.player.food, 3000);
  settle(state, 61000); assert.equal(state.player.food, 3100);
  const restored = JSON.parse(JSON.stringify(state)); settle(restored, 181000); settle(restored, 181000);
  assert.equal(restored.player.food, 3300); settle(restored, 500); assert.equal(restored.player.food, 3300);
});
test("building payment is once and completion uses persisted deadline", () => {
  const state = fresh(), input = command(1, "upgrade-building", 1);
  apply(state, input, 1000, 0); apply(state, input, 9000, 0);
  assert.equal(state.player.food, 2800); assert.equal(state.player.buildings[0].dueAt, 11000);
  assert.throws(() => apply(state, command(2, "upgrade-building", 1), 2000, 0));
  settle(state, 11000); settle(state, 12000); assert.equal(state.player.buildings[0].level, 2);
});
test("draw tiers, duplicate cards and replay have explicit outcomes", () => {
  for (const [roll, hero] of [[0, 1], [0.599, 1], [0.6, 2], [0.9, 3], [0.999, 3]]) {
    const state = fresh(); apply(state, command(1, "draw-hero"), 1000, roll);
    apply(state, command(1, "draw-hero"), 1000, 0.1);
    assert.equal(state.player.food, 2700); assert.equal(state.player.heroes.reduce((sum, h) => sum + h.copies, 0), 2);
    assert.ok(state.player.heroes.some(h => h.id === hero));
  }
});
test("hero upgrade and recruit consume food with limits", () => {
  const state = fresh(); apply(state, command(1, "upgrade-hero", 1), 1000, 0);
  apply(state, command(2, "recruit", 0, 20), 1000, 0);
  assert.equal(state.player.heroes[0].level, 2); assert.equal(state.player.troops, 120); assert.equal(state.player.food, 2700);
  assert.throws(() => apply(state, command(3, "recruit", 0, 0), 1000, 0));
  assert.throws(() => apply(state, command(3, "upgrade-hero", 999), 1000, 0));
});
test("march reserves neutral land and recovers a winning settlement once", () => {
  const state = fresh(); apply(state, command(1, "march", 2, 1), 1000, 0);
  assert.equal(state.player.troops, 80); assert.equal(state.world.tiles[0].reservedBy, "alice");
  const rival = { player: newPlayer("bob", 1000), world: state.world };
  assert.throws(() => apply(rival, { ...command(1, "march", 2, 1), player: "bob" }, 1000, 0));
  const restored = JSON.parse(JSON.stringify(state)); settle(restored, 11000); settle(restored, 12000);
  assert.equal(restored.player.troops, 98); assert.equal(restored.world.tiles[0].owner, "alice"); assert.equal(restored.player.march, null);
});
test("loss does not grant land; hero cannot upgrade during march", () => {
  const state = fresh(); apply(state, command(1, "march", 4, 1), 1000, 0);
  assert.throws(() => apply(state, command(2, "upgrade-hero", 1), 1000, 0));
  settle(state, 11000); assert.equal(state.world.tiles[2].owner, ""); assert.equal(state.player.troops, 90);
});
test("bad sequence and changed replay cannot spend; insufficient food fails", () => {
  const state = fresh(); assert.throws(() => apply(state, command(2, "draw-hero"), 1000, 0));
  apply(state, command(1, "draw-hero"), 1000, 0);
  assert.throws(() => apply(state, command(1, "upgrade-building", 1), 1000, 0));
  state.player.food = 0; assert.throws(() => apply(state, command(2, "draw-hero"), 1000, 0));
  assert.equal(state.player.food, 0);
});
