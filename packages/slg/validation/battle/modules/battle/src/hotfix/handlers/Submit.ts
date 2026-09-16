import { rpcHandler, type SceneRpcHandler } from "#tiangz/model";
import { BattleManagerScene, BattleManagerComponent, BattleProtocol, type C2B_Submit, type B2C_Submit } from "#tiangz/module";
@rpcHandler(BattleManagerScene, BattleProtocol.Submit)
export class SubmitHandler implements SceneRpcHandler<BattleManagerScene, C2B_Submit, B2C_Submit> {
  handle(scene: BattleManagerScene, request: C2B_Submit): B2C_Submit | Promise<B2C_Submit> {
    const state = scene.GetComponent(BattleManagerComponent);
    return { state: state.Submit(request) };
  }
}

