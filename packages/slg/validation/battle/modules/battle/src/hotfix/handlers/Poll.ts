import { rpcHandler, type SceneRpcHandler } from "#tiangz/model";
import { taskKey } from "../Input";
import { BattleHostScene, BattleHostComponent, BattleProtocol, type C2B_Poll, type B2C_Poll } from "#tiangz/module";
@rpcHandler(BattleHostScene, BattleProtocol.Poll)
export class PollHandler implements SceneRpcHandler<BattleHostScene, C2B_Poll, B2C_Poll> {
  handle(scene: BattleHostScene, request: C2B_Poll): B2C_Poll | Promise<B2C_Poll> {
    const state = scene.GetComponent(BattleHostComponent);
    return state.Poll(taskKey(request));
  }
}
