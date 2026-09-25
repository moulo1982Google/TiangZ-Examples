import { rpcHandler, type SceneRpcHandler } from "#tiangz/model";
import { RoomScene, RoomStoreComponent, RoomProtocol, type C2S_JoinRoom, type S2C_JoinRoom } from "#tiangz/module";

@rpcHandler(RoomScene, RoomProtocol.JoinRoom)
export class JoinRoomHandler implements SceneRpcHandler<RoomScene, C2S_JoinRoom, S2C_JoinRoom> {
  handle(scene: RoomScene, request: C2S_JoinRoom): S2C_JoinRoom {
    return { snapshot: scene.GetComponent(RoomStoreComponent).Join(request.roomId, request.memberId, request.resumeKey) };
  }
}
