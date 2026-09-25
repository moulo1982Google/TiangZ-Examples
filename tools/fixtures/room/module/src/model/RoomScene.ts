import { EntryScene, entryScene } from "#tiangz/core";

/** 客户端按已知地址直连的单个房间入口。 / One directly addressed entry point, without a directory service. */
@entryScene()
export class RoomScene extends EntryScene {}
