import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { createReadStream, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { finished } from "node:stream/promises";
import { appServer } from "./appServer.ts";

/** A headless Chromium on a fresh profile, driven over its DevTools pipe, with Vite serving the U26 harness; never the user's browser. */

/** Flags for a headless test Chrome on a fresh profile: the mock keychain and basic password store keep macOS from asking the user for keychain access. */
export const headlessChromeArgs = ["--headless=new", "--no-sandbox", "--disable-gpu", "--use-mock-keychain", "--password-store=basic", "--remote-debugging-pipe", "--no-first-run"];

export const chromePath = (): string | undefined => {
  const root = process.env["PLAYWRIGHT_BROWSERS_PATH"] ?? "/opt/pw-browsers";

  const bundled = existsSync(root)
    ? readdirSync(root)
        .filter((name) => /^chromium-\d+$/.test(name))
        .flatMap((name) => ["chrome-linux/chrome", "chrome-linux64/chrome", "chrome-mac/Chromium.app/Contents/MacOS/Chromium"].map((sub) => join(root, name, sub)))
    : [];

  return [process.env["CHROME_PATH"], ...bundled, "/opt/google/chrome/chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find((path) => path !== undefined && existsSync(path));
};

type Json = string | number | boolean | null | readonly Json[] | { readonly [name: string]: Json };

type Reply = { id?: number; result?: unknown; error?: { message: string }; method?: string; params?: { name?: string; loaderId?: string } };

type Eval<T> = { result: { value: T }; exceptionDetails?: { text: string; exception?: { description: string } } };

export type ChromePage = {
  /** Loads the harness at `path` (or at an absolute URL) with the window at `width` by `height`. */
  load(path: string, width: number, height: number): Promise<void>;
  /** Resizes the window without reloading the page. */
  resize(width: number, height: number): Promise<void>;
  /** Sets the page's `prefers-color-scheme` and, with `more`, `prefers-contrast`; optional reduced motion or transparency; all hold across loads. */
  scheme(name: "light" | "dark", contrast?: "more", reduced?: "motion" | "transparency"): Promise<void>;
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
  /** Two real left clicks at the page point (x, y), the second with a click count of 2, so the page receives `dblclick`. */
  doubleClick(x: number, y: number): Promise<void>;
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

/** Startup awaits the page acknowledgement and attachment within startupMs (defaults to the measured 60000 ms stall bound; tools/chromium-faults/issue-1977.md). Post-startup replies retain replyMs; observe reports completed stages in elapsed milliseconds. */
export const openPage = async (
  found: string,
  { root = process.cwd(), clock, replyMs = 20_000, startupMs = 60_000, observe }: { root?: string; clock?: number; replyMs?: number; startupMs?: number; observe?: (stage: string, elapsedMs: number) => void } = {},
): Promise<ChromePage> => {
  const startup = performance.now();
  let stage = "executable-reading";
  let ready = false;
  // A move while the button is held carries `buttons: 1`, as a real drag does.
  let held = false;

  const completed = (name: string) => {
    stage = name;
    observe?.(name, performance.now() - startup);
  };

  completed(stage);

  if (process.platform === "linux") {
    // U26's private cold executable at 100 read IOPS exhausts 20 s on
    // scattered demand faults. Large sequential reads use fewer disk requests
    // (3.1 s total at 140 IOPS versus two startup timeouts without them).
    // Stream rather than retaining Chrome's ~300 MB executable in Node's RSS.
    const executable = createReadStream(found, { highWaterMark: 4 * 1024 * 1024, signal: AbortSignal.timeout(startupMs) });

    executable.resume();

    try {
      await finished(executable);
    } catch (error) {
      throw new Error(`Chromium startup timed out or failed during ${stage}; limit=${startupMs} ms; elapsed=${performance.now() - startup} ms`, { cause: error });
    }
  }

  completed("executable-read");

  const server = await appServer({ root });

  completed("server-listening");

  const origin = (server.resolvedUrls?.local[0] ?? "").replace(/\/$/, "");
  const profile = mkdtempSync(join(tmpdir(), "chrome-page-"));

  const child: ChildProcess = spawn(
    found,
    [...headlessChromeArgs, "--enable-logging=stderr", "--v=1", `--user-data-dir=${profile}`, "about:blank"],
    {
      stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"],
      // A host session bus can accept a connection without completing its
      // authentication, blocking Chromium startup before DevTools answers.
      // The isolated headless observer needs no desktop session services.
      // Linux Crashpad ignores --user-data-dir and locks settings in the
      // default Chrome config. A different browser holding that lock stops
      // startup before DevTools exists (chrome/common/chrome_paths.cc).
      env: {
        ...process.env,
        CHROME_CONFIG_HOME: profile,
        // System Fontconfig includes per-user files even without FONTCONFIG
        // overrides. A host HOME or XDG config can hold those startup reads;
        // inherited cache paths can also disappear when another test closes.
        HOME: profile,
        XDG_CONFIG_HOME: join(profile, "config"),
        XDG_CACHE_HOME: join(profile, "cache"),
        DBUS_SESSION_BUS_ADDRESS: "disabled:",
        // Fontconfig opens inherited configuration on a startup worker; a held
        // read leaves the browser waiting before its DevTools pipe answers.
        // The observer renders with the installed fonts and system config.
        FONTCONFIG_FILE: undefined,
        FONTCONFIG_PATH: undefined,
        FONTCONFIG_SYSROOT: undefined,
      },
    },
  );

  completed("launched");

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
  let failure: string | undefined;
  let closing = false;

  const fail = (message: string) => {
    failure ??= message;

    for (const finish of waiting.values()) finish({ error: { message: failure } });
    waiting.clear();
  };

  // Both DevTools descriptors are sockets. Closing one with unread bytes can
  // reset it while Chrome stays alive; process exit alone cannot settle that
  // request. Keep the first failure for later calls on the same connection.
  for (const [index, name] of [[3, "request"], [4, "reply"]] as const) {
    const pipe = child.stdio[index];

    pipe?.on("error", (error: Error) => {
      if (!closing) fail(`DevTools ${name} pipe: ${error.message}`);
    });
    pipe?.on("close", () => {
      if (!closing) fail(`DevTools ${name} pipe closed before replying`);
    });
  }

  const threads = (): string => {
    if (process.platform !== "linux" || child.pid === undefined) return "unavailable on this host";

    const read = (path: string): string => {
      try {
        return readFileSync(path, "utf8").trim();
      } catch (error) {
        // A process can exit or deny inspection; keep that failure
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

      captured.push(`process ${pid} memory mappings:\n${read(`/proc/${pid}/maps`)}`);

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
    if (failure !== undefined) return Promise.reject(new Error(`${method}: ${failure}`));

    const id = ++next;
    const started = ready ? performance.now() : startup;
    const limit = ready ? replyMs : startupMs;
    const budget = Math.max(0, limit - (performance.now() - started));

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        waiting.delete(id);
        reject(new Error(`${method} timed out after ${limit} ms; last completed stage=${stage}; elapsed=${performance.now() - started} ms; Chrome pid=${child.pid}, exit=${child.exitCode}, signal=${child.signalCode}, received=${received} bytes; stderr:\n${diagnostics}\nthreads:\n${threads()}`));
      }, budget);

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
    fail("Chrome exited before replying");
  });

  const close = async () => {
    closing = true;

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
    // Target.createTarget acknowledges a real page in Chromium; executable
    // reading alone cannot settle startup. Attachment keeps the same absolute
    // startup bound; normal calls retain their separate reply deadline.
    targetId = (await send<{ targetId: string }>("Target.createTarget", { url: "about:blank" })).targetId;
    completed("target-created");
    await attach();
    completed("page-ready");
    ready = true;
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
    scheme: async (scheme, contrast, reduced) => {
      media = [{ name: "prefers-color-scheme", value: scheme }, ...(contrast ? [{ name: "prefers-contrast", value: contrast }] : []), ...(reduced ? [{ name: `prefers-reduced-${reduced}`, value: "reduce" }] : [])];

      await send("Emulation.setEmulatedMedia", { features: media }, session);
    },
    hover: async (x, y) => {
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y }, session);
    },
    pointer: async (type, x, y) => {
      if (type !== "move") held = type === "down";

      await send("Input.dispatchMouseEvent", { type: { down: "mousePressed", move: "mouseMoved", up: "mouseReleased" }[type], x, y, button: type === "move" ? "none" : "left", buttons: type === "down" || (type === "move" && held) ? 1 : 0, clickCount: type === "move" ? 0 : 1 }, session);
    },
    click: async (x, y) => {
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y }, session);
      await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 }, session);
      await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 }, session);
    },
    doubleClick: async (x, y) => {
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y }, session);

      for (const clickCount of [1, 2]) {
        await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount }, session);
        await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount }, session);
      }
    },
    down: async (x, y) => {
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y }, session);
      await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 }, session);
      held = true;
    },
    release: async (x, y) => {
      held = false;
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
