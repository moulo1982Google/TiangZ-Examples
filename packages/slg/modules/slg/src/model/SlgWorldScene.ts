import { EntryScene, entryScene } from "#tiangz/core";
import type { S2C_WorldSnapshot } from "./generated/protocol/slg/protocol/messages";

/** 只读开发地图入口；玩家和行军权威状态不归连接所有。 / Read-only starter world, not player/session storage. */
@entryScene()
export class SlgWorldScene extends EntryScene {}

export interface SlgWorldScene {
  GetWorldSnapshot(): S2C_WorldSnapshot;
}
