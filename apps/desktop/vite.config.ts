import { fileURLToPath } from "node:url";
import solid from "vite-plugin-solid";
import { defineConfig } from "vitest/config";
import { realDaemon, realDaemonFromEnv } from "./src/testing/realDaemonPlugin.ts";
import TimedSequencer from "./src/testing/shardSequencer.ts";

const served = realDaemonFromEnv(process.env);

// Radix Colors scopes light to `:root, .light, .light-theme` and dark to `.dark, .dark-theme`, which the App never toggles
// (U478 clause 1, and styles.css owns the `.light` muted-text class). Rescope the package's own rules at build time: light
// stays on `:root`, dark moves to `:root` under the same media query tokens.css uses.
export default defineConfig({
  plugins: [solid(), ...(served ? [realDaemon(served)] : []), {
    name: "roundup-dev-ready",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__roundup_ready", async (_request, response) => {
        try {
          const client = server.environments.client;

          if (!client) throw new Error("Vite has no client environment");
          const urls = new Set(["/src/main.tsx"]);

          for (const url of urls) {
            if (response.destroyed) return;

            const transformed = await client.transformRequest(url);
            const module = await client.moduleGraph.getModuleByUrl(url);

            if (!transformed || !module) throw new Error(`Vite could not transform ${url}`);

            for (const imported of module.importedModules) urls.add(imported.url);
          }

          response.writeHead(204).end();
        } catch (error) {
          response.writeHead(500, { "Content-Type": "text/plain" });
          response.end(String(error));
        }
      });
    },
  }],
  css: {
    postcss: {
      plugins: [
        {
          postcssPlugin: "roundup-vendor-control-feedback",
          Once(root) {
            // Imported editors keep their selection paint, but cannot add rings or press washes (U3528).
            root.walkRules((rule) => {
              if (!rule.source?.input.file?.includes("/node_modules/")) return;

              const paints = rule.nodes.some(node => node.type === "decl" && /^(?:background(?:-.+)?|border(?:-.+)?|box-shadow|outline(?:-.+)?|--.*(?:background|bg|pressed))$/.test(node.prop));

              const selectors = rule.selectors.filter(selector => {
                const focus = /:focus-visible\b|\[data-focus/.test(selector) || (paints && /(?<!:not\():focus(?:-within)?\b/.test(selector));

                return !focus && !(paints && /:active\b/.test(selector));
              });

              if (selectors.length === 0) rule.remove();
              else rule.selectors = selectors;
            });
          },
        },
        {
          postcssPlugin: "radix-colors-prefers-color-scheme",
          Once(root, { AtRule }) {
            for (const node of root.nodes) {
              if ((node.type !== "rule" && node.type !== "atrule") || !node.source?.input.file?.includes("/@radix-ui/colors/")) continue;

              const rules: { selector: string }[] = [];

              if (node.type === "rule") rules.push(node);
              else node.walkRules((rule) => void rules.push(rule));

              const dark = rules.some((rule) => /\.dark\b/.test(rule.selector));


              for (const rule of rules) rule.selector = ":root";

              if (!dark) continue;
              const scoped = new AtRule({ name: "media", params: "(prefers-color-scheme: dark)" });

              node.replaceWith(scoped);
              scoped.append(node);
            }
          },
        },
      ],
    },
  },
  // tauri.conf.json's devUrl names this port; moving off it must fail, not open a blank window.
  server: { port: 5173, strictPort: true },
  test: {
    environment: "jsdom",
    // A shard's real-Claude and Chromium files starve the first test of a file past vitest's 5 s (owner's choice, 2026-10-17); a test that sets its own longer limit keeps it.
    testTimeout: 15_000,
    // L122: a flaky test runs twice before it fails; the lane lists a pass on the retry as flaky.
    // No web test asserts a product's time bound on a real clock.
    retry: 1,
    // Complete per-test evidence stays in check logs, alongside human failure diagnostics.
    reporters: ["default", ["json", { stdout: true }]],
    // Vitest returns empty CSS by default; the Drawer and tokens tests need the real rules.
    css: { include: [/styles\.css/, /tokens\.css/, /buttons\.css/, /xterm\.css/, /src\/ui\/\w+\.css/] },
    include: ["src/**/*.test.{ts,tsx}"],
    // L89: `--shard` balances by measured time, not path hash.
    sequence: { sequencer: TimedSequencer },
    setupFiles: ["src/testing/domStubs.ts"],
    globalSetup: ["src/testing/warmChrome.ts", "src/testing/globalAppServer.ts"],
    // jsdom resolves the server build of solid-js unless told to use the browser one.
    server: { deps: { inline: [/solid-js/, /@excalidraw/] } },
  },
  resolve: {
    conditions: ["browser", "development|production"],
    // tsconfig.json's `@contracts/*` path, for the one value the webview imports from there (S11).
    alias: { "@contracts": fileURLToPath(new URL("../../contracts/generated", import.meta.url)) },
  },
});
