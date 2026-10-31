import type { App, AppSeam } from "../app/seam";
import type { Calibration, Exchange } from "./calibration";
import { toBase64 } from "../terminal/base64";
import { createRecorder } from "./recorder";
import type { Emulator } from "../terminal/emulator";
import { PATIENCE_MS, WARMUP_KEYS, typeKeys } from "./keystrokes";
import type { HopSummary, Summary } from "./keystrokes";
import type { Series } from "./switch_run";
import { SWITCH_PROBE } from "./switch";
import { runSwitchWorkload } from "./switch_run";

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
      calibration: Calibration;
      keys: number;
      patience_ms: number;
      renderer: "webgl" | "dom";
      frame_ms: number;
      timer_resolution_ms: number;
      device_pixel_ratio: number;
      user_agent: string;
    } & Partial<{ switcher_open_p95_ms: number; switch_p95_ms: number; switcher_open: Series; switch: Series }>);

/** Follow the browser's cancellation rule: xterm can send the key on keydown, so forcing keypress would write the same identity twice. */
export const press = (textarea: HTMLTextAreaElement) => {
  const down = new KeyboardEvent("keydown", { key: "a", code: "KeyA", keyCode: 65, bubbles: true, cancelable: true });

  if (textarea.dispatchEvent(down)) {
    textarea.dispatchEvent(new KeyboardEvent("keypress", { key: "a", charCode: 97, keyCode: 97, bubbles: true, cancelable: true }));
  }

  textarea.dispatchEvent(new KeyboardEvent("keyup", { key: "a", code: "KeyA", keyCode: 65, bubbles: true }));
};

const hasReadyLine = (text: string) => text.includes(`\n${READY}\n`) || text.includes(`\n${READY}\r\n`);

/** Binds parsed or retained readiness and the report to the shell selected by terminalReady. */
export const reportTerminal = <E extends Pick<Emulator, "write">>(create: (id: string) => E) => {
  let target: string | null = null;
  let expected: string | null = null;
  const ready = new Set<string>();
  let announce: () => void = () => {};

  const printed = new Promise<void>((resolve) => (announce = resolve));

  return {
    printed,
    select: (id: string) => {
      expected = id;

      if (ready.has(id)) { target = id; announce(); }
    },
    recovered: (id: string) => {
      if (id === expected && target === null) { target = id; announce(); }
    },
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

              if (hasReadyLine(text)) {
                ready.add(id);

                if (id === expected) { target = id; announce(); }
              }

              tail = text.slice(-(READY.length + 2));
            }

            parsed?.();
          }),
      };
    },
  };
};

/** Binds a live or retained ready line to one shell before typing or reporting. */
const readyTerminal = async (app: Pick<AppSeam, "rpc">, terminal: ReturnType<typeof reportTerminal>, id: string): Promise<void> => {
  terminal.select(id);
  // Read the retained log, not the screen snapshot: READY may already have scrolled off the grid.
  // Keep this decoder separate from xterm's live decoder so overlapping bytes cannot splice a false line.
  let reading = true;

  const retained = async () => {
    let after = 0;
    let tail = "\n";

    while (reading && terminal.target() === null) {
      const read = await bounded(app.rpc("terminal.read", { id, after, reader: null, max: null }), SETUP_BOUND_MS, "the shell Terminal's retained output");

      if (!reading) return;

      const text = (read.from === after ? tail : "") + read.text;

      if (hasReadyLine(text)) {
        terminal.recovered(id);

        return;
      }

      tail = text.slice(-(READY.length + 2));

      // A folded bubble may not parse live output yet; keep checking the log until readiness or the outer bound.
      if (read.next <= after || !read.truncated) await sleep(50);
      after = read.next;
    }
  };

  try {
    await bounded(Promise.race([terminal.printed, retained()]), SETUP_BOUND_MS, `the shell Terminal's ${READY} line`);
  } finally {
    reading = false;
  }
};

