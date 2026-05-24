import { defineConfig, Plugin } from "vitest/config";
import { createRequire } from "node:module";

// node:sqlite is experimental and not listed in builtinModules, so Vite strips
// the "node:" prefix and then fails to find a file called "sqlite".
// This plugin intercepts both ids and provides a virtual module that loads
// DatabaseSync via createRequire to avoid going through Vite's transform pipeline.
function nodeSqliteExternalPlugin(): Plugin {
  const virtualId = "\0virtual:node-sqlite";
  const req = createRequire(import.meta.url);
  return {
    name: "node-sqlite-external",
    enforce: "pre",
    resolveId(id) {
      if (id === "node:sqlite" || id === "sqlite") {
        return virtualId;
      }
    },
    load(id) {
      if (id === virtualId) {
        // Load node:sqlite via require() at config-evaluation time (synchronous, no
        // Vite re-interception). Then inline the exports as module-level constants.
        const mod = req("node:sqlite") as Record<string, unknown>;
        const exports = Object.keys(mod);
        return [
          `const _m = require("node:sqlite");`,
          ...exports.map(k => `export const ${k} = _m.${k};`),
        ].join("\n");
      }
    },
  };
}

export default defineConfig({
  plugins: [nodeSqliteExternalPlugin()],
  test: {
    pool: "forks",
  },
});
