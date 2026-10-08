import { rpcHandler, type SceneRpcHandler } from "#tiangz/model";
import { RoomScene, RoomStoreComponent, RoomProtocol, type C2S_LeaveRoom, type S2C_LeaveRoom } from "#tiangz/module";

@rpcHandler(RoomScene, RoomProtocol.LeaveRoom)
export class LeaveRoomHandler implements SceneRpcHandler<RoomScene, C2S_LeaveRoom, S2C_LeaveRoom> {
  handle(scene: RoomScene, request: C2S_LeaveRoom): S2C_LeaveRoom {
    return { snapshot: scene.GetComponent(RoomStoreComponent).Leave(request.roomId, request.memberId, request.resumeKey) };
  }
}
