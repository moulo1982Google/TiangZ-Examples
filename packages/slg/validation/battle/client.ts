import "./modules/battle/generated/typescript/Core/Net/BrowserWebSocketTransport";
import { RpcSocket } from "./modules/battle/generated/typescript/Core/Net/RpcSocket";
import { BattleClient } from "./modules/battle/generated/typescript/battle/protocol/clients";
export async function connect(port: number, host = "127.0.0.1") {
  const socket = new RpcSocket({ transport: "websocket", host, port });
  const pump = setInterval(() => socket.update(), 5);
  const close = () => { clearInterval(pump); socket.close(); };
  try { await socket.connect(); return { client: new BattleClient(socket), close }; }
  catch (error) { close(); throw error; }
}
