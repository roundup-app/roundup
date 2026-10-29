import { globSync, readFileSync } from "node:fs";
import postcss from "postcss";
import valueParser from "postcss-value-parser";
import { fileURLToPath } from "node:url";
import solid from "vite-plugin-solid";
import { visualizer } from "rollup-plugin-visualizer";
import { configDefaults, defineConfig } from "vitest/config";
import { realDaemon, realDaemonFromEnv } from "./src/testing/realDaemonPlugin.ts";
import { captureTests } from "./src/testing/captures.ts";
import TimedSequencer from "./src/testing/shardSequencer.ts";

import { buildModules } from "./budgets/build.ts";

const queryTokens = new Map<string, string>();

postcss.parse(readFileSync(new URL("./src/tokens.css", import.meta.url), "utf8")).walkDecls(declaration => {
  if (declaration.prop.startsWith("--query-")) queryTokens.set(declaration.prop, declaration.value);
});

const selectedCaptures = captureTests(process.env.ROUNDUP_CAPTURES);

const captures = selectedCaptures?.files;


const captureIds = selectedCaptures?.ids;

// This shared file also owns logged-in Claude observers; U4590 uses only its deterministic PTY observer.
const startupOnly = captureIds?.includes("U4590") && !captureIds.some(id => ["U463", "U2773g", "U2875d", "U3037d"].includes(id));

if (captureIds) process.env.ROUNDUP_CAPTURES = captureIds.join(",");

type CaptureSelection = { fileParallelism?: boolean; testNamePattern?: RegExp };

const captureSelection: CaptureSelection = {};

if (captures) {
  captureSelection.fileParallelism = false;

  if (captureIds?.every(id => id === "U4590")) captureSelection.testNamePattern = /^(u4590_|u3517[a-d]_|u3529|u4592_|s3806c_)/i;
  else if (startupOnly) captureSelection.testNamePattern = /^(?!u463_|u2773[ag]_|u2875d_real_import_)/i;
}

const captureExcludes = captures ? globSync("src/**/*.test.{ts,tsx}").filter(file => !captures.includes(file)) : [];

const served = realDaemonFromEnv(process.env);

// These scenario-prescribed files own no browser or App server, including S3806b when its caller slice lands.
const webkitGuards = [
  "src/ui/s3806a_interruption.test.tsx",
  "src/ui/s3806b_actions.test.tsx",
  "src/terminal/s3806c_scale.test.ts",
];

// Files that launch Chromium or a real Daemon starve every test sharing their pool: a shard's reds were a hook timing out
// beside them. They run one file at a time in their own project, so two of them never overlap.
const heavy = ["src/**/*_browser.test.{ts,tsx}", "src/**/*_rendered.test.{ts,tsx}", "src/**/*real*.test.{ts,tsx}"];

