import { rpcHandler, type SceneRpcHandler } from "#tiangz/model";
import { SlgProtocol, SlgWorldScene, type C2S_WorldSnapshot, type S2C_WorldSnapshot } from "#tiangz/module";

@rpcHandler(SlgWorldScene, SlgProtocol.WorldSnapshot)
export class WorldSnapshotHandler implements SceneRpcHandler<SlgWorldScene, C2S_WorldSnapshot, S2C_WorldSnapshot> {
  handle(scene: SlgWorldScene, _request: C2S_WorldSnapshot): S2C_WorldSnapshot {
    return scene.GetWorldSnapshot();
  }
}
