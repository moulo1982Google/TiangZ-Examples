import { test, expect } from "vitest";
import { readFileSync } from "node:fs";

test("MMORPG method declarations are generated in the module, not handwritten stubs", () => {
  for (const [name, signatures] of [
    ["PlayerUnit", ["Move(request: MovePlayer): boolean;", "Snapshot(): PlayerSnapshot;"]],
    ["LoginComponent", ["Login(request: C2S_Login): Promise<S2C_Login>;"]],
    ["ItemComponent", ["GetItem(itemId: bigint): ItemView | undefined;", "UseItem(itemId: bigint): ItemSnapshot;", "SeedInitialItems(seeds: readonly InventorySeed[]): readonly ItemSnapshot[];"]],
    ["NumericComponent", ["Get(type: NumericTypeValue): bigint;", "Set(type: NumericTypeValue, value: bigint): void;", "Snapshot(): UnitNumericDelta[];"]],
  ] as const) {
    const content = readFileSync(new URL(`../../modules/mmorpg/src/model/generated/bootstrap/systems/${name}System.d.ts`, import.meta.url), "utf8");
    for (const signature of signatures) expect(content).toContain(signature);
  }
  for (const file of ["map/PlayerUnit", "login/LoginComponent", "item/ItemComponent", "numeric/NumericComponent"]) {
    expect(readFileSync(new URL(`../../modules/mmorpg/src/model/${file}.ts`, import.meta.url), "utf8")).not.toContain("System is not installed");
  }
});

test("MMORPG factories attach extensions before publishing entities", () => {
  for (const [file, name] of [["npc/NpcComponentSystem", "npc"], ["interactable/InteractableComponentSystem", "interactable"]]) {
    const source = readFileSync(new URL(`../../modules/mmorpg/src/hotfix/${file}.ts`, import.meta.url), "utf8");
    const create = source.indexOf(`const ${name} = this.units.Create`);
    const extension = source.indexOf(`applyEntityExtensions(${name})`, create);
    const publish = source.indexOf(`this.${name}s.set(${name}.UnitId, ${name})`, create);
    expect(create).toBeGreaterThanOrEqual(0);
    expect(extension).toBeGreaterThan(create);
    expect(publish).toBeGreaterThan(extension);
  }
});
