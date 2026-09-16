import { rpcHandler, type SceneRpcHandler } from "#tiangz/model";
import { BattleManagerScene, BattleManagerComponent, BattleProtocol, type C2B_Drain, type B2C_Drain } from "#tiangz/module";
@rpcHandler(BattleManagerScene, BattleProtocol.Drain)
export class DrainManagerHandler implements SceneRpcHandler<BattleManagerScene, C2B_Drain, B2C_Drain> {
  handle(scene: BattleManagerScene, request: C2B_Drain): B2C_Drain | Promise<B2C_Drain> {
    const state = scene.GetComponent(BattleManagerComponent);
    return state.Drain(request.node).then(idle => ({ idle }));
  }
}

