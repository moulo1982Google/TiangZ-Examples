import { type C2S_Register, LoginProtocol, LoginScene, type S2C_Register } from "#tiangz/module";
import { Session, sessionRpcHandler, type SessionRpcHandler } from "#tiangz/model";

@sessionRpcHandler(LoginScene, LoginProtocol.Register)
export class C2S_RegisterHandler implements SessionRpcHandler<
  LoginScene,
  Session,
  C2S_Register,
  S2C_Register
> {
  handle(
    scene: LoginScene,
    _session: Session,
    request: C2S_Register,
  ): Promise<S2C_Register> {
    return scene.Register(request);
  }
}
