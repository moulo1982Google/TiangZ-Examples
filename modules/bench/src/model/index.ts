import { defineGameModule } from "#tiangz/core";
import { BenchScene } from "./scenes/BenchScene";
import { MailboxParityScene } from "./scenes/MailboxParityScene";
export { BenchScene, MailboxParityScene };
defineGameModule({ id: "org.tiangz.bench", version: "0.7.0-rc.1", modelExports: { BenchScene, MailboxParityScene } });
