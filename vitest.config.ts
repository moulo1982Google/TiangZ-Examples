import path from "node:path";
import { defineConfig } from "vitest/config";

const root = import.meta.dirname;
const engine = path.resolve(root, "../TiangZ");
const model = path.join(root, "tests/support/model_public.ts");
const coverage = process.argv.some(argument => argument === "--coverage" || argument.startsWith("--coverage."));
export default defineConfig({
  root: coverage ? engine : root,
  plugins: [{ name: "example-model-test-bridge", enforce: "pre", resolveId(source, importer) {
    if (source !== "#tiangz/model") return null;
    return importer?.replaceAll("\\", "/").includes("/modules/mmorpg/src/model/") ? path.join(engine, "app/model/public.ts") : model;
  } }],
  resolve: { alias: [
    { find: "#tiangz/core", replacement: path.join(engine, "app/core/public.ts") },
    { find: "#tiangz/module", replacement: model },
    { find: "#tiangz/modules/org.tiangz.mmorpg", replacement: model },
    { find: "#tiangz/domains", replacement: path.join(engine, "app/model/domains/public.ts") },
    { find: /^vitest$/, replacement: path.join(root, "node_modules/vitest/dist/index.js") },
  ] },
  oxc: { decorator: { legacy: true }, tsconfig: { compilerOptions: { experimentalDecorators: true, useDefineForClassFields: true } } },
  test: { include: coverage ? ["tests/**/*.test.ts", "../TiangZ-Examples/tests/**/*.test.ts"] : ["tests/**/*.test.ts"], pool: "forks", isolate: true, testTimeout: 30000,
    coverage: { provider: "v8", allowExternal: true, include: ["app/core/**/*.ts"], exclude: ["**/*.d.ts"],
      reporter: ["text-summary", "json-summary"], reportsDirectory: "dist/coverage/integration",
      thresholds: { statements: 70, branches: 60, functions: 75, lines: 72 } },
  },
});
