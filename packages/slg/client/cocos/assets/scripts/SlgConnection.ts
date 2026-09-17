import "./Generated/SDK/Core/Net/BrowserWebSocketTransport";
import { RpcSocket } from "./Generated/SDK/Core/Net/RpcSocket";
import { SlgClient } from "./Generated/SDK/slg/protocol/clients";
import type { C2S_Game } from "./Generated/SDK/slg/protocol/messages";

/** 引擎无关连接；Cocos 每帧驱动 update，销毁时关闭。 */
export class SlgConnection {
  private readonly socket: RpcSocket;
  private readonly client: SlgClient;

  constructor(host = "127.0.0.1", port = 18001) {
    this.socket = new RpcSocket({ transport: "websocket", host, port });
    this.client = new SlgClient(this.socket);
  }

  async snapshot() {
    await this.socket.connect();
    return this.client.worldSnapshot({});
  }

  /** 请求包含稳定操作序号；超时后重试原请求，不产生新的扣费。 */
  async game(request: C2S_Game) { await this.socket.connect(); return this.client.game(request); }

  update(): void { this.socket.update(); }
  close(): void { this.socket.close(); }
}
