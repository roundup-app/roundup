import type { KeystrokeSample } from "@contracts/terminal/KeystrokeSample";
import type { Calibration } from "./calibration";

/** How long a key may take to come back as a rendered echo before its sample is dropped. */
export const PATIENCE_MS = 500;

/** Keys typed and thrown away first, so the first renders (font load, glyph atlas) do not count. */
export const WARMUP_KEYS = 100;

export type Summary = { n: number; dropped: number } & (
  | { p50: number; p95: number; p99: number; max: number }
  | { error: string; p50: null; p95: null; p99: null; max: null }
);

/** Nearest rank, the same rule as `crates/perf`. */
export const percentile = (sorted: number[], share: number): number => {
  const value = sorted[Math.max(Math.ceil(share * sorted.length), 1) - 1];

  if (value === undefined)
    throw new Error("no key was echoed and rendered after the warm-up");

  return value;
};

/** Daemon marks are converted with retained calibration before any cross-clock subtraction. */
export const BOUNDARIES = ["keydown", "input", "encoding", "encoded", "dispatched", "received", "written", "read", "replied", "arrived", "parsed", "rendered"] as const;

type Boundary = (typeof BOUNDARIES)[number];

type Marks = Partial<Record<Boundary, number>>;

export type HopSummary = { n: number; p50: number | null; p95: number | null };

type Pending = { key: number; at: number; echoed: boolean; counted: () => void; marks: Marks };