// Radix Colors scopes light to `:root, .light, .light-theme` and dark to `.dark, .dark-theme`, which the App never toggles
// (U478 clause 1, and styles.css owns the `.light` muted-text class). Rescope the package's own rules at build time: light
// stays on `:root`, dark moves to `:root` under the same media query tokens.css uses.
export default defineConfig({
  build: { manifest: true },
  plugins: [solid(), buildModules(), visualizer({ filename: "../../target/release-modules.json", template: "raw-data" }), ...(served ? [realDaemon(served)] : []), {
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
          postcssPlugin: "roundup-query-tokens",
          Once(root) {
            const reduced = postcss.atRule({ name: "media", params: "(prefers-reduced-motion: reduce)" });
            const rule = postcss.rule({ selector: ":root" });

            const motionTokens = new Set<string>();

            root.walkDecls(/^--(?:duration|delay)-/, declaration => { motionTokens.add(declaration.prop); });

            for (const prop of motionTokens) if (prop !== "--duration-reduced") rule.append(postcss.decl({ prop, value: "0s" }));

            if (motionTokens.size === 0) return;

            reduced.append(rule);
            root.append(reduced);
          },
          AtRule: {
            container(query) {
              const params = valueParser(query.params);

              params.walk(node => {
                if (node.type !== "function" || node.value !== "env") return;

                const name = valueParser.stringify(node.nodes).trim();
                const value = queryTokens.get(name);

                if (!value) throw query.error(`Unknown query Token: ${name}`);
                Object.assign(node, { type: "word", value });
              });
              query.params = params.toString();
            },
          },
        },
        {
          postcssPlugin: "roundup-vendor-control-feedback",
          Once(root) {
            root.walkDecls(/^(?:animation|transition)(?:-.+)?$/, declaration => {
              if (!declaration.source?.input.file?.includes("/node_modules/")) return;

              const value = valueParser(declaration.value);

              value.walk(node => {
                if (node.type !== "word") return;

                const dimension = valueParser.unit(node.value);

                if (dimension && (dimension.unit === "ms" || dimension.unit === "s")) node.value = `var(--duration-vendor, ${node.value})`;
              });
              declaration.value = value.toString();
            });
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
          // Every webview the App ships on reads woff2; KaTeX's woff and ttf fallbacks add ~800 KB to C9c's byte cap.
          postcssPlugin: "katex-woff2-only",
          AtRule: {
            "font-face"(face) {
              if (!face.source?.input.file?.includes("/katex/")) return;

              face.walkDecls("src", declaration => {
                const sources = declaration.value.split(/,(?![^(]*\))/).filter(source => source.includes("format(\"woff2\")"));

                if (sources.length === 0) throw declaration.error("KaTeX @font-face has no woff2 source");
                declaration.value = sources.join(",");
              });
            },
          },
        },
        {
          postcssPlugin: "radix-colors-prefers-color-scheme",
          Once(root, { AtRule }) {
            for (const node of [...root.nodes]) {
              if ((node.type !== "rule" && node.type !== "atrule") || !node.source?.input.file?.includes("/@radix-ui/colors/")) continue;

              const rules: { selector: string }[] = [];

              if (node.type === "rule") rules.push(node);
              else node.walkRules((rule) => void rules.push(rule));

              const dark = rules.some((rule) => /\.dark\b/.test(rule.selector));


              for (const rule of rules) rule.selector = ":root";

              const explicit = node.clone();

              if (explicit.type === "rule") explicit.selector = `:root[data-mode="${dark ? "dark" : "light"}"]`;
              else explicit.walkRules(rule => { rule.selector = `:root[data-mode="${dark ? "dark" : "light"}"]`; });
              node.after(explicit);

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
    ...captureSelection,
    // A shard's real-Claude and Chromium files starve the first test of a file past vitest's 5 s (owner's choice, 2026-10-17); a test that sets its own longer limit keeps it.
    testTimeout: 15_000,
    // L122: a flaky test runs twice before it fails; the lane lists a pass on the retry as flaky.
    // No web test asserts a product's time bound on a real clock.
    retry: 1,
    // Complete per-test evidence stays in check logs, alongside human failure diagnostics.
    reporters: ["default", ["json", { stdout: true }]],
    // Vitest returns empty CSS by default; the Drawer and tokens tests need the real rules.
    css: { include: [/styles\.css/, /tokens\.css/, /buttons\.css/, /xterm\.css/, /src\/ui\/\w+\.css/] },
    // L89: `--shard` balances by measured time, not path hash.
    sequence: { sequencer: TimedSequencer },
    setupFiles: ["src/testing/domStubs.ts"],
    // Inline projects inherit jsdom, stubs, transforms and resolution. Only queued App tests start their global setup.
    projects: [
      { test: { name: "webkit-guards", include: webkitGuards, exclude: captureExcludes } },
      {
        test: {
          name: "app",
          include: ["src/**/*.test.{ts,tsx}"],
          exclude: [...configDefaults.exclude, ...webkitGuards, ...heavy, ...captureExcludes],
          globalSetup: ["src/testing/warmChrome.ts", "src/testing/globalAppServer.ts"],
        },
      },
      {
        test: {
          name: "heavy",
          include: heavy,
          exclude: [...configDefaults.exclude, ...webkitGuards, ...captureExcludes],
          fileParallelism: false,
          // Projects of one group share the pool; a later group starts after the earlier one ends, so no app file overlaps a heavy one.
          sequence: { groupOrder: 1 },
          globalSetup: ["src/testing/warmChrome.ts", "src/testing/globalAppServer.ts"],
        },
      },
    ],
    // jsdom resolves the server build of solid-js unless told to use the browser one.
    server: { deps: { inline: [/solid-js/, /@excalidraw/] } },
  },
  resolve: {
    conditions: ["browser", "development|production"],
    // tsconfig.json's `@contracts/*` path, for the one value the webview imports from there (S11).
    alias: {
      "@contracts": fileURLToPath(new URL("../../contracts/generated", import.meta.url)),
      // 0.10 ships its declared ESM module but omits its CommonJS main.
      "@xterm/addon-ligatures": fileURLToPath(new URL("./node_modules/@xterm/addon-ligatures/lib/addon-ligatures.mjs", import.meta.url)),
    },
  },
});