/** Creates the measurement Workstream, waits out Agent focus, then binds live and retained readiness to its one shell. */
export const terminalReady = async (app: Pick<AppSeam, "rpc">, terminal: ReturnType<typeof reportTerminal>, beforeMeasure?: (input: HTMLTextAreaElement) => Promise<void>): Promise<HTMLTextAreaElement> => {
  const create = await appears(
    () => [...document.querySelectorAll("button")].find((button) => (button.textContent?.trim() === "new Workstream" || button.getAttribute("aria-label") === "Add Workstream") && button.getAttribute("aria-disabled") !== "true") ?? null,
    "the new Workstream button",
  );

  create.click();
  await appears(() => document.querySelector('[role="treeitem"][aria-selected="true"]'), "the new Workstream's selected row");
  // Agent focus folds a shell bubble and pauses its parsing; open the shell only after that input exists.
  await appears(
    () => [...document.querySelectorAll("textarea.xterm-helper-textarea")].find((input) => !input.closest(".bubble[data-bubble]")) ?? null,
    "the new Workstream's Agent input",
  );

  const open = async () => {
    const existing = new Set([...document.querySelectorAll<HTMLElement>(".bubble[data-bubble]")].map((bubble) => bubble.dataset.bubble));

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "t", code: "KeyT", metaKey: true, bubbles: true, cancelable: true }));

    const fresh = () => [...document.querySelectorAll<HTMLElement>(".bubble[data-bubble]")].filter((bubble) => !existing.has(bubble.dataset.bubble));

    await appears(() => fresh()[0]?.querySelector<HTMLTextAreaElement>("textarea.xterm-helper-textarea") ?? null, "the shell Terminal's input");

    // A Terminal still opening wears a placeholder key, and its bubble is replaced when `terminal.open` answers: only a listed id is one the Daemon accepts.
    const listed = async () => {
      for (;;) {
        const ids = new Set((await app.rpc("terminal.list", null)).map((terminal) => terminal.id));
        const input = fresh().find((bubble) => ids.has(bubble.dataset.bubble!))?.querySelector<HTMLTextAreaElement>("textarea.xterm-helper-textarea");

        if (input) return input;

        await sleep(50);
      }
    };

    return bounded(listed(), SETUP_BOUND_MS, "the shell Terminal's id from the Daemon");
  };

  if (beforeMeasure) await beforeMeasure(await open());
  const input = await open();

  const id = input.closest<HTMLElement>(".bubble[data-bubble]")!.dataset.bubble!;

  await readyTerminal(app, terminal, id);

  input.focus();

  return input;
};

/** The App owns both Terminals; snapshots count raw bytes without draining a never-ending log. */
type FloodEvidence = { id: string; command: string; opened: boolean; samples: { at_ms: number; bytes: number; state: "visible" | "folded" }[]; bytes: number; bytes_per_second: number; interval_ms: number };

/** A producer is silent only when a full window passes with no new bytes; two samples a few ms apart prove nothing. */
const SILENCE_WINDOW_MS = 500;

export const startFlood = async (app: Pick<AppSeam, "rpc">, input: HTMLTextAreaElement, retain: (evidence: FloodEvidence) => void = () => {}) => {
  const id = input.closest<HTMLElement>("[data-bubble]")!.dataset.bubble!;
  const evidence: FloodEvidence = { id, command: "/usr/bin/yes roundup-flood", opened: true, samples: [], bytes: 0, bytes_per_second: 0, interval_ms: 0 };

  retain(evidence);
  const readiness = reportTerminal(() => ({ write: (_bytes: Uint8Array) => {} }));

  await readyTerminal(app, readiness, id);
  await bounded(app.rpc("terminal.write", { id, data: toBase64(new TextEncoder().encode("yes roundup-flood\n")) }), SETUP_BOUND_MS, "the flood Terminal's producer start");
  let searching = true;

  try {
    await bounded((async () => {
      while (searching) {
        const read = await app.rpc("terminal.read", { id, after: 0, reader: null, max: 256 });

        if (read.text.includes("roundup-flood")) return;
        await sleep(50);
      }
    })(), SETUP_BOUND_MS, "the flood Terminal's active output");
  } finally {
    searching = false;
  }

  const sample = async () => {
    const terminals = await bounded(app.rpc("terminal.list", null), SETUP_BOUND_MS, "the flood Terminal's liveness");

    if (!terminals.find(terminal => terminal.id === id)?.running) throw new Error("the flood Terminal's producer is missing or exited");
    const snapshot = await bounded(app.rpc("terminal.snapshot", { id }), SETUP_BOUND_MS, "the flood Terminal's byte count");
    const bubble = [...document.querySelectorAll<HTMLElement>("[data-bubble]")].find(element => element.dataset.bubble === id);

    if (!bubble) throw new Error("the opened flood Terminal disappeared");
    const at_ms = performance.now();
    evidence.samples.push({ at_ms, bytes: snapshot.after, state: bubble.hidden ? "folded" : "visible" });

    const window = evidence.samples.findLast(sample => at_ms - sample.at_ms >= SILENCE_WINDOW_MS);

    if (window && snapshot.after <= window.bytes) throw new Error("the flood Terminal's producer is silent");
    const first = evidence.samples[0]!;

    evidence.bytes = snapshot.after - first.bytes;
    evidence.interval_ms = at_ms - first.at_ms;
    evidence.bytes_per_second = evidence.interval_ms > 0 ? evidence.bytes * 1000 / evidence.interval_ms : 0;
  };

  return { evidence, sample, poll: async () => {
    const last = evidence.samples.at(-1);

    if (last && performance.now() - last.at_ms >= 1000) await sample();
  } };
};

