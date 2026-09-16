import "../../../modules/mmorpg/src/hotfix/generated/bootstrap/handlers";
// 该候选必须与 generated/hotfix/patches 保持完整集合，仅用下方自定义实现替换 PlayerUnitSystem。
// Keep the complete generated patch set, replacing only PlayerUnitSystem with the custom implementation below.
import "../../../modules/mmorpg/src/hotfix/buff/BuffComponentSystem";
import "../../../modules/mmorpg/src/hotfix/buff/BuffSystem";
import "../../../modules/mmorpg/src/hotfix/combat/CombatComponentSystem";
import "../../../modules/mmorpg/src/hotfix/combat/CombatStateComponentSystem";
import "../../../modules/mmorpg/src/hotfix/currency/CurrencyComponentSystem";
import "../../../modules/mmorpg/src/hotfix/interactable/InteractableComponentSystem";
import "../../../modules/mmorpg/src/hotfix/interactable/InteractableUnitSystem";
import "../../../modules/mmorpg/src/hotfix/item/ItemComponentSystem";
import "../../../modules/mmorpg/src/hotfix/item/ItemSystem";
import "../../../modules/mmorpg/src/hotfix/login/LoginComponentSystem";
import "../../../modules/mmorpg/src/hotfix/monster/MonsterComponentSystem";
import "../../../modules/mmorpg/src/hotfix/monster/MonsterUnitSystem";
import "../../../modules/mmorpg/src/hotfix/movement/DirectionalMovementProfileComponentSystem";
import "../../../modules/mmorpg/src/hotfix/npc/NpcComponentSystem";
import "../../../modules/mmorpg/src/hotfix/npc/NpcUnitSystem";
import "../../../modules/mmorpg/src/hotfix/numeric/NumericComponentSystem";
import "../../../modules/mmorpg/src/hotfix/numeric/NumericRegenerationComponentSystem";
import "../../../modules/mmorpg/src/hotfix/progression/ProgressionComponentSystem";
import "../../../modules/mmorpg/src/hotfix/party/PartyDirectoryComponentSystem";
import "../../../modules/mmorpg/src/hotfix/quest/QuestComponentSystem";
import "../../../modules/mmorpg/src/hotfix/quest/QuestSystem";
import "../../../modules/mmorpg/src/hotfix/repair/NpcRepairComponentSystem";
import "../../../modules/mmorpg/src/hotfix/shop/NpcShopComponentSystem";
import "../../../modules/mmorpg/src/hotfix/skill/SkillComponentSystem";
import "../../../modules/mmorpg/src/hotfix/skill/SkillMapComponentSystem";
import "../../../modules/mmorpg/src/hotfix/spawn/SpawnSelectionComponentSystem";
import "../../../modules/mmorpg/src/hotfix/summon/SummonComponentSystem";
import "../../../modules/mmorpg/src/hotfix/summon/SummonedUnitSystem";
import "../../../modules/mmorpg/src/hotfix/trade/PlayerTradeComponentSystem";
import "../../../modules/mmorpg/src/hotfix/trainer/TrainerComponentSystem";

import {
  type AwakePlayerUnit,
  type MatchPlayerGate,
  type MovePlayer,
  NativeData,
  NativeUnitRef,
  NumericComponent,
  PlayerPersistenceComponent,
  type PlayerSnapshot,
  PlayerUnit,
  PositionComponent,
  type RebindPlayerGate,
  UnitGateComponent,
  systemFor,
} from "#tiangz/model";

/** 仅供在线热更验收：提供完整PlayerUnit System，并把玩家上下输入取反。 / Hotfix acceptance fixture providing the complete PlayerUnit System while reversing vertical input. */
@systemFor(PlayerUnit)
class InvertedPlayerUnitSystem extends PlayerUnit {
  protected override Awake(request: AwakePlayerUnit): void {
    this.account = request.account;
    this.mapId = request.mapId;
  }

  Offline(reason: string): Promise<void> {
    return this.GetComponent(PlayerPersistenceComponent).SaveOnOffline(reason);
  }

  RebindGate(request: RebindPlayerGate): PlayerSnapshot {
    this.GetComponent(UnitGateComponent).bind(request.gateName, request.gateSessionId);
    NativeData.ResetMovement(this.GetComponent(NativeUnitRef).Handle);
    return this.Snapshot();
  }

  Snapshot(): PlayerSnapshot {
    const position = this.GetComponent(PositionComponent).snapshot();
    const gate = this.GetComponent(UnitGateComponent);
    const native = this.GetComponent(NativeUnitRef);
    return {
      account: this.account,
      mapId: this.mapId,
      unitId: this.UnitId,
      gateName: gate.gateName,
      gateSessionId: gate.gateSessionId,
      speedCellsPerSecond: native.speedCellsPerSecond,
      facing: native.facing,
      alive: native.alive !== 0,
      numerics: this.GetComponent(NumericComponent).Snapshot(),
      ...position,
    };
  }

  MatchesGate(request: MatchPlayerGate): boolean {
    return this.GetComponent(UnitGateComponent).matches(request.gateName, request.gateSessionId);
  }

  Move(request: MovePlayer): boolean {
    validateMoveInput(request);
    return NativeData.SetMovementInput(
      this.GetComponent(NativeUnitRef).Handle,
      request.inputX,
      -request.inputZ,
      request.sequence,
    );
  }
}

function validateMoveInput(request: MovePlayer): void {
  if (
    !Number.isInteger(request.inputX) ||
    !Number.isInteger(request.inputZ) ||
    Math.abs(request.inputX) > 1 ||
    Math.abs(request.inputZ) > 1
  ) {
    throw new Error(`invalid movement input: ${request.inputX},${request.inputZ}`);
  }
}
