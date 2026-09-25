import path from "node:path";
import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

const root = import.meta.dirname;
const engine = path.resolve(process.env.TIANGZ_ENGINE_ROOT ?? path.join(root, "../TiangZ"));
const legacyEngine = path.resolve(root, "../TiangZ");
const sdkRoot = path.join(engine, "node_modules/@tiangz/dbproxy-sdk");
const sdkManifest = JSON.parse(readFileSync(path.join(sdkRoot, "package.json"), "utf8"));
const sdkEntry = sdkManifest.exports?.["."]?.import ?? sdkManifest.main;
if (typeof sdkEntry !== "string") throw new Error("Selected host DBProxy SDK has no import entry; prepare its dependencies first.");
const model = path.join(root, "tests/support/model_public.ts");
const coverage = process.argv.some(argument => argument === "--coverage" || argument.startsWith("--coverage."));
export default defineConfig({
  root: coverage ? engine : root,
  plugins: [{ name: "example-model-test-bridge", enforce: "pre", async resolveId(source, importer) {
    // 历史测试直接导入宿主内部文件；显式宿主切换时必须保持同一份 Core 身份。
    // Historical internal imports must follow the explicitly selected host as well.
    if (engine !== legacyEngine && importer && source.startsWith(".")) {
      const resolved = path.resolve(path.dirname(importer), source);
      const relative = path.relative(legacyEngine, resolved);
      if (!relative.startsWith("..") && !path.isAbsolute(relative) && /^(app|tools)[\\/]/.test(relative)) return this.resolve(path.join(engine, relative), importer, { skipSelf: true });
    }
    if (source !== "#tiangz/model") return null;
    return importer?.replaceAll("\\", "/").includes("/modules/mmorpg/src/model/") ? path.join(engine, "app/model/public.ts") : model;
  } }],
  resolve: { alias: [
    { find: /^@tiangz\/dbproxy-sdk$/, replacement: path.resolve(sdkRoot, sdkEntry) },
    { find: "#tiangz/core", replacement: path.join(engine, "app/core/public.ts") },
    { find: "#tiangz/module", replacement: model },
    { find: "#tiangz/modules/org.tiangz.mmorpg", replacement: model },
    { find: "#tiangz/domains", replacement: path.join(engine, "app/model/domains/public.ts") },
    { find: /^vitest$/, replacement: path.join(root, "node_modules/vitest/dist/index.js") },
  ] },
  oxc: { decorator: { legacy: true }, tsconfig: { compilerOptions: { experimentalDecorators: true, useDefineForClassFields: true } } },
  test: { include: coverage ? ["tests/**/*.test.ts", `${path.relative(engine, root).replaceAll("\\", "/")}/tests/**/*.test.ts`] : ["tests/**/*.test.ts"], pool: "forks", isolate: true, testTimeout: 30000,
    coverage: { provider: "v8", allowExternal: true, include: ["app/core/**/*.ts"], exclude: ["**/*.d.ts"],
      reporter: ["text-summary", "json-summary"], reportsDirectory: "dist/coverage/integration",
      thresholds: { statements: 70, branches: 60, functions: 75, lines: 72 } },
  },
});
