import { defineGameModule } from "#tiangz/core";
import * as Public from "./public";
import { NativeData } from "./native/NativeData";
import { modelTypes, requiredSystems } from "./generated/bootstrap";

export * from "./public";
defineGameModule({
  id: "org.tiangz.mmorpg",
  version: "0.6.0-alpha.0",
  modelExports: { ...Public, ...modelTypes },
  requiredSystems,
  processServices: {
    configure: config => NativeData.ConfigureProcess(config),
    takeMetrics: () => ({ nativeData: NativeData.TakeMetrics() }),
  },
});
