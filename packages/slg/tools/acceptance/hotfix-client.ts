import "#fixture/Core/Net/BrowserWebSocketTransport";
import { createClientTransport, registerClientTransport } from "#fixture/Core/Net/ClientTransport";
import { RpcSocket } from "#fixture/Core/Net/RpcSocket";
import { readFrameMsgCode } from "#fixture/Core/Protocol/Frame";
import { SlgProtocol } from "#fixture/slg/protocol/rpcs";

/** 只包装正式传输与codec；可扣客户端请求/响应，关闭时丢弃。 / Wrap official transport/codecs; close discards held frames. */
export class SlgConnection {
  socket; transport; listener; rule; held; observed; events = []; states = []; pending = new Map();
  constructor(host = "127.0.0.1", port = 18001, readonly timeoutMs = 30000) {
    this.transport = createClientTransport({ transport: "websocket", host, port });
    const raw = this.transport;
    const unregister = registerClientTransport("tcp", endpoint => ({
      endpoint, get connected() { return raw.connected; },
      connect: () => this.transport.connect(), close: () => this.transport.close(),
      setListener: listener => { this.listener = listener; this.transport.setListener({ onClose: error => listener.onClose(error), onMessage: frame => this.forward("response", frame, () => listener.onMessage(frame)) }); },
      send: frame => this.forward("request", frame, () => this.transport.send(frame)),
    }));
    try { this.socket = new RpcSocket({ transport: "tcp", host, port }, { defaultTimeoutMs: timeoutMs, onStateChange: state => this.states.push({ state, at: performance.now() }) }); }
    finally { unregister(); }
  }
  forward(direction, frame, send) {
    const rpc = SlgProtocol.Game, code = readFrameMsgCode(frame);
    if (code !== (direction === "request" ? rpc.requestCode : rpc.responseCode)) { send(); return; }
    const value = (direction === "request" ? rpc.requestCodec : rpc.responseCodec).decode(frame.subarray(2));
    if (direction === "request") this.pending.set(value.rpcId, value);
    const request = this.pending.get(value.rpcId);
    if (direction === "response") this.pending.delete(value.rpcId);
    const event = { direction, value, request, at: performance.now() }; this.events.push(event);
    if (this.events.length > 20000) throw Error("client evidence bound exceeded");
    if (this.rule && !this.observed && direction === this.rule.direction && this.rule.match(request, value)) { this.observed = event; this.held = send; return; }
    send();
  }
  arm(direction, match) { if (this.rule) throw Error("client already armed"); this.rule = { direction, match }; this.observed = undefined; }
  hit() { return this.observed; }
  release() { const send = this.held; this.held = undefined; this.rule = undefined; send?.(); }
  async game(request) { await this.socket.connect(); return this.socket.call(SlgProtocol.Game, request); }
  update() { this.socket.update(); }
  close() { this.held = undefined; this.rule = undefined; this.transport.close(); this.socket.close(); }
}
