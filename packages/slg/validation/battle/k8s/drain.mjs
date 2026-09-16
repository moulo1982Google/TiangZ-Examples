import { readFile, writeFile } from "node:fs/promises";
import { connect } from "./client.mjs";

// preStop 是补充防线，不能代替先排空再修改 replicas 的受控缩容。
const config = JSON.parse(await readFile("/game/configs/process.json", "utf8"));
const name = config.scenes[0].name;
const connection = await connect(3000, "battle-manager");
try {
  const deadline = Date.now() + 15000;
  while (true) {
    if ((await connection.client.drain({ node: name })).idle) break;
    if (Date.now() > deadline) throw new Error("drain confirmation timed out; not safe to discard work");
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  await writeFile("/game/configs/drained", name);
  console.log(`[battle-k8s] drain confirmed ${name}`);
} finally { connection.close(); }
