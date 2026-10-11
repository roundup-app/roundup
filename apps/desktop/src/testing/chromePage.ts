import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "vite";
import type { ViteDevServer } from "vite";

/** A headless Chromium on a fresh profile, driven over its DevTools pipe, with Vite serving the U26 harness; never the user's browser. */

export const chromePath = (): string | undefined => {
  const root = process.env["PLAYWRIGHT_BROWSERS_PATH"] ?? "/opt/pw-browsers";

  const bundled = existsSync(root)
    ? readdirSync(root)
        .filter((name) => /^chromium-\d+$/.test(name))
        .flatMap((name) => ["chrome-linux/chrome", "chrome-linux64/chrome", "chrome-mac/Chromium.app/Contents/MacOS/Chromium"].map((sub) => join(root, name, sub)))
    : [];

  return [process.env["CHROME_PATH"], ...bundled, "/usr/bin/google-chrome", "/usr/bin/chromium"].find((path) => path !== undefined && existsSync(path));
};

type Json = string | number | boolean | null | readonly Json[] | { readonly [name: string]: Json };

type Reply = { id?: number; result?: unknown; error?: { message: string } };

type Eval<T> = { result: { value: T }; exceptionDetails?: { text: string; exception?: { description: string } } };

export type ChromePage = {
  /** Loads the harness at `path` (or at an absolute URL) with the window at `width` by `height`. */
  load(path: string, width: number, height: number): Promise<void>;
  /** Resizes the window without reloading the page. */
  resize(width: number, height: number): Promise<void>;
  /** Runs a constant function declaration in the page with `args` passed as data. */
  call<T>(declaration: string, ...args: Json[]): Promise<T>;
  /** Resolves when the page function returns truthy, or throws after `ms` (15 s by default). */
  until(predicate: string, ms?: number): Promise<void>;
  close(): Promise<void>;
};

export const openPage = async (found: string): Promise<ChromePage> => {
  const server: ViteDevServer = await createServer({ root: process.cwd(), server: { port: 0, strictPort: false, hmr: false }, logLevel: "silent" });

  await server.listen();

  const origin = (server.resolvedUrls?.local[0] ?? "").replace(/\/$/, "");
  const profile = mkdtempSync(join(tmpdir(), "chrome-page-"));

  const child: ChildProcess = spawn(
    found,
    ["--headless=new", "--no-sandbox", "--disable-gpu", "--remote-debugging-pipe", `--user-data-dir=${profile}`, "--no-first-run", "about:blank"],
    { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] },
  );

  let next = 0;
  let buffer = "";
  let session = "";
  const waiting = new Map<number, (reply: Reply) => void>();

  const send = <T>(method: string, params: Record<string, Json> = {}, sessionId?: string): Promise<T> => {
    const id = ++next;

    return new Promise((resolve, reject) => {
      // SAFETY: the caller names the result type it expects of this DevTools method.
      waiting.set(id, (reply) => (reply.error ? reject(new Error(`${method}: ${reply.error.message}`)) : resolve(reply.result as T)));
      // SAFETY: the child is spawned with a pipe at fd 3.
      (child.stdio[3] as NodeJS.WritableStream).write(`${JSON.stringify({ id, method, params, sessionId })}\0`);
    });
  };

  // SAFETY: the child is spawned with a pipe at fd 4.
  (child.stdio[4] as NodeJS.ReadableStream).on("data", (chunk: Buffer) => {
    buffer += chunk.toString();

    for (let end = buffer.indexOf("\0"); end >= 0; end = buffer.indexOf("\0")) {
      // SAFETY: Chrome writes one JSON message per NUL on its DevTools pipe.
      const reply = JSON.parse(buffer.slice(0, end)) as Reply;

      buffer = buffer.slice(end + 1);

      if (reply.id !== undefined) waiting.get(reply.id)?.(reply);
    }
  });

  const { targetId } = await send<{ targetId: string }>("Target.createTarget", { url: "about:blank" });

  session = (await send<{ sessionId: string }>("Target.attachToTarget", { targetId, flatten: true })).sessionId;
  await send("Page.enable", {}, session);
  await send("Runtime.enable", {}, session);

  const call = async <T>(declaration: string, ...args: Json[]): Promise<T> => {
    const { result: page } = await send<{ result: { objectId: string } }>("Runtime.evaluate", { expression: "globalThis" }, session);

    const out = await send<Eval<T>>(
      "Runtime.callFunctionOn",
      { objectId: page.objectId, functionDeclaration: declaration, arguments: args.map((value) => ({ value })), returnByValue: true, awaitPromise: true },
      session,
    );

    if (out.exceptionDetails) throw new Error(out.exceptionDetails.exception?.description ?? out.exceptionDetails.text);

    return out.result.value;
  };

  const until = async (predicate: string, ms = 15_000) => {
    const stop = Date.now() + ms;

    while (!(await call<boolean>(predicate))) {
      if (Date.now() > stop) throw new Error(`never became true: ${predicate}`);

      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };

  return {
    call,
    until,
    resize: async (width, height) => {
      await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false }, session);
    },
    load: async (path, width, height) => {
      await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false }, session);
      await send("Page.navigate", { url: path.startsWith("http") ? path : `${origin}${path}` }, session);
    },
    close: async () => {
      const exited = new Promise((resolve) => child.once("exit", resolve));
      const fallback = setTimeout(() => child.kill("SIGKILL"), 5_000);

      await send("Browser.close").catch(() => child.kill("SIGKILL"));
      await exited;
      clearTimeout(fallback);
      await server.close();
      rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    },
  };
};
