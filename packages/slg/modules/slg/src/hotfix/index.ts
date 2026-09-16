import { ModuleIdentity } from "#tiangz/module";
import "./SlgWorldSystem";
import "./handlers/WorldSnapshotHandler";

if (ModuleIdentity.id !== "org.tiangz.slg") {
  throw new Error("game module Model bridge is inconsistent");
}

export {};
