import "./Generated/SDK/Core/Net/BrowserWebSocketTransport";
import { RpcSocket } from "./Generated/SDK/Core/Net/RpcSocket";
import { SlgClient } from "./Generated/SDK/slg/protocol/clients";

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

  update(): void { this.socket.update(); }
  close(): void { this.socket.close(); }
}
