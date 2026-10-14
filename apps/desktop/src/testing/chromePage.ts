import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
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

type Reply = { id?: number; result?: unknown; error?: { message: string }; method?: string; params?: { name?: string; loaderId?: string } };

type Eval<T> = { result: { value: T }; exceptionDetails?: { text: string; exception?: { description: string } } };

export type ChromePage = {
  /** Loads the harness at `path` (or at an absolute URL) with the window at `width` by `height`. */
  load(path: string, width: number, height: number): Promise<void>;
  /** Resizes the window without reloading the page. */
  resize(width: number, height: number): Promise<void>;
  /** Sets the page's `prefers-color-scheme` and, with `more`, `prefers-contrast`; it holds across loads. */
  scheme(name: "light" | "dark", contrast?: "more"): Promise<void>;
  /** Runs a constant function declaration with `args` passed as data; rejects after 20 s without a DevTools reply. */
  call<T>(declaration: string, ...args: Json[]): Promise<T>;
  /** Resolves when the page function returns truthy, or throws after `ms` (15 s by default). */
  until(predicate: string, ms?: number): Promise<void>;
  /** Moves the pointer to the page point (x, y), which makes `:hover` apply there. */
  hover(x: number, y: number): Promise<void>;
  /** Moves the pointer to (x, y) with the primary button down or up: `down` makes `:active` apply on the element there. */
  pointer(type: "down" | "move" | "up", x: number, y: number): Promise<void>;
  /** One real left click (press, then release) at the page point (x, y). */
  click(x: number, y: number): Promise<void>;
  /** Presses the left button down at the page point (x, y) and holds it; `release` lets go. */
  down(x: number, y: number): Promise<void>;
  release(x: number, y: number): Promise<void>;
  /** Sends one real key press (down, then up) to the focused element: `key` as `KeyboardEvent.key`, `code` as `KeyboardEvent.code`; `modifiers` is the CDP bit set (1 is Alt). */
  press(key: string, code: string, modifiers?: number): Promise<void>;
  /** Holds or releases a real key, so a pressed control can be observed before activation. */
  key(type: "down" | "up", key: string, code: string): Promise<void>;
  /** The PNG of the page as base64. */
  shot(): Promise<string>;
  close(): Promise<void>;
};

