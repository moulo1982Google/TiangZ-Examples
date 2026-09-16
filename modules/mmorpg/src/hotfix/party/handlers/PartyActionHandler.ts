import { PartyDirectoryComponent, PartyProtocol, MapManagerScene, type S2MM_PartyAction, type MM2S_PartyAction } from "#tiangz/module";
import { rpcHandler, type SceneRpcHandler } from "#tiangz/model";

@rpcHandler(MapManagerScene, PartyProtocol.Action)
export class PartyActionHandler implements SceneRpcHandler<MapManagerScene, S2MM_PartyAction, MM2S_PartyAction> {
  /** 内部认证适配器调用目录；持久模式由目录在场景锁内提交。 / Durable directories serialize and commit under their scene lock. */
  handle(scene: MapManagerScene, request: S2MM_PartyAction): Promise<MM2S_PartyAction> {
    return scene.GetComponent(PartyDirectoryComponent).Execute(request);
  }
}
