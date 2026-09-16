import { defineGameModule } from "#tiangz/core";
import { BattleManagerScene, BattleHostScene, BattleManagerComponent, BattleHostComponent } from "./BattleState";
import { NativeOps } from "./generated/native/NativeOps";
import { BattleRelease } from "./BattleRelease";
export { BattleRelease };
import { BattleProtocol } from "./generated/protocol/battle/protocol/rpcs";
export { BattleManagerScene, BattleHostScene, BattleManagerComponent, BattleHostComponent, NativeOps, BattleProtocol };
export type * from "./BattleState";
export type * from "./generated/protocol/battle/protocol/messages";
import { NativeExample } from "./NativeExample";
export { NativeExample };

export const ModuleIdentity = Object.freeze({
  id: "org.tiangz.slg.battlelab",
  version: "0.1.0",
});

defineGameModule({
  ...ModuleIdentity,
  modelExports: { ModuleIdentity, NativeExample, BattleRelease, BattleManagerScene, BattleHostScene, BattleManagerComponent, BattleHostComponent, NativeOps, BattleProtocol },
  requiredSystems: [BattleManagerScene, BattleHostScene, BattleManagerComponent, BattleHostComponent],
});
