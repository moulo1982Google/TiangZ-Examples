import { rpcHandler, type SceneRpcHandler } from "#tiangz/model";
import { RoomScene, RoomStoreComponent, RoomProtocol, type C2S_ResumeRoom, type S2C_ResumeRoom } from "#tiangz/module";

@rpcHandler(RoomScene, RoomProtocol.ResumeRoom)
export class ResumeRoomHandler implements SceneRpcHandler<RoomScene, C2S_ResumeRoom, S2C_ResumeRoom> {
  handle(scene: RoomScene, request: C2S_ResumeRoom): S2C_ResumeRoom {
    return { snapshot: scene.GetComponent(RoomStoreComponent).Resume(request.roomId, request.memberId, request.resumeKey) };
  }
}
