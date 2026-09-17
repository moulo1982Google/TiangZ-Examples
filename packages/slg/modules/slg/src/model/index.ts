import { defineGameModule } from "#tiangz/core";
import { SlgWorldScene, SlgGameComponent } from "./SlgWorldScene";
import { SlgProtocol } from "./generated/protocol/slg/protocol/rpcs";

export { SlgWorldScene, SlgGameComponent, SlgProtocol };
export type * from "./SlgState";
export type * from "./generated/protocol/slg/protocol/messages";

export const ModuleIdentity = Object.freeze({
  id: "org.tiangz.slg",
  version: "0.1.0",
});

defineGameModule({
  ...ModuleIdentity,
  modelExports: { ModuleIdentity, SlgWorldScene, SlgGameComponent, SlgProtocol },
  requiredSystems: [SlgWorldScene, SlgGameComponent],
});
