import { _decorator, Camera, Canvas, Color, Component, Graphics, Label, Layers, Node, ResolutionPolicy, UITransform, view, sys, game, Game } from "cc";
import { SlgConnection } from "./SlgConnection";
import type { C2S_Game, S2C_Game, S2C_WorldSnapshot } from "./Generated/SDK/slg/protocol/messages";

const { ccclass, property } = _decorator;

@ccclass("SlgBootstrap")
export class SlgBootstrap extends Component {
  @property serverHost = "127.0.0.1";
  @property serverPort = 18001;
  private connection?: SlgConnection;
  private status!: Label;
  private map!: Node;
  private busy = false;
  private disposed = false;
  private economy!: Label;
  private controls!: Node;
  private gameState?: S2C_Game;
  private player = "";
  private hero = 1;
  private tile = 2;
  private elapsed = 0;
  private pending?: C2S_Game;
  private hidden = false;
  private connectionEpoch = 0;

  start(): void {
    this.player = sys.localStorage.getItem("slg.demo.player") || `demo_${Date.now().toString(36)}`;
    sys.localStorage.setItem("slg.demo.player", this.player);
    try { this.pending = JSON.parse(sys.localStorage.getItem(`slg.demo.pending.${this.player}`) || "null") ?? undefined; } catch { /* 保留服务端序号保护。 */ }
    view.setDesignResolutionSize(960, 640, ResolutionPolicy.SHOW_ALL);
    const canvas = new Node("Canvas");
    canvas.layer = Layers.Enum.UI_2D;
    this.node.addChild(canvas);
    canvas.addComponent(UITransform).setContentSize(960, 640);
    const ui = canvas.addComponent(Canvas);
    const cameraNode = new Node("Camera");
    canvas.addChild(cameraNode);
    cameraNode.setPosition(0, 0, 1000);
    const camera = cameraNode.addComponent(Camera);
    camera.projection = Camera.ProjectionType.ORTHO;
    camera.orthoHeight = 320;
    camera.near = 0.1;
    camera.far = 2000;
    camera.visibility = Layers.Enum.UI_2D;
    camera.clearColor = new Color(18, 28, 36, 255);
    ui.cameraComponent = camera;
    this.label(canvas, "TIANGZ / SLG 开发地图", 0, 275, 28);
    this.economy = this.label(canvas, "准备连接服务端…", 0, 240, 17);
    this.status = this.label(canvas, "", 0, -300, 14);
    this.controls = new Node("Gameplay"); this.controls.layer = Layers.Enum.UI_2D; canvas.addChild(this.controls);
    this.map = new Node("WorldMap");
    this.map.layer = Layers.Enum.UI_2D;
    canvas.addChild(this.map);
    this.map.addComponent(UITransform).setContentSize(768, 384);
    this.map.setPosition(0, -50); this.map.setScale(0.8, 0.8, 1);
    const refresh = this.label(canvas, "[ 刷新 / 重连 ]", -330, -260, 18, 180);
    refresh.node.on(Node.EventType.TOUCH_END, () => void this.refresh(), this);
    for (const [text, x, action] of [["招募武将 300粮", -100, "draw-hero"], ["武将升级", 110, "upgrade-hero"], ["募兵20 / 200粮", 330, "recruit"]] as const) {
      const button = this.label(canvas, `[ ${text} ]`, x, -260, 17, 205);
      button.node.on(Node.EventType.TOUCH_END, () => void this.act(action, this.hero, action === "recruit" ? 20 : 0), this);
    }
    const attack = this.label(canvas, "[ 派选中武将出征：20兵 / 100粮 / 10秒 ]", 0, -225, 17);
    attack.node.on(Node.EventType.TOUCH_END, () => void this.act("march", this.tile, this.hero), this);
    game.on(Game.EVENT_HIDE, this.onBackground, this);
    game.on(Game.EVENT_SHOW, this.onForeground, this);
    void this.refresh();
  }

  update(dt: number): void {
    if (this.hidden || this.disposed) return;
    this.connection?.update(); this.elapsed += dt;
    if (this.elapsed >= 2) { this.elapsed = 0; if (!this.busy) { if (this.connection) void this.poll(); else void this.refresh(); } }
  }

  private async poll(): Promise<void> {
    if (!this.connection || this.busy || this.disposed || this.hidden) return;
    const epoch = this.connectionEpoch;
    this.busy = true;
    try {
      const request = this.pending ?? { player: this.player, action: "snapshot", sequence: 0, target: 0, amount: 0 };
      const result = await this.connection.game(request);
      if (this.disposed || epoch !== this.connectionEpoch || this.hidden) return;
      if (this.pending) {
        const fingerprint = JSON.stringify([this.pending.action, this.pending.target, this.pending.amount]);
        if (result.receipt?.sequence !== this.pending.sequence || result.receipt.fingerprint !== fingerprint) throw Error("未确认操作回执不匹配，保留原操作；请检查是否多端同时操作");
        this.pending = undefined; sys.localStorage.removeItem(`slg.demo.pending.${this.player}`);
      }
      this.showGame(result);
    } catch (error) {
      if (!this.disposed && epoch === this.connectionEpoch) {
        this.status.string = String(error) + (this.pending ? "（保留原操作重试）" : "");
        this.connection?.close(); this.connection = undefined;
      }
    } finally { if (epoch === this.connectionEpoch) this.busy = false; }
  }

  private async act(action: string, target: number, amount: number): Promise<void> {
    if (this.busy || !this.gameState || this.disposed || this.hidden) return;
    if (!this.pending) {
      this.pending = { player: this.player, sequence: this.gameState.sequence + 1, action, target, amount };
      sys.localStorage.setItem(`slg.demo.pending.${this.player}`, JSON.stringify(this.pending));
    }
    await this.poll();
  }

