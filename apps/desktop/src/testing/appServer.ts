import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "vite";

/** The Vite server a test drives its browser against: `resolvedUrls.local[0]` is its origin, with a trailing slash. */
export type AppServer = { resolvedUrls: { local: string[] }; close(): Promise<void> };

/** Where the run's shared server listens; `globalAppServer` sets it before the workers start. */
export const SHARED_APP_SERVER = "ROUNDUP_APP_SERVER";

/** A Vite server on `root`'s own config, in a cache of its own: servers sharing a cache delete one another's bundled dependencies. */
export const startAppServer = async ({ root = process.cwd() }: { root?: string } = {}): Promise<AppServer> => {
  const cacheDir = mkdtempSync(join(tmpdir(), "vite-cache-"));

  // `@solidjs/testing-library` is imported only by the keyboard observer's page; bundling it up front keeps its first load from reloading the page.
  const server = await createServer({ root, cacheDir, server: { port: 0, strictPort: false, hmr: false, host: "127.0.0.1" }, logLevel: "silent", optimizeDeps: { include: ["@solidjs/testing-library"] } });

  await server.listen();
  // Compile the harness's static imports before a browser's App-readiness bound starts.
  await server.warmupRequest("/src/testing/harness.tsx");
  await server.waitForRequestsIdle();

  return {
    resolvedUrls: { local: server.resolvedUrls?.local ?? [] },
    close: async () => {
      await server.close();

      try {
        rmSync(cacheDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      } catch {
        // vite's dep optimizer may still be writing into its temp cache; the OS clears /tmp
      }
    },
  };
};

/**
 * The App's server for a test. Under Vitest every file shares one server, which transforms each module once for the
 * whole run: a server of each file's own transformed the same 500 modules again, about 10 s of a CI runner's CPU per file.
 * Outside Vitest, or for another `root`, it starts one of its own.
 */
export const appServer = async ({ root = process.cwd() }: { root?: string } = {}): Promise<AppServer> => {
  const shared = process.env[SHARED_APP_SERVER];

  if (shared === undefined) return startAppServer({ root });

  // SAFETY: `globalAppServer` writes this value as `{ root, origin }`.
  const served = JSON.parse(shared) as { root: string; origin: string };

  if (served.root !== root) return startAppServer({ root });

  return { resolvedUrls: { local: [served.origin] }, close: async () => {} };
};
