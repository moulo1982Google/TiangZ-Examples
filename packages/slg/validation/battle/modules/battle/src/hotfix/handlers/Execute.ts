import { rpcHandler, type SceneRpcHandler } from "#tiangz/model";
import { BattleHostScene, BattleHostComponent, BattleProtocol, type C2B_Execute, type B2C_Execute } from "#tiangz/module";
@rpcHandler(BattleHostScene, BattleProtocol.Execute)
export class ExecuteHandler implements SceneRpcHandler<BattleHostScene, C2B_Execute, B2C_Execute> {
  handle(scene: BattleHostScene, request: C2B_Execute): B2C_Execute | Promise<B2C_Execute> {
    const state = scene.GetComponent(BattleHostComponent);
    return { accepted: state.Execute(request) };
  }
}

