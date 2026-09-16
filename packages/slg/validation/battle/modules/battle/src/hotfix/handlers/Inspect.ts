import { rpcHandler, type SceneRpcHandler } from "#tiangz/model";
import { BattleManagerScene, BattleManagerComponent, BattleProtocol, type C2B_Inspect, type B2C_Inspect } from "#tiangz/module";
@rpcHandler(BattleManagerScene, BattleProtocol.Inspect)
export class InspectHandler implements SceneRpcHandler<BattleManagerScene, C2B_Inspect, B2C_Inspect> {
  handle(scene: BattleManagerScene, request: C2B_Inspect): B2C_Inspect | Promise<B2C_Inspect> {
    const state = scene.GetComponent(BattleManagerComponent);
    return state.Inspect(request);
  }
}
