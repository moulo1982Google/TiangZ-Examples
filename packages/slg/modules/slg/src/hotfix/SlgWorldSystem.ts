import { systemFor } from "#tiangz/model";
import { SlgWorldScene, type S2C_WorldSnapshot } from "#tiangz/module";

@systemFor(SlgWorldScene)
export class SlgWorldSystem extends SlgWorldScene {
  /** 返回全量只读视图；当前不创建账号或写入经济数据。 / Returns a read-only snapshot without account or economy mutations. */
  override GetWorldSnapshot(): S2C_WorldSnapshot {
    return {
      worldName: "边境原野", width: 12, height: 8,
      stage: "工程联调：世界快照已接通；登录、行军与持久化待实现",
      sites: [
        { id: 1, name: "起始城池", kind: "city", x: 2, y: 3 },
        { id: 2, name: "林地", kind: "wood", x: 6, y: 2 },
        { id: 3, name: "农田", kind: "food", x: 9, y: 5 },
        { id: 4, name: "矿场", kind: "ore", x: 4, y: 6 },
      ],
    };
  }
}