  private showGame(state: S2C_Game): void {
    this.gameState = state;
    this.economy.string = `${state.player} · 粮食 ${state.food}（100/分钟）· 士兵 ${state.troops} · ${state.persisted ? "DBProxy" : "内存演示，重启丢失"}`;
    for (const child of [...this.controls.children]) { child.removeFromParent(); child.destroy(); }
    for (const [index, building] of state.buildings.entries()) {
      const remaining = Math.max(0, Math.ceil((building.dueAt - state.serverTime) / 1000));
      const label = this.label(this.controls, `${building.name} Lv${building.level} [${remaining ? remaining + "秒" : "升级 " + building.level * 200 + "粮"}]`, -300 + index * 300, 195, 16, 290);
      label.node.on(Node.EventType.TOUCH_END, () => void this.act("upgrade-building", building.id, 0), this);
    }
    for (const [index, hero] of state.heroes.entries()) {
      const label = this.label(this.controls, `${hero.id === this.hero ? "★" : ""}${hero.name} Lv${hero.level} ×${hero.copies}`, -300 + index * 300, 157, 16, 290);
      label.node.on(Node.EventType.TOUCH_END, () => { this.hero = hero.id; this.showGame(state); }, this);
    }
    const owned = state.tiles.filter(tile => tile.owner === this.player).map(tile => tile.id).join(",") || "无";
    const march = state.marches[0];
    this.status.string = `选中地块${this.tile} · 已占领：${owned} · ${march ? "行军剩余" + Math.max(0, Math.ceil((march.dueAt - state.serverTime) / 1000)) + "秒" : state.report} · ${state.receipt?.message ?? ""}`;
  }

  onDestroy(): void {
    this.disposed = true;
    this.connectionEpoch++;
    game.off(Game.EVENT_HIDE, this.onBackground, this);
    game.off(Game.EVENT_SHOW, this.onForeground, this);
    this.connection?.close();
  }

  /** 后台不依赖Socket仍有效，保留未确认业务。 */
  private onBackground(): void {
    this.hidden = true; this.connectionEpoch++; this.busy = false;
    this.connection?.close(); this.connection = undefined; this.gameState = undefined;
  }

  /** 每次回前台重新连接并取快照，旧连接回调不得覆盖新状态。 */
  private onForeground(): void {
    if (this.disposed) return;
    this.onBackground(); this.hidden = false; this.elapsed = 0;
    void this.refresh();
  }

  private async refresh(): Promise<void> {
    if (this.busy || this.disposed || this.hidden) return;
    const epoch = ++this.connectionEpoch;
    this.busy = true;
    this.connection?.close();
    try {
      this.connection = new SlgConnection(this.serverHost, this.serverPort);
      this.status.string = `连接 ${this.serverHost}:${this.serverPort}…`;
      const snapshot = await this.connection.snapshot();
      if (this.disposed || epoch !== this.connectionEpoch || this.hidden) return;
      this.draw(snapshot);
      this.status.string = `${snapshot.worldName} · 在线 · ${snapshot.sites.length} 个地点`;
    } catch (error) {
      if (!this.disposed && epoch === this.connectionEpoch) {
        this.status.string = `连接失败：${error instanceof Error ? error.message : String(error)}；请先运行 npm run dev`;
        this.connection?.close(); this.connection = undefined;
      }
    } finally {
      if (epoch === this.connectionEpoch) this.busy = false;
    }
    if (epoch === this.connectionEpoch && !this.hidden) await this.poll();
  }

  private draw(snapshot: S2C_WorldSnapshot): void {
    for (const child of [...this.map.children]) { child.removeFromParent(); child.destroy(); }
    const graphics = this.map.getComponent(Graphics) ?? this.map.addComponent(Graphics);
    graphics.clear();
    const cell = Math.min(768 / snapshot.width, 384 / snapshot.height);
    const left = -snapshot.width * cell / 2;
    const top = snapshot.height * cell / 2;
    graphics.lineWidth = 1;
    for (let y = 0; y < snapshot.height; y++) {
      for (let x = 0; x < snapshot.width; x++) {
        graphics.fillColor = new Color(31 + (x + y) % 2 * 4, 56, 54);
        graphics.rect(left + x * cell, top - (y + 1) * cell, cell - 2, cell - 2);
        graphics.fill();
      }
    }
    for (const site of snapshot.sites) {
      const x = left + (site.x + 0.5) * cell;
      const y = top - (site.y + 0.5) * cell;
      graphics.fillColor = site.kind === "city" ? new Color(217, 179, 96) : new Color(106, 167, 130);
      graphics.circle(x, y, 13);
      graphics.fill();
      const label = this.label(this.map, site.name, x, y - 24, 15, 100);
      label.node.on(Node.EventType.TOUCH_END, () => {
        if (site.id !== 1) this.tile = site.id;
        this.status.string = `${site.name} (${site.x}, ${site.y}) · 选中地块${this.tile}`;
      }, this);
    }
  }

  private label(parent: Node, text: string, x: number, y: number, size: number, width = 920): Label {
    const node = new Node(text);
    node.layer = Layers.Enum.UI_2D;
    parent.addChild(node);
    node.setPosition(x, y);
    node.addComponent(UITransform).setContentSize(width, size + 14);
    const label = node.addComponent(Label);
    label.string = text;
    label.fontSize = size;
    label.lineHeight = size + 6;
    label.horizontalAlign = Label.HorizontalAlign.CENTER;
    label.verticalAlign = Label.VerticalAlign.CENTER;
    label.overflow = Label.Overflow.SHRINK;
    label.color = new Color(232, 237, 222);
    return label;
  }
}
