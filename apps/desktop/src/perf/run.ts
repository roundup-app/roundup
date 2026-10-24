import type { App, AppSeam, ProjectCalls } from "../app/seam";
import { toBase64 } from "../terminal/base64";
import { createXtermEmulators } from "../terminal/emulator";
import type { Emulator } from "../terminal/emulator";
import { PATIENCE_MS, WARMUP_KEYS, createKeystrokeProbe, typeKeys } from "./keystrokes";
import type { HopSummary, Summary } from "./keystrokes";

const KEYS = 1000;

/** The Terminal's program prints this once its tty is raw (`crates/perf`), so no key is typed into a line-edited tty. */
export const READY = "ready";

export const SETUP_BOUND_MS = 10_000;

/** The whole of typing, warm-up included: 1100 keys take about 70 s, so this leaves room under the runner's 240 s for a slow machine, and a run that drops every key still reports. */
export const TYPING_BOUND_MS = 150_000;

const FRAMES = 60;

/** A report holds every hop, so it is a few KiB; one write that large into a tty under the stream is the likeliest to be cut short. */
const WRITE_CHUNK = 4096;

/** Hands `bytes` to `write` in order, `WRITE_CHUNK` at a time, each after the last was accepted. */
export const writeInChunks = async (bytes: Uint8Array, write: (chunk: Uint8Array) => Promise<void>): Promise<void> => {
  for (let at = 0; at < bytes.length; at += WRITE_CHUNK) await write(bytes.subarray(at, at + WRITE_CHUNK));
};

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Settles with `work`, or rejects naming `step` once `ms` pass: a setup call that never answers must still end in a report line, with its cause. */
export const bounded = <T>(work: Promise<T>, ms: number, step: string): Promise<T> =>
  Promise.race([work, sleep(ms).then(() => Promise.reject(new Error(`${step} did not finish within ${ms} ms`)))]);

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
 * The report goes through the Terminal whose program printed `READY`, never the last one the page created: the workstream's `claude` Terminal
 * also gets an emulator, and a report written into it never reaches the runner reading the shell's output.
 */
export const reportTerminal = <E extends Pick<Emulator, "write">>(create: (id: string) => E) => {
  let target: string | null = null;
  let announce: () => void = () => {};

  const printed = new Promise<void>((resolve) => (announce = resolve));

  return {
    printed,
    target: () => target,
    /** K3 types into the same Terminal as the report; an Agent can already have an xterm input earlier in the document. */
    input: () => [...document.querySelectorAll<HTMLElement>(".bubble[data-bubble]")]
      .find((bubble) => bubble.dataset.bubble === target)
      ?.querySelector<HTMLTextAreaElement>("textarea.xterm-helper-textarea") ?? null,
    createEmulator: (id: string): E => {
      const emulator = create(id);
      const decoder = new TextDecoder();
      // A PTY may split READY anywhere; retain its preceding newline without buffering an unbounded output line.
      let tail = "\n";

      return {
        ...emulator,
        write: (bytes, parsed) =>
          emulator.write(bytes, () => {
            if (target === null) {
              const text = tail + decoder.decode(bytes, { stream: true });

              if (text.includes(`\n${READY}\n`) || text.includes(`\n${READY}\r\n`)) {
                target = id;
                announce();
              }

              tail = text.slice(-(READY.length + 2));
            }

            parsed?.();
          }),
      };
    },
  };
};

/**
 * The keystroke run of `scenarios/perf.md` (K1 to K3): in a build made with `VITE_ROUNDUP_PERF`, `start` opens a Terminal, types
 * into it and writes one `PERF <json>` line through that Terminal, where `crates/perf` reads it from `terminal.output`.
 */
export const createKeystrokeRun = (app: AppSeam) => {
  const probe = createKeystrokeProbe(() => performance.now(), "a");
  let webgl: boolean | null = null;

  const terminal = reportTerminal(
    createXtermEmulators({
      input: probe.input,
      arrived: probe.arrived,
      written: probe.written,
      rendered: probe.rendered,
      renderer: (used) => (webgl = used),
    }),
  );

  const report = async (body: PerfReport) => {
    const id = terminal.target();

    if (id === null) throw new Error("no Terminal printed the ready line to report through");

    const line = `PERF ${JSON.stringify({ probe: "roundup-keystroke-probe", ...body })}\n`;

    await writeInChunks(new TextEncoder().encode(line), async (data) => void (await app.rpc("terminal.write", { id, data: toBase64(data) })));
  };

  const measure = async () => {
    const create = await appears(
      () => [...document.querySelectorAll("button")].find((button) => (button.textContent?.trim() === "new Workstream" || button.getAttribute("aria-label") === "Add Workstream") && button.getAttribute("aria-disabled") !== "true") ?? null,
      "the new Workstream button",
    );

    create.click();
    await appears(() => document.querySelector('[role="treeitem"][aria-selected="true"]'), "the new Workstream's selected row");
    // The Workstream's Agent Terminal takes focus when it shows, and focus outside a bubble folds it, which pauses xterm's rendering: open the bubble after.
    await appears(
      () => [...document.querySelectorAll("textarea.xterm-helper-textarea")].find((input) => !input.closest(".bubble[data-bubble]")) ?? null,
      "the new Workstream's Agent input",
    );
    // U165: ⌘T opens the Terminal in the selected Workstream; its bubble takes the keys.
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "t", code: "KeyT", metaKey: true, bubbles: true, cancelable: true }));

    await bounded(terminal.printed, SETUP_BOUND_MS, `the Terminal's ${READY} line`);

    const textarea = await appears(terminal.input, "the ready Terminal's input");
    textarea.focus();

    // A window drawn at no rate gives no animation frame: the run must say so rather than wait for one.
    const frame = await bounded(frameMs(), SETUP_BOUND_MS, "the display frames");
    const timerResolution = timerResolutionMs();
    const end = performance.now() + TYPING_BOUND_MS;

    await typeKeys(probe, { press: () => press(textarea), sleep, random: Math.random, expired: () => performance.now() > end }, KEYS + WARMUP_KEYS);
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
    createEmulator: terminal.createEmulator,
    start: async () => {
      try {
        await measure();
      } catch (failure) {
        await report({ error: failure instanceof Error ? failure.message : String(failure) });
      }
    },
  };
};