/**
 * The keystroke run of `scenarios/perf.md` (K1 to K3): in a build made with `VITE_ROUNDUP_PERF`, `start` opens a Terminal, types
 * into it and writes one `PERF <json>` line through that Terminal, where `crates/perf` reads it from `terminal.output`.
 */
export const createKeystrokeRun = (app: AppSeam, workload: "idle" | "flood" = "idle") => {
  const run = crypto.randomUUID();
  const recorder = createRecorder(() => performance.now(), run, () => terminal.target());
  const { probe } = recorder;
  const terminal = reportTerminal(recorder.createEmulator);

  let floodEvidence: FloodEvidence | undefined;
  let flood: Awaited<ReturnType<typeof startFlood>> | undefined;

  const report = async (body: PerfReport, id: string) => {
    const line = `PERF ${JSON.stringify({ probe: "roundup-keystroke-probe", workload, terminal_id: id, flood: floodEvidence, ...body })}\n`;

    await writeInChunks(new TextEncoder().encode(line), async (data) => void (await bounded(app.rpc("terminal.write", { id, data: toBase64(data) }), SETUP_BOUND_MS, "the keystroke report write")));
  };

  const switchReport = async () => {
    const probe = window[SWITCH_PROBE];

    if (!probe) throw new Error("the build has no Switcher probe");

    const { switcher_open, switch: switched } = await runSwitchWorkload({
      probe,
      sleep,
      random: Math.random,
      until: (find, ms) => new Promise<void>((resolve) => {
        const watch = new MutationObserver(() => find() && settle());
        const timer = setTimeout(() => settle(), ms);

        const settle = () => {
          watch.disconnect();
          clearTimeout(timer);
          resolve();
        };

        watch.observe(document.body, { childList: true, subtree: true, attributes: true });

        if (find()) settle();
      }),
    });

    return { switcher_open_p95_ms: switcher_open.p95, switch_p95_ms: switched.p95, switcher_open, switch: switched };
  };

  const measure = async () => {
    let frame: number | undefined;

    const textarea = await terminalReady(app, terminal, workload === "flood" ? async (input) => {
      // #3550: a live yes can starve drawing; sample the display period before load so it cannot block typing.
      frame = await bounded(frameMs(), SETUP_BOUND_MS, "the display frames before flood");
      flood = await startFlood(app, input, (evidence) => { floodEvidence = evidence; });
      await flood.sample();
    } : undefined);

    // A window drawn at no rate gives no animation frame: the run must say so rather than wait for one.
    frame ??= await bounded(frameMs(), SETUP_BOUND_MS, "the display frames");
    const timerResolution = timerResolutionMs();
    const id = terminal.target();

    if (id === null) throw new Error("no ready Terminal for clock calibration");
    const exchanges: Exchange[] = [];

    const exchange = async () => {
      const sent = performance.now();
      const measured = await bounded(app.rpc("terminal.measure", { id, run }), SETUP_BOUND_MS, "Daemon keystroke clock");

      if (measured.at === null) throw new Error("invalid Daemon clock reading");
      exchanges.push({ sent, daemon: measured.at, received: performance.now() });

      return measured;
    };

    await exchange();
    await flood?.sample();
    const end = performance.now() + TYPING_BOUND_MS;

    await typeKeys(probe, { press: () => press(textarea), sleep: async (ms) => { await sleep(ms); await flood?.poll(); }, random: Math.random, expired: () => performance.now() > end }, KEYS + WARMUP_KEYS);
    await flood?.sample();
    const measured = await exchange();
    const keystroke = recorder.report(measured.samples, exchanges, timerResolution, WARMUP_KEYS);
    // SP4: the Switcher loops follow the typing, in the idle build only; a flood build keeps its one question.
    const switcher = workload === "idle" ? await switchReport() : {};

    await report({
      ...keystroke,
      ...switcher,
      keys: KEYS,
      patience_ms: PATIENCE_MS,
      renderer: recorder.webgl() ? "webgl" : "dom",
      frame_ms: frame,
      timer_resolution_ms: timerResolution,
      device_pixel_ratio: window.devicePixelRatio,
      user_agent: navigator.userAgent,
    }, id);
  };

  return {
    traced: (real: App): App => ({ ...real, forProject: (path) => recorder.traced(real.forProject(path)) }),
    createEmulator: terminal.createEmulator,
    start: async () => {
      try {
        await measure();
      } catch (failure) {
        let id = terminal.target();

        if (id === null) {
          // Setup can fail before a Bubble exists. A run-owned Project shell reports that step without starting an Agent.
          id = (await bounded(app.rpc("terminal.open", { workstream: null }), SETUP_BOUND_MS, "the diagnostic Terminal open")).terminal_id;
          await readyTerminal(app, terminal, id);
        }

        await report({ error: failure instanceof Error ? failure.message : String(failure) }, id);
      }
    },
  };
};
