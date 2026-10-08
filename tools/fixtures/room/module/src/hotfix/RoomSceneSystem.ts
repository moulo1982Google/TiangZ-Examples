import { systemFor } from "#tiangz/model";
import { RoomScene, RoomStoreComponent } from "#tiangz/module";

@systemFor(RoomScene)
export class RoomSceneSystem extends RoomScene {
  /** 在服务请求前装配唯一的状态所有者。 / Attach the state owner before serving requests. */
  protected override onStart(): void { this.AddComponent(RoomStoreComponent); }
}
