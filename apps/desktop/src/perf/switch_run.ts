import { CHORDS } from "../keys/chords";
import { percentile } from "./keystrokes";

/** Samples of each kind thrown away first, and kept after them (`scenarios/perf.md` SP4). */
export const SWITCH_WARMUP = 10;

export const SWITCH_STEPS = 100;

type Probe = { samples: () => { open: number[]; switch: number[] }; dropped: () => { open: number; switch: number } };

export type Series = { n: number; dropped: number; p50: number; p95: number; p99: number; max: number };

/** Nearest rank over what remains after the warm-up; `dropped` counts only the drops after it. */
export const summarize = (all: number[], discard: number, dropped: number, name: "open" | "switch" = "open"): Series => {
  const sorted = all.slice(discard).sort((a, b) => a - b);

  if (sorted.length === 0) throw new Error(`no ${name} sample was taken after the warm-up`);

  return { n: sorted.length, dropped, p50: percentile(sorted, 0.5), p95: percentile(sorted, 0.95), p99: percentile(sorted, 0.99), max: sorted[sorted.length - 1]! };
};

type Deps = {
  probe: Probe;
  sleep: (ms: number) => Promise<void>;
  random: () => number;
  /** Resolves when `find` holds in the DOM, or after `ms`. */
  until: (find: () => boolean, ms: number) => Promise<void>;
};

const key = (target: EventTarget, init: KeyboardEventInit) => target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));

const field = () => document.querySelector<HTMLInputElement>(".switcher input");

const items = () => [...document.querySelectorAll<HTMLElement>(".switcher .app-combobox-item")];

/** The key registry's press for opening the Switcher, as a keydown init (`meta+shift+KeyP`), so a rebind moves the probe with it. */
export const openInit = (press = CHORDS["switcher.open"].presses[0] ?? ""): KeyboardEventInit => {
  const parts = press.split("+");
  const code = parts[parts.length - 1] ?? "";
  const has = (name: string) => parts.includes(name);
  const letter = code.startsWith("Key") ? code.slice(3) : code;

  return { key: has("shift") ? letter : letter.toLowerCase(), code, metaKey: has("meta"), shiftKey: has("shift"), ctrlKey: has("ctrl"), altKey: has("alt") };
};

const chord = () => {
  key(document.body, openInit());
};

const kindOf = (value: string) => (value.startsWith("action:") ? "action" : value.startsWith("terminal:") ? "terminal" : "agent");

/**
 * SP4: two loops, each step 150 to 250 ms after the last. The open loop presses the registry's Switcher chord then `Esc`; the switch loop opens the Switcher and presses `⏎`
 * onto an Agent and, on the next turn, onto a Terminal. The samples themselves come from the SP2 and SP3 marks of `createSwitchProbe`.
 */
export const runSwitchWorkload = async ({ probe, sleep, random, until }: Deps) => {
  const pause = () => sleep(150 + random() * 100);
  const total = SWITCH_WARMUP + SWITCH_STEPS;

  let after = { open: 0, switch: 0 };
  let discard = { open: 0, switch: 0 };

  for (let step = 0; step < total; step += 1) {
    chord();
    await until(() => field() !== null && items().length > 0, 600);
    key(field() ?? document.body, { key: "Escape", code: "Escape" });
    await until(() => field() === null, 600);
    await pause();

    if (step === SWITCH_WARMUP - 1) {
      discard.open = probe.samples().open.length;
      after.open = probe.dropped().open;
    }
  }

  let last = { agent: "", terminal: "" };

  for (let step = 0; step < total; step += 1) {
    const wanted = step % 2 === 0 ? "agent" : "terminal";

    chord();
    await until(() => field() !== null && items().length > 0, 600);

    const input = field();
    const target = items().find((item) => kindOf(item.dataset.value ?? "") === wanted && item.dataset.value !== last[wanted]);

    if (input && target) {
      // Arrow down to the entry: a highlight moves only by key, as it does for the user.
      for (let hop = 0; hop < items().length && !items().find((item) => item.hasAttribute("data-highlighted"))?.isSameNode(target); hop += 1) key(input, { key: "ArrowDown", code: "ArrowDown" });

      last[wanted] = target.dataset.value ?? "";
      key(input, { key: "Enter", code: "Enter" });
    } else {
      // A Project without both kinds is not the SP4 seed: a skipped step would shorten the sample unseen.
      throw new Error(`the Switcher has no ${wanted} to switch to at step ${step + 1}`);
    }

    await until(() => field() === null, 600);
    await pause();

    if (step === SWITCH_WARMUP - 1) {
      discard.switch = probe.samples().switch.length;
      after.switch = probe.dropped().switch;
    }
  }

  const samples = probe.samples();
  const dropped = probe.dropped();

  return {
    switcher_open: summarize(samples.open, discard.open, dropped.open - after.open, "open"),
    switch: summarize(samples.switch, discard.switch, dropped.switch - after.switch, "switch"),
  };
};
