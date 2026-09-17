import { rpcHandler, type SceneRpcHandler } from "#tiangz/model";
import { SlgGameComponent, SlgWorldScene, SlgProtocol, type C2S_Game, type S2C_Game } from "#tiangz/module";
@rpcHandler(SlgWorldScene, SlgProtocol.Game)
export class GameHandler implements SceneRpcHandler<SlgWorldScene, C2S_Game, S2C_Game> {
  /** 薄入口；经济与持久化由领域组件处理。 / Thin adapter; the domain component owns economy and persistence. */
  handle(scene: SlgWorldScene, request: C2S_Game): Promise<S2C_Game> { return scene.GetComponent(SlgGameComponent).Execute(request); }
}
