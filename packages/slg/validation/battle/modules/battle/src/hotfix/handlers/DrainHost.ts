import { rpcHandler, type SceneRpcHandler } from "#tiangz/model";
import { BattleHostScene, BattleHostComponent, BattleProtocol, type C2B_DrainHost, type B2C_DrainHost } from "#tiangz/module";
@rpcHandler(BattleHostScene, BattleProtocol.DrainHost)
export class DrainHostHandler implements SceneRpcHandler<BattleHostScene, C2B_DrainHost, B2C_DrainHost> {
  handle(scene: BattleHostScene, request: C2B_DrainHost): B2C_DrainHost | Promise<B2C_DrainHost> {
    const state = scene.GetComponent(BattleHostComponent);
    if (request.node !== scene.self.name) return { idle: false };
    state.draining = true; for (const id of state.jobs.keys()) state.Poll(id); return { idle: [...state.jobs.values()].every(job => job.result >= 0) };
  }
}
