import { ModuleIdentity } from "#tiangz/module";

if (ModuleIdentity.id !== "org.tiangz.slg.battlelab") {
  throw new Error("game module Model bridge is inconsistent");
}

export {};
import "./Scenes";
import "./ManagerSystem";
import "./HostSystem";
import "./handlers/Register";
import "./handlers/Submit";
import "./handlers/Inspect";
import "./handlers/Execute";
import "./handlers/Poll";
import "./handlers/DrainManager";
import "./handlers/DrainHost";
import "./handlers/Overview";
