import {
  EntryScene,
  RuntimeDataPackRegistry,
  entryScene,
  applyEntityExtensions,
  type RuntimeEntrySceneConfig,
  type SceneMetricsSnapshot,
} from "#tiangz/core";
import { MapHostComponent } from "../mapHost/MapHostComponent";
import { MAP_DEPLOYMENT_PACK_ID, ResolveMapHostDeployment } from "../mapHost/MapHostDeployment";
import { MapContentProfileComponent } from "../map/MapContentProfileComponent";
import { PlayerDirectoryComponent } from "../mapHost/PlayerDirectoryComponent";
import { DynamicMapLifecycleComponent } from "../mapHost/DynamicMapLifecycleComponent";
import { MapHostRegistrationComponent } from "../mapHost/MapHostRegistrationComponent";
import { CreatePlayerRepository } from "../persistence/DbProxyPlayerRepository";
import type { G2M_QueryPlayerOffline, M2G_QueryPlayerOffline } from "../generated/server/demo/protocol/messages";

@entryScene()
export class MapHostScene extends EntryScene {
  protected override readonly mailbox = "unordered" as const;
  private readonly mapHost: MapHostComponent;


  constructor(config: RuntimeEntrySceneConfig) {
    // 在创建 Scene/组件前拒绝部署冲突，避免已开始的资源需要回滚。
    // Reject deployment conflicts before constructing the Scene or its components.
    const deployment = ResolveMapHostDeployment(config.self, RuntimeDataPackRegistry.Instance.TryGet(MAP_DEPLOYMENT_PACK_ID));
    super(config);
    this.AddComponent(PlayerDirectoryComponent);
    const mapContent = this.AddComponent(MapContentProfileComponent);
    this.mapHost = this.AddComponent(
      MapHostComponent,
      CreatePlayerRepository(config.process),
      deployment,
    );
    this.AddComponent(DynamicMapLifecycleComponent);
    this.AddComponent(MapHostRegistrationComponent);
    applyEntityExtensions(this);
    mapContent.Seal();
    this.mapHost.InitializeStaticMaps();
  }

  override metricsSnapshot(): SceneMetricsSnapshot {
    const metrics = super.metricsSnapshot();
    metrics.customMetrics.push(...this.mapHost.BroadcastMetricSnapshots());
    return metrics;
  }

  /** 查询本宿主保留的离线成功证据，不向外暴露玩家目录写入能力。 / Queries offline completion evidence retained by this host without exposing directory mutation APIs. */
  QueryPlayerOffline(request: G2M_QueryPlayerOffline): M2G_QueryPlayerOffline {
    return { unitId: request.unitId,
      completed: this.GetComponent(PlayerDirectoryComponent).HasCompletedOffline(request) };
  }

  protected override onStop(): Promise<void> {
    return this.mapHost.Shutdown("map-host-stopping");
  }
}
