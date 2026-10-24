import type { App, AppSeam, ProjectCalls } from "../app/seam";
import { toBase64 } from "../terminal/base64";
import { createXtermEmulators } from "../terminal/emulator";
import { PATIENCE_MS, WARMUP_KEYS, createKeystrokeProbe, typeKeys } from "./keystrokes";
import type { HopSummary, Summary } from "./keystrokes";

const KEYS = 1000;

/** The Terminal's program prints this once its tty is raw (`crates/perf`), so no key is typed into a line-edited tty. */
export const READY = "ready";

export const SETUP_BOUND_MS = 10_000;

const FRAMES = 60;

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Resolves with what `find` returns as soon as the DOM holds it; fails at the bound. */
export const appears = <T>(find: () => T | null, what: string): Promise<T> =>
  new Promise((resolve, reject) => {
    const found = find();

    if (found) return resolve(found);

    const watch = new MutationObserver(() => {
      const next = find();

      if (!next) return;

      watch.disconnect();
      resolve(next);
    });

    watch.observe(document.body, { childList: true, subtree: true, attributes: true });
    setTimeout(() => {
      watch.disconnect();
      reject(new Error(`${what} did not appear within ${SETUP_BOUND_MS} ms`));
    }, SETUP_BOUND_MS);
  });

/** Mean time between animation frames over `FRAMES`: about 8.3 or 16.7 ms when the window is drawn at full rate, far more when throttled behind other windows. */
const frameMs = (): Promise<number> =>
  new Promise((resolve) => {
    let first = 0;

    let seen = 0;

    const tick = (at: number) => {
      if (seen === 0) first = at;

      seen += 1;

      if (seen === FRAMES) resolve((at - first) / (FRAMES - 1));
      else requestAnimationFrame(tick);
    };

    requestAnimationFrame(tick);
  });

/** The smallest step `performance.now()` takes, which is 1 ms in WKWebView. */
export const timerResolutionMs = (): number => {
  let smallest = Infinity;

  for (let read = 0, last = performance.now(); read < 100_000; read += 1) {
    const at = performance.now();

    if (at > last) smallest = Math.min(smallest, at - last);

    last = at;
  }

  return smallest;
};

/** The `PERF` line's body: the K2 numbers and the conditions they were taken in, or the reason there are none (`scenarios/perf.md` K3). */
type PerfReport =
  | { error: string }
  | (Summary & {
      hops: Record<string, HopSummary>;
      hop_uncertainty_ms: number;
      keys: number;
      patience_ms: number;
      renderer: "webgl" | "dom";
      frame_ms: number;
      timer_resolution_ms: number;
      device_pixel_ratio: number;
      user_agent: string;
    });

const press = (textarea: HTMLTextAreaElement) => {
  textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "a", code: "KeyA", keyCode: 65, bubbles: true }));
  textarea.dispatchEvent(new KeyboardEvent("keypress", { key: "a", charCode: 97, keyCode: 97, bubbles: true }));
};

/**
 * The keystroke run of `scenarios/perf.md` (K1 to K3): in a build made with `VITE_ROUNDUP_PERF`, `start` opens a Terminal, types
 * into it and writes one `PERF <json>` line through that Terminal, where `crates/perf` reads it from `terminal.output`.
 */
export const createKeystrokeRun = (app: AppSeam) => {
  const probe = createKeystrokeProbe(() => performance.now(), "a");
  let terminalId: string | null = null;
  let webgl: boolean | null = null;

  let ready: () => void = () => {};

  const isReady = new Promise<void>((resolve) => (ready = resolve));

  const emulators = createXtermEmulators({
    input: probe.input,
    arrived: probe.arrived,
    written: (bytes) => {
      probe.written(bytes);

      if (new TextDecoder().decode(bytes).includes(READY)) ready();
    },
    rendered: probe.rendered,
    renderer: (used) => (webgl = used),
  });

  const report = async (body: PerfReport) => {
    if (terminalId === null) throw new Error("no Terminal was opened to report through");

    const line = `PERF ${JSON.stringify({ probe: "roundup-keystroke-probe", ...body })}\n`;

    await app.rpc("terminal.write", { id: terminalId, data: toBase64(new TextEncoder().encode(line)) });
  };

  const measure = async () => {
    const create = await appears(
      () => [...document.querySelectorAll("button")].find((button) => (button.textContent?.trim() === "new Workstream" || button.getAttribute("aria-label") === "Add Workstream") && button.getAttribute("aria-disabled") !== "true") ?? null,
      "the new Workstream button",
    );

    create.click();
    await appears(() => document.querySelector('[role="treeitem"][aria-selected="true"]'), "the new Workstream's selected row");
    // U165: ⌘T opens the Terminal in the selected Workstream; its bubble takes the keys.
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "t", code: "KeyT", metaKey: true, bubbles: true, cancelable: true }));

    const textarea = await appears(() => document.querySelector<HTMLTextAreaElement>("textarea.xterm-helper-textarea"), "the Terminal's input");

    await Promise.race([isReady, sleep(SETUP_BOUND_MS).then(() => Promise.reject(new Error(`the Terminal never printed ${READY}`)))]);
    textarea.focus();

    const frame = await frameMs();
    const timerResolution = timerResolutionMs();

    await typeKeys(probe, { press: () => press(textarea), sleep, random: Math.random }, KEYS + WARMUP_KEYS);
    await report({
      ...probe.summary(WARMUP_KEYS),
      hops: probe.hops(WARMUP_KEYS),
      hop_uncertainty_ms: timerResolution,
      keys: KEYS,
      patience_ms: PATIENCE_MS,
      renderer: webgl ? "webgl" : "dom",
      frame_ms: frame,
      timer_resolution_ms: timerResolution,
      device_pixel_ratio: window.devicePixelRatio,
      user_agent: navigator.userAgent,
    });
  };

  /** The App's own `terminal.write` calls stamp the dispatch and the Daemon's answer; every call goes through unchanged. */
  const traced = <T extends Pick<ProjectCalls, "rpc">>(calls: T): T => ({
    ...calls,
    rpc: (method, params) => {
      if (method !== "terminal.write") return calls.rpc(method, params);

      probe.dispatched();

      return calls.rpc(method, params).finally(probe.replied);
    },
  });

  return {
    traced: (real: App): App => ({ ...real, forProject: (path) => traced(real.forProject(path)) }),
    createEmulator: (id: string) => {
      terminalId = id;

      return emulators(id);
    },
    start: async () => {
      try {
        await measure();
      } catch (failure) {
        if (!(failure instanceof Error)) throw failure;

        await report({ error: failure.message });
      }
    },
  };
};
