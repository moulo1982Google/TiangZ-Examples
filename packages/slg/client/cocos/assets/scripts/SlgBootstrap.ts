import { _decorator, Camera, Canvas, Color, Component, Graphics, Label, Layers, Node, ResolutionPolicy, UITransform, view } from "cc";
import { SlgConnection } from "./SlgConnection";
import type { S2C_WorldSnapshot } from "./Generated/SDK/slg/protocol/messages";

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

  start(): void {
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
    this.status = this.label(canvas, "准备连接服务端…", 0, 230, 16);
    this.map = new Node("WorldMap");
    this.map.layer = Layers.Enum.UI_2D;
    canvas.addChild(this.map);
    this.map.addComponent(UITransform).setContentSize(768, 384);
    this.map.setPosition(0, -10);
    const refresh = this.label(canvas, "[ 连接 / 刷新世界 ]", 0, -250, 22);
    refresh.node.on(Node.EventType.TOUCH_END, () => void this.refresh(), this);
    this.label(canvas, "只读联调版本 · 点击资源点查看详情 · 尚未开放派兵", 0, -292, 16);
    void this.refresh();
  }

  update(): void { this.connection?.update(); }

  onDestroy(): void {
    this.disposed = true;
    this.connection?.close();
  }

  private async refresh(): Promise<void> {
    if (this.busy || this.disposed) return;
    this.busy = true;
    this.connection?.close();
    try {
      this.connection = new SlgConnection(this.serverHost, this.serverPort);
      this.status.string = `连接 ${this.serverHost}:${this.serverPort}…`;
      const snapshot = await this.connection.snapshot();
      if (this.disposed) return;
      this.draw(snapshot);
      this.status.string = `${snapshot.worldName} · 在线 · ${snapshot.sites.length} 个地点`;
    } catch (error) {
      if (!this.disposed) this.status.string = `连接失败：${error instanceof Error ? error.message : String(error)}；请先运行 npm run dev`;
    } finally {
      this.busy = false;
    }
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
        this.status.string = `${site.name} (${site.x}, ${site.y}) · ${snapshot.stage}`;
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