/** Keydown to the target Terminal's first render that shows its echo. Other Terminals and renders before its echo reaches the buffer cannot finish a sample. */
export const createKeystrokeProbe = (now: () => number, typed: string, target: () => string | null, run?: string) => {
  const latencies: { key: number; ms: number }[] = [];
  const finished: { key: number; marks: Marks }[] = [];
  let dispatched: Marks | null = null;
  const records = new Map<string, Pending>();
  const tails = { arrived: "", parsed: "" };
  const marker = (key: number) => `\x1b]777;${run}-${key}\x07${typed}`;

  const matching = (text: string): Pending[] => [...text.matchAll(/\x1b\]777;[a-zA-Z0-9-]+-[0-9]{1,6}\x07/g)].flatMap(match => {
    const token = match[0] + typed;
    const record = records.get(token);

    return record && text.startsWith(typed, match.index + match[0].length) ? [record] : [];
  });

  const batch = (bytes?: readonly number[]): Pending[] => run === undefined
    ? pending ? [pending] : []
    : matching(new TextDecoder().decode(Uint8Array.from(bytes ?? [])));

  const output = (bytes: Uint8Array, boundary: "arrived" | "parsed") => {
    const at = now();
    const previous = tails[boundary].length;
    const text = tails[boundary] + new TextDecoder().decode(bytes);

    for (const record of matching(text)) {
      const end = text.indexOf(marker(record.key)) + marker(record.key).length;

      if (end <= previous) continue;

      // Duplicate identity is ambiguous; it cannot supply a complete chain.
      if (record.marks[boundary] !== undefined) {
        delete record.marks.dispatched;
        continue;
      }

      record.marks[boundary] = at;

      if (boundary === "parsed" && record === pending) record.echoed = true;
    }

    tails[boundary] = text.slice(-100);
  };

  const droppedKeys: number[] = [];
  let pending: Pending | null = null;
  let keys = 0;
  let unsent = 0;

  return {
    /** Resolves when the key's echo has been rendered, or at `abandon`. */
    keydown: (): Promise<void> =>
      new Promise((resolve) => {
        if (pending) {
          droppedKeys.push(pending.key);
          pending.counted();
        }

        const at = now();

        pending = { key: keys, at, echoed: false, counted: resolve, marks: { keydown: at } };
        records.set(marker(keys), pending);
        keys += 1;
      }),
    /** Only the opt-in raw echo workload gets an invisible identity; ordinary input is untouched. */
    frame: (text: string, id: string): string =>
      run !== undefined && id === target() && pending && text === typed ? marker(pending.key) : text,
    /** Called with each chunk the emulator has parsed. Only the typed character itself is the echo; anything else is the program's own output. */
    written: (bytes: Uint8Array, id: string) => {
      if (id !== target()) return;

      if (run !== undefined) {
        output(bytes, "parsed");

        return;
      }

      if (pending && new TextDecoder().decode(bytes) === typed) {
        pending.echoed = true;
        pending.marks.parsed ??= now();
      }
    },
    /** xterm's `onData` for the pending key. */
    input: (id: string) => {
      if (id !== target()) return;

      if (pending) pending.marks.input ??= now();
    },
    /** The previous reply has released this input batch for byte preparation and base64 encoding. */
    encoding: (id: string, bytes?: readonly number[]) => {
      if (id !== target()) return;

      const at = now();

      for (const record of batch(bytes)) if (record.marks.input !== undefined) record.marks.encoding ??= at;
    },
    /** The input queue's current batch has finished base64 encoding; includes any wait for the previous reply. */
    encoded: (id: string, bytes?: readonly number[]) => {
      if (id !== target()) return;

      const at = now();

      for (const record of batch(bytes)) if (record.marks.input !== undefined) record.marks.encoded ??= at;
    },
    /** `terminal.write` called and, later, answered. */
    dispatched: (id: string, bytes?: readonly number[]) => {
      if (id !== target()) return;

      const at = now();

      for (const record of batch(bytes)) {
        if (record.marks.input === undefined || record.marks.dispatched !== undefined) continue;
        record.marks.dispatched = at;
        dispatched = record.marks;
      }
    },
    replied: (id: string, bytes?: readonly number[]) => {
      if (id !== target()) return;

      const at = now();

      if (run !== undefined) {
        for (const record of batch(bytes)) record.marks.replied ??= at;
      } else if (dispatched && dispatched.replied === undefined) dispatched.replied = now();
      dispatched = null;
    },
    /** Attach independently collected Daemon stamps only to the identical input token. */
    daemon: (samples: KeystrokeSample[], calibration: Calibration) => {
      for (const sample of samples) {
        for (const record of matching(sample.token)) {
          if (sample.ambiguous || sample.received === null || sample.written === null || sample.read === null) continue;
          record.marks.received = sample.received - calibration.offset_ms;
          record.marks.written = sample.written - calibration.offset_ms;
          record.marks.read = sample.read - calibration.offset_ms;
        }
      }
    },
    /** The output event carrying the typed character reached the webview, before `emulator.write`. */
    arrived: (bytes: Uint8Array, id: string) => {
      if (id !== target()) return;

      if (run !== undefined) {
        output(bytes, "arrived");

        return;
      }

      if (pending && new TextDecoder().decode(bytes) === typed) pending.marks.arrived ??= now();
    },
    rendered: (id: string) => {
      if (id !== target()) return;

      if (!pending?.echoed) return;

      pending.marks.rendered = now();
      finished.push({ key: pending.key, marks: pending.marks });
      latencies.push({ key: pending.key, ms: pending.marks.rendered - pending.at });
      pending.counted();
      pending = null;
    },
    abandon: () => {
      if (!pending) return;

      droppedKeys.push(pending.key);
      pending.counted();
      pending = null;
    },
    /** p50/p95 of each hop over the measured keys that carry both of its boundaries. */
    hops: (skip: number) => {
      const sample = (from: Boundary, to: Boundary): HopSummary => {
        const spans = finished
          .flatMap(({ key, marks }) => {
            const a = marks[from];
            const b = marks[to];

            return key >= skip && a !== undefined && b !== undefined ? [b - a] : [];
          })
          .sort((x, y) => x - y);

        return spans.length === 0
          ? { n: 0, p50: null, p95: null }
          : { n: spans.length, p50: percentile(spans, 0.5), p95: percentile(spans, 0.95) };
      };

      return {
        keydown_to_input: sample("keydown", "input"),
        input_to_dispatch: sample("input", "dispatched"),
        input_to_encoded: sample("input", "encoded"),
        input_to_encoding: sample("input", "encoding"),
        encoding_to_encoded: sample("encoding", "encoded"),
        encoded_to_dispatch: sample("encoded", "dispatched"),
        dispatch_to_echo_event: sample("dispatched", "arrived"),
        dispatch_to_daemon: sample("dispatched", "received"),
        daemon_to_write: sample("received", "written"),
        write_to_echo_read: sample("written", "read"),
        echo_read_to_event: sample("read", "arrived"),
        echo_event_to_parsed: sample("arrived", "parsed"),
        parsed_to_frame: sample("parsed", "rendered"),
        write_reply: sample("dispatched", "replied"),
      };
    },
    /** Keys the run's time ran out before it typed: dropped, never skipped. */
    unsent: (count: number) => {
      unsent += count;
    },
    /** Warm-up latency samples are excluded, but every dropped key fails R21. An empty sample retains counts alongside an error and null percentiles. */
    summary: (skip: number): Summary => {
      const sorted = latencies
        .flatMap(({ key, ms }) => (key >= skip ? [ms] : []))
        .sort((a, b) => a - b);

      const dropped = droppedKeys.length + unsent;

      if (sorted.length === 0) return {
        error: "no key was echoed and rendered after the warm-up",
        n: 0, dropped, p50: null, p95: null, p99: null, max: null,
      };

      return {
        n: sorted.length,
        dropped,
        p50: percentile(sorted, 0.5),
        p95: percentile(sorted, 0.95),
        p99: percentile(sorted, 0.99),
        max: percentile(sorted, 1),
      };
    },
  };
};

export type KeystrokeProbe = ReturnType<typeof createKeystrokeProbe>;

/** What the driver needs from its surroundings; the browser run supplies the DOM, tests supply a fake clock. */
export type Surroundings = {
  press(): void;
  sleep(ms: number): Promise<void>;
  random(): number;
  /** True once the run's time is spent: the keys not yet typed are counted as dropped and the run reports. */
  expired(): boolean;
};

/** Types `count` keys one at a time, 20 to 40 ms apart so the key's phase against the display frame is not constant. Stops when time is spent, so a run of dropped keys still ends in a report. */
export const typeKeys = async (
  probe: KeystrokeProbe,
  surroundings: Surroundings,
  count: number,
): Promise<void> => {
  for (let key = 0; key < count; key += 1) {
    if (surroundings.expired()) {
      probe.unsent(count - key);

      return;
    }

    const echoed = probe.keydown();

    surroundings.press();
    await Promise.race([echoed, surroundings.sleep(PATIENCE_MS)]);
    probe.abandon();
    await surroundings.sleep(20 + surroundings.random() * 20);
  }
};
