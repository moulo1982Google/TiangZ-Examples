import { defineGameModule } from "#tiangz/core";
import { SlgWorldScene } from "./SlgWorldScene";
import { SlgProtocol } from "./generated/protocol/slg/protocol/rpcs";

export { SlgWorldScene, SlgProtocol };
export type * from "./generated/protocol/slg/protocol/messages";

export const ModuleIdentity = Object.freeze({
  id: "org.tiangz.slg",
  version: "0.1.0",
});

defineGameModule({
  ...ModuleIdentity,
  modelExports: { ModuleIdentity, SlgWorldScene, SlgProtocol },
  requiredSystems: [SlgWorldScene],
});