export const openPage = async (found: string, root = process.cwd(), clock?: number): Promise<ChromePage> => {
  // Each server bundles into its own cache: servers sharing node_modules/.vite/deps delete one another's on start.
  const cacheDir = mkdtempSync(join(tmpdir(), "vite-cache-"));
  const server: ViteDevServer = await createServer({ root, cacheDir, server: { port: 0, strictPort: false, hmr: false }, logLevel: "silent" });

  await server.listen();

  const origin = (server.resolvedUrls?.local[0] ?? "").replace(/\/$/, "");
  const profile = mkdtempSync(join(tmpdir(), "chrome-page-"));

  const child: ChildProcess = spawn(
    found,
    ["--headless=new", "--no-sandbox", "--disable-gpu", "--enable-logging=stderr", "--v=1", "--remote-debugging-pipe", `--user-data-dir=${profile}`, "--no-first-run", "about:blank"],
    {
      stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"],
      // A host session bus can accept a connection without completing its
      // authentication, blocking Chromium startup before DevTools answers.
      // The isolated headless observer needs no desktop session services.
      // Linux Crashpad ignores --user-data-dir and locks settings in the
      // default Chrome config. A different browser holding that lock stops
      // startup before DevTools exists (chrome/common/chrome_paths.cc).
      env: { ...process.env, CHROME_CONFIG_HOME: profile, DBUS_SESSION_BUS_ADDRESS: "disabled:" },
    },
  );

  let diagnostics = "";

  child.stderr?.on("data", (chunk: Buffer) => {
    diagnostics = (diagnostics + chunk.toString()).slice(-8192);
  });

  let next = 0;
  let buffer = "";
  let received = 0;
  let session = "";
  const waiting = new Map<number, (reply: Reply) => void>();
  const loaded = new Set<string>();
  const navigating = new Map<string, () => void>();

  const threads = (): string => {
    if (process.platform !== "linux" || child.pid === undefined) return "unavailable on this host";

    const read = (path: string): string => {
      try {
        return readFileSync(path, "utf8").trim();
      } catch (error) {
        // A thread can exit or deny syscall inspection; keep that failure
        // visible without replacing the original DevTools timeout.
        return `unavailable: ${String(error)}`;
      }
    };

    const pending = [String(child.pid)];
    const seen = new Set<string>();
    const captured: string[] = [];

    // Capture before teardown: a runnable browser may be waiting on a stopped
    // renderer or GPU process. Children belong to individual Linux threads,
    // so the main thread's children file alone can omit that dependency.
    while (pending.length > 0 && seen.size < 32) {
      const pid = pending.shift();

      if (pid === undefined) break;

      if (seen.has(pid)) continue;

      seen.add(pid);

      const root = `/proc/${pid}/task`;

      try {
        const rows = readdirSync(root).slice(0, 128).map((id) => {
          const path = join(root, id);
          const status = read(join(path, "status"));
          const state = status.startsWith("unavailable:") ? status : status.split("\n").filter((line) => /^(Name|State):/.test(line)).join("; ");
          const children = read(join(path, "children"));

          if (!children.startsWith("unavailable:")) {
            for (const descendant of children.split(/\s+/).filter((value) => /^\d+$/.test(value))) {
              if (!seen.has(descendant) && pending.length < 32) pending.push(descendant);
            }
          }

          return `${id} ${state}; wchan=${read(join(path, "wchan"))}; syscall=${read(join(path, "syscall"))}; stat=${read(join(path, "stat"))}; children=${children}`;
        });

        captured.push(`process ${pid}:\n${rows.join("\n")}`);
      } catch (error) {
        // A child exiting during observation must not erase its owner's evidence.
        captured.push(`process ${pid}: unavailable: ${String(error)}`);
      }
    }

    return captured.join("\n");
  };

  // A lost DevTools reply must fail before a layout test's 90 s budget.
  const send = <T>(method: string, params: Record<string, Json> = {}, sessionId?: string): Promise<T> => {
    const id = ++next;
    const started = Date.now();

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        waiting.delete(id);
        reject(new Error(`${method} timed out after 20000 ms; elapsed=${Date.now() - started} ms; Chrome pid=${child.pid}, exit=${child.exitCode}, signal=${child.signalCode}, received=${received} bytes; stderr:\n${diagnostics}\nthreads:\n${threads()}`));
      }, 20_000);

      waiting.set(id, (reply) => {
        clearTimeout(timeout);

        if (reply.error) reject(new Error(`${method}: ${reply.error.message}`));
        else {
          // SAFETY: the caller names the result type it expects of this DevTools method.
          resolve(reply.result as T);
        }
      });
      // SAFETY: the child is spawned with a pipe at fd 3.
      (child.stdio[3] as NodeJS.WritableStream).write(`${JSON.stringify({ id, method, params, sessionId })}\0`);
    });
  };

  // SAFETY: the child is spawned with a pipe at fd 4.
  (child.stdio[4] as NodeJS.ReadableStream).on("data", (chunk: Buffer) => {
    received += chunk.length;
    buffer += chunk.toString();

    for (let end = buffer.indexOf("\0"); end >= 0; end = buffer.indexOf("\0")) {
      // SAFETY: Chrome writes one JSON message per NUL on its DevTools pipe.
      const reply = JSON.parse(buffer.slice(0, end)) as Reply;

      buffer = buffer.slice(end + 1);

      if (reply.id !== undefined) {
        const finish = waiting.get(reply.id);
        waiting.delete(reply.id);
        finish?.(reply);
      }

      if (reply.method === "Page.lifecycleEvent" && reply.params?.name === "DOMContentLoaded" && reply.params.loaderId) {
        const id = reply.params.loaderId;

        loaded.add(id);
        navigating.get(id)?.();
        navigating.delete(id);
      }
    }
  });

  child.once("exit", () => {
    for (const finish of waiting.values()) finish({ error: { message: "Chrome exited before replying" } });
    waiting.clear();
  });

  const close = async () => {
    const exited = child.exitCode !== null || child.signalCode !== null
      ? Promise.resolve()
      : new Promise((resolve) => child.once("exit", resolve));

    const fallback = setTimeout(() => child.kill("SIGKILL"), 5_000);

    // Teardown cannot depend on the DevTools connection it is cleaning up.
    child.kill("SIGTERM");
    await exited;
    clearTimeout(fallback);
    await server.close();

    try {
      rmSync(cacheDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      // vite's dep optimizer may still be writing into its temp cache; the OS clears /tmp
    }

    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch (error) {
      // Chrome helpers can still write after the browser exits; the OS clears this temporary profile.
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOTEMPTY") throw error;
    }
  };

  let targetId = "";
  let media: { name: string; value: string }[] = [];

  const attach = async () => {
    session = (await send<{ sessionId: string }>("Target.attachToTarget", { targetId, flatten: true })).sessionId;
    await send("Page.enable", {}, session);
    await send("Page.setLifecycleEventsEnabled", { enabled: true }, session);
    await send("Runtime.enable", {}, session);
  };

  try {
    targetId = (await send<{ targetId: string }>("Target.createTarget", { url: "about:blank" })).targetId;
    await attach();
  } catch (error) {
    // A failed startup must not leave Chromium competing with the next test file.
    await close();
    throw error;
  }

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
    scheme: async (scheme, contrast) => {
      media = [{ name: "prefers-color-scheme", value: scheme }, ...(contrast ? [{ name: "prefers-contrast", value: contrast }] : [])];

      await send("Emulation.setEmulatedMedia", { features: media }, session);
    },
    hover: async (x, y) => {
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y }, session);
    },
    pointer: async (type, x, y) => {
      await send("Input.dispatchMouseEvent", { type: { down: "mousePressed", move: "mouseMoved", up: "mouseReleased" }[type], x, y, button: type === "move" ? "none" : "left", buttons: type === "down" ? 1 : 0, clickCount: type === "move" ? 0 : 1 }, session);
    },
    click: async (x, y) => {
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y }, session);
      await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 }, session);
      await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 }, session);
    },
    down: async (x, y) => {
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y }, session);
      await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 }, session);
    },
    release: async (x, y) => {
      await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 }, session);
    },
    press: async (key, code, modifiers = 0) => {
      const text = key === "Enter" ? "\r" : key.length === 1 ? key : undefined;

      const type = text === undefined ? "rawKeyDown" : "keyDown";

      await send("Input.dispatchKeyEvent", text === undefined ? { type, key, code, modifiers } : { type, key, code, text, modifiers }, session);
      await send("Input.dispatchKeyEvent", { type: "keyUp", key, code, modifiers }, session);
    },
    key: async (type, key, code) => {
      const text = key === "Enter" ? "\r" : key.length === 1 ? key : undefined;
      const eventType = type === "up" ? "keyUp" : text === undefined ? "rawKeyDown" : "keyDown";

      if (type === "down" && text !== undefined) await send("Input.dispatchKeyEvent", { type: eventType, key, code, text }, session);
      else await send("Input.dispatchKeyEvent", { type: eventType, key, code }, session);
    },
    shot: async () => (await send<{ data: string }>("Page.captureScreenshot", { format: "png" }, session)).data,
    load: async (path, width, height) => {
      // Each observation owns a new tab; an old document's awaited Runtime
      // calls and font readiness cannot follow it into the next seed.
      await send("Target.closeTarget", { targetId });
      targetId = (await send<{ targetId: string }>("Target.createTarget", { url: "about:blank" })).targetId;
      await attach();

      if (clock !== undefined) await send("Page.addScriptToEvaluateOnNewDocument", { source: `Date.now = () => ${clock};` }, session);
      await send("Emulation.setEmulatedMedia", { features: media }, session);
      await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false }, session);
      loaded.clear();
      const navigation = await send<{ loaderId?: string; errorText?: string }>("Page.navigate", { url: path.startsWith("http") ? path : `${origin}${path}` }, session);

      if (navigation.errorText) throw new Error(navigation.errorText);

      // Page.navigate acknowledges the request before replacing the document.
      // Probing the old document can leave an awaited Runtime call stranded
      // when navigation destroys its context (U361/U445's repeated loads).
      if (navigation.loaderId && !loaded.has(navigation.loaderId)) {
        const id = navigation.loaderId;

        await new Promise<void>((resolve) => navigating.set(id, resolve));
      }
    },
    close,
  };
};

/** U422: opens the Thread's `⋯` menu and chooses `All Messages`, once the menu holds it; the Messages are drawn only under it. */
export const openLog = async (page: ChromePage): Promise<void> => {
  await page.until(
    `() => {
      if (document.querySelector("[data-log]")) return true;
      const more = document.querySelector("[aria-label='More']");
      if (!more) return false;
      if (more.getAttribute("aria-expanded") !== "true") more.click();
      const item = [...document.querySelectorAll("[role=menuitem]")].find((each) => each.textContent === "All Messages");
      item?.click();
      return Boolean(document.querySelector("[data-log]"));
    }`,
  );
};
