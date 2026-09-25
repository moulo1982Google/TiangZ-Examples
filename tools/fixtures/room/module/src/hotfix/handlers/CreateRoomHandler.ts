import { rpcHandler, type SceneRpcHandler } from "#tiangz/model";
import { RoomScene, RoomStoreComponent, RoomProtocol, type C2S_CreateRoom, type S2C_CreateRoom } from "#tiangz/module";

@rpcHandler(RoomScene, RoomProtocol.CreateRoom)
export class CreateRoomHandler implements SceneRpcHandler<RoomScene, C2S_CreateRoom, S2C_CreateRoom> {
  handle(scene: RoomScene, request: C2S_CreateRoom): S2C_CreateRoom {
    return { snapshot: scene.GetComponent(RoomStoreComponent).Create(request.memberId, request.resumeKey) };
  }
}
