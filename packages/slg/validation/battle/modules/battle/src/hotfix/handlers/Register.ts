import { rpcHandler, type SceneRpcHandler } from "#tiangz/model";
import { BattleManagerScene, BattleManagerComponent, BattleProtocol, type C2B_Register, type B2C_Register } from "#tiangz/module";
@rpcHandler(BattleManagerScene, BattleProtocol.Register)
export class RegisterHandler implements SceneRpcHandler<BattleManagerScene, C2B_Register, B2C_Register> {
  handle(scene: BattleManagerScene, request: C2B_Register): B2C_Register | Promise<B2C_Register> {
    const state = scene.GetComponent(BattleManagerComponent);
    return { accepted: state.Register(request.node, request.port, request.ip, request.logicVersion, request.configVersion) };
  }
}
