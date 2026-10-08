import { defineGameModule } from "#tiangz/core";
import { RoomScene } from "./RoomScene";
import { RoomStoreComponent } from "./RoomStoreComponent";
import { RoomProtocol } from "./generated/protocol/room/protocol/rpcs";

export { RoomScene, RoomStoreComponent, RoomProtocol };
export type { RoomState, RoomSnapshot } from "./RoomStoreComponent";
export type * from "./generated/protocol/room/protocol/messages";

defineGameModule({
  id: "org.example.room",
  version: "0.1.0",
  modelExports: { RoomScene, RoomStoreComponent, RoomProtocol },
  requiredSystems: [RoomScene, RoomStoreComponent],
});
