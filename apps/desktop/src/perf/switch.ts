import { PATIENCE_MS } from "./keystrokes";

type Watch = { kind: "open" | "switch"; at: number; done: () => boolean; timer: number };

/** Names the string `scenarios/perf.md` K1/SP1 look for in a normal bundle. */
export const SWITCH_PROBE = "roundup-switch-probe";

declare global {
  interface Window {
    [SWITCH_PROBE]?: ReturnType<typeof createSwitchProbe>;
  }
}

/**
 * SP2, SP3: times the Switcher's opening chord to the first DOM in which its field is focused over a non-empty list, and `⏎` on an
 * Agent or Terminal entry to the first DOM holding the target's own content. It only reads the DOM, so a Door or Group entry,
 * which brings no Terminal of its own, ends as a dropped sample. `start` must run before the App mounts: the key registry's listener
 * stops the chord's `K`, and a listener added to the window after it never hears it.
 */
export const createSwitchProbe = (
  now: () => number,
  root: Document = document,
  after: (ms: number, run: () => void) => number = (ms, run) => window.setTimeout(run, ms),
  cancel: (timer: number) => void = (timer) => window.clearTimeout(timer),
) => {
  const opens: number[] = [];
  const switches: number[] = [];
  let dropped = { open: 0, switch: 0 };
  let watch: Watch | null = null;
  let armed = false;

  const finish = (): void => {
    if (!watch) return;

    cancel(watch.timer);
    (watch.kind === "open" ? opens : switches).push(now() - watch.at);
    watch = null;
  };

  const begin = (kind: Watch["kind"], done: () => boolean): void => {
    if (watch) {
      cancel(watch.timer);
      dropped[watch.kind] += 1;
    }

    const at = now();

    const timer = after(PATIENCE_MS, () => {
      if (watch?.at !== at) return;
      dropped[kind] += 1;
      watch = null;
    });

    watch = { kind, at, done, timer };
  };

  const field = (): HTMLInputElement | null => root.querySelector(".switcher input");

  const opened = (): boolean => {
    const input = field();

    return input !== null && root.activeElement === input && root.querySelector(".switcher .app-combobox-item") !== null;
  };

  const shown = (value: string): boolean => {
    if (value.startsWith("terminal:")) {
      const id = value.slice("terminal:".length);

      return root.querySelector(`.bubble:not([hidden])[data-bubble="${CSS.escape(id)}"] [data-terminal="${CSS.escape(id)}"]`) !== null;
    }

    return root.querySelector(`[role=treeitem][data-id="${CSS.escape(value)}"]`)?.getAttribute("aria-selected") === "true"
      && root.querySelector(".pane-screen [data-terminal]") !== null;
  };

  const onKey = (event: KeyboardEvent): void => {
    // The chord is the leader `⌘K` and its `K` (U529): the `K` that follows the leader starts the clock.
    const leader = armed;

    armed = event.code === "KeyK" && (event.metaKey || event.ctrlKey);

    if (leader && event.code === "KeyK" && !armed && !field()) {
      begin("open", opened);

      return;
    }

    if (event.key !== "Enter" || !field()) return;

    const value = root.querySelector(".switcher .app-combobox-item[data-highlighted]")?.getAttribute("data-value");

    if (!value || value.startsWith("action:") || shown(value)) return;

    // The pane's Terminal before the switch must not satisfy the wait.
    const before = root.querySelector(".pane-screen [data-terminal]");
    const terminal = value.startsWith("terminal:");

    begin("switch", () => shown(value) && (terminal || root.querySelector(".pane-screen [data-terminal]") !== before));
  };

  const check = (): void => { if (watch?.done()) finish(); };

  const observer = new MutationObserver(check);

  /** Starts observing; the returned function stops it. */
  const start = (): (() => void) => {
    root.defaultView?.addEventListener("keydown", onKey, true);
    root.addEventListener("focusin", check);
    observer.observe(root.body, { subtree: true, childList: true, attributes: true });

    return () => {
      root.defaultView?.removeEventListener("keydown", onKey, true);
      root.removeEventListener("focusin", check);
      observer.disconnect();
    };
  };

  return {
    start,
    /** Milliseconds of each finished sample, in order. */
    samples: () => ({ open: [...opens], switch: [...switches] }),
    /** Samples that never reached the DOM within the patience, or were replaced. */
    dropped: () => ({ ...dropped }),
  };
};
