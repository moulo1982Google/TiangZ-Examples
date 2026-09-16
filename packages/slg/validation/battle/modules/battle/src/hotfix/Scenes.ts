import { systemFor } from "#tiangz/model";
import { BattleManagerScene, BattleHostScene, BattleManagerComponent, BattleHostComponent } from "#tiangz/module";
@systemFor(BattleManagerScene)
export class ManagerSceneSystem extends BattleManagerScene {
  protected override onStart(): void { this.AddComponent(BattleManagerComponent).NewRepeatedTimer(30, "Tick"); }
}
@systemFor(BattleHostScene)
export class HostSceneSystem extends BattleHostScene {
  protected override onStart(): void { this.AddComponent(BattleHostComponent).NewRepeatedTimer(100, "Report"); }
}
