import { defineGameModule } from "#tiangz/core";
import { BenchScene } from "./scenes/BenchScene";
import { MailboxParityScene } from "./scenes/MailboxParityScene";
export { BenchScene, MailboxParityScene };
defineGameModule({ id: "org.tiangz.bench", version: "0.6.0-alpha.0", modelExports: { BenchScene, MailboxParityScene } });
