import { rpcHandler, type SceneRpcHandler } from "#tiangz/model";
import { BattleManagerScene, BattleManagerComponent, BattleProtocol, type C2B_Overview, type B2C_Overview } from "#tiangz/module";
@rpcHandler(BattleManagerScene, BattleProtocol.Overview)
export class OverviewHandler implements SceneRpcHandler<BattleManagerScene, C2B_Overview, B2C_Overview> {
  handle(scene: BattleManagerScene, request: C2B_Overview): B2C_Overview | Promise<B2C_Overview> {
    const state = scene.GetComponent(BattleManagerComponent);
    return state.Overview();
  }
}

