import { runSelfTest } from "../../TiangZ/tools/self_test_entry";
import assert from "node:assert/strict";
import { resolveDirectionalMovementSpeedMetersPerSecond } from "../modules/mmorpg/src/model/movement/DirectionalMovementProfileComponent";
import { resolveFacingRelativeGridInput } from "../modules/mmorpg/src/model/movement/CellMovement";

export function main(): void {
  function testServerOwnedDirectionalMovementProfile(): void {
    const profile = {
      forwardMultiplier: 1,
      backwardMultiplier: 0.5,
      strafeMultiplier: 0.75,
    };
    assert.equal(resolveDirectionalMovementSpeedMetersPerSecond(profile, 8, 1, 0), 8);
    assert.equal(resolveDirectionalMovementSpeedMetersPerSecond(profile, 8, -1, 0), 4);
    assert.equal(resolveDirectionalMovementSpeedMetersPerSecond(profile, 8, 0, 1), 6);
    assert.equal(resolveDirectionalMovementSpeedMetersPerSecond(profile, 8, -1, 1), 4);
    assert.equal(resolveDirectionalMovementSpeedMetersPerSecond(profile, 8, 0, 0), 8);
    assert.throws(
      () => resolveDirectionalMovementSpeedMetersPerSecond(profile, 0, 1, 0),
      /base movement speed must be positive/,
    );
  }

  function testFacingRelativeInputQuantizesToGridDirections(): void {
    assert.deepEqual(resolveFacingRelativeGridInput(1, 0, 0), { inputX: 0, inputZ: 1 });
    assert.deepEqual(resolveFacingRelativeGridInput(1, 0, Math.PI / 2), { inputX: 1, inputZ: 0 });
    assert.deepEqual(resolveFacingRelativeGridInput(-1, 0, 0), { inputX: 0, inputZ: -1 });
    assert.deepEqual(resolveFacingRelativeGridInput(0, 1, 0), { inputX: 1, inputZ: 0 });
    assert.deepEqual(resolveFacingRelativeGridInput(1, 0, Math.PI / 4), { inputX: 1, inputZ: 1 });
    assert.deepEqual(resolveFacingRelativeGridInput(0, 0, 1.25), { inputX: 0, inputZ: 0 });
    assert.throws(() => resolveFacingRelativeGridInput(2, 0, 0), /invalid facing-relative/);
  }

  testServerOwnedDirectionalMovementProfile();
  testFacingRelativeInputQuantizesToGridDirections();
}

runSelfTest(main);
