import type { GameCommand, GameState, PlayerState, WorldState } from "#tiangz/module";

/** 创建开发角色；初始粮食只在首次持久创建时发放。 / Initial food is granted only upon first durable creation. */
export function newPlayer(id: string, now: number): PlayerState {
  return { id, food: 3000, troops: 100, producedAt: now, sequence: 0, fingerprint: "", report: "欢迎来到边境原野", march: null,
    buildings: ["主城", "农田", "兵营"].map((name, index) => ({ id: index + 1, name, level: 1, dueAt: 0 })),
    heroes: [{ id: 1, name: "边军校尉", level: 1, copies: 1 }] };
}
/** 世界不拥有玩家资产；空地初始无占领和预订。 / World holds no player assets; tiles start unowned and unreserved. */
export function newWorld(): WorldState { return { players: [], tiles: [2, 3, 4].map(id => ({ id, owner: "", reservedBy: "" })) }; }

/** 按持久截止时间补算整分钟产出及到期任务；重复调用不重复结算。 / Reconcile whole-minute income and persisted deadlines idempotently. */
export function settle(state: GameState, now: number): void {
  const p = state.player;
  const minutes = Math.max(0, Math.floor((now - p.producedAt) / 60000));
  p.food = Math.min(1_000_000_000, p.food + minutes * 100); p.producedAt += minutes * 60000;
  for (const building of p.buildings) if (building.dueAt && building.dueAt <= now) { building.level++; building.dueAt = 0; }
  const march = p.march;
  if (march && march.dueAt <= now) {
    const tile = state.world.tiles.find(tile => tile.id === march.tile);
    if (!tile || tile.reservedBy !== p.id) throw Error("行军与地块预订不一致，拒绝结算");
    const won = march.power >= tile.id * 100;
    if (won) tile.owner = p.id;
    tile.reservedBy = "";
    p.troops += won ? Math.floor(march.troops * 0.9) : Math.floor(march.troops * 0.5);
    p.report = `${won ? "获胜，占领" : "战败，未占领"}地块${tile.id}，幸存士兵已返城`;
    p.march = null;
  }
}

/** 在副本上规划操作；调用者提交成功后才发布，失败不修改权威状态。 / Plan on a copy; publish only after durable commit. */
export function apply(state: GameState, command: GameCommand, now: number, roll: number): void {
  const p = state.player;
  const fingerprint = JSON.stringify([command.action, command.target, command.amount]);
  if (command.sequence === p.sequence && fingerprint === p.fingerprint) return;
  if (!Number.isSafeInteger(command.sequence) || command.sequence !== p.sequence + 1) throw Error("操作序号不一致，请刷新或重试原操作");
  const spend = (amount: number) => { if (p.food < amount) throw Error("粮食不足"); p.food -= amount; };
  if (command.action === "upgrade-building") {
    const building = p.buildings.find(item => item.id === command.target);
    if (!building || building.level >= 10 || building.dueAt) throw Error("建筑不存在、已满级或正在升级");
    spend(building.level * 200); building.dueAt = now + building.level * 10000;
  } else if (command.action === "draw-hero") {
    if (!(roll >= 0 && roll < 1)) throw Error("抽卡随机值无效");
    spend(300);
    const id = roll < 0.6 ? 1 : roll < 0.9 ? 2 : 3;
    const existing = p.heroes.find(hero => hero.id === id);
    if (existing) existing.copies++;
    else p.heroes.push({ id, name: ["边军校尉", "疾风女将", "玄甲统领"][id - 1]!, level: 1, copies: 1 });
    p.report = "招募获得" + p.heroes.find(hero => hero.id === id)!.name;
  } else if (command.action === "upgrade-hero") {
    const hero = p.heroes.find(hero => hero.id === command.target);
    if (!hero || hero.level >= 20 || p.march?.hero === hero.id) throw Error("武将不存在、已满级或正在出征");
    spend(hero.level * 100); hero.level++;
  } else if (command.action === "recruit") {
    if (!Number.isInteger(command.amount) || command.amount < 1 || command.amount > 100 || p.troops + command.amount > 1000) throw Error("募兵数量须为1至100，总兵力不超过1000");
    spend(command.amount * 10); p.troops += command.amount;
  } else if (command.action === "march") {
    const tile = state.world.tiles.find(tile => tile.id === command.target);
    const hero = p.heroes.find(hero => hero.id === command.amount);
    if (!tile || tile.owner || tile.reservedBy || !hero || p.march || p.troops < 20) throw Error("地块不可出征、武将无效或兵力不足");
    spend(100); p.troops -= 20; tile.reservedBy = p.id;
    p.march = { tile: tile.id, hero: hero.id, troops: 20, power: 200 + hero.level * 50 + hero.id * 20, dueAt: now + 10000 };
  } else throw Error("未知操作");
  p.sequence = command.sequence; p.fingerprint = fingerprint;
}
