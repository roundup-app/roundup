// fallow-ignore-file duplicate-export -- Clock sleeps for the frame driver; state/clock’s Clock reads time. Neither is barrel-exported.
import type { App, AppSeam } from "../app/seam";
import { toBase64 } from "../terminal/base64";
import { createXtermEmulators } from "../terminal/emulator";
import { prepareFixture } from "./fixture";
import type { Fixture } from "./fixture";
import { recordFrames } from "./frames";
import type { FrameReport, LayerAction } from "./frames";
import type { NativeDragReport } from "./nativeDragProbe";
import { SETUP_BOUND_MS, appears, bounded, reportTerminal, sleep, terminalReady, timerResolutionMs, writeInChunks } from "./run";

/** `docs/motion.md`, **Native performance protocol**: every 2 s one cycle of the workload, over the 60 s sample. */
const CYCLE_MS = 2000;

const CYCLES = 30;

const SETTLE_MS = 400;

const WORKING_GLYPHS = 10;

/** The first task after the rendering update that follows the current animation callback. */
const afterUpdate = (callback: () => void) => {
  const channel = new MessageChannel();

  channel.port1.onmessage = () => {
    channel.port1.close();
    callback();
  };

  channel.port2.postMessage(null);
};

/** The only thing the drivers ask of time: a fake clock in tests, `setTimeout` in the App. */
type Clock = { sleep(ms: number): Promise<void> };

/**
 * Runs `cycle` once every `CYCLE_MS`, `CYCLES` times, and answers whether every one completed. A cycle that reports a missing target ends the run
 * at once, so the report stays invalid (U3010g): a target never found is not completed, and is never skipped.
 */
export const everyTwoSeconds = async (clock: Clock, cycle: (index: number) => Promise<boolean>): Promise<{ performed: number; completed: boolean }> => {
  let performed = 0;

  for (let index = 0; index < CYCLES; index += 1) {
    const [done] = await Promise.all([cycle(index), clock.sleep(CYCLE_MS)]);

    if (!done) return { performed, completed: false };

    performed += 1;
  }

  return { performed, completed: true };
};

/** What the Layers driver presses; each answers whether its control was found. */
export type Layers = {
  openDrawer(): boolean;
  closeDrawer(): boolean;
  /** The key close: Escape inside the Drawer. */
  escapeDrawer(): boolean;
  toggleShelf(): boolean;
  keyShelf(): boolean;
  /** Performs an action and waits for half the actual distance to its destination; missing movement fails. */
  halfway(panel: "drawer" | "shelf", action: () => boolean): Promise<boolean>;
};

/** One Layers cycle: a Drawer cycle, then a Shelf cycle, alternating. Each reverses twice at measured half-displacement, then interrupts by key. */
export const layersCycle = (layers: Layers) => async (index: number): Promise<boolean> => {
  if (index % 2 === 0) {
    if (!(await layers.halfway("drawer", layers.openDrawer))) return false;

    if (!(await layers.halfway("drawer", layers.closeDrawer))) return false;

    if (!(await layers.halfway("drawer", layers.openDrawer))) return false;

    // Interrupt the reopened movement with a key before it settles.
    return layers.escapeDrawer();
  }

  // Start open, reverse twice, then interrupt by key back to open for the next cycle.
  if (!(await layers.halfway("shelf", layers.toggleShelf))) return false;

  if (!(await layers.halfway("shelf", layers.toggleShelf))) return false;

  if (!(await layers.halfway("shelf", layers.toggleShelf))) return false;

  return layers.keyShelf();
};

/** What the Todos driver does to the temporary Project's Todos; each answers whether it completed. */
export type Todos = {
  open(): Promise<number[]>;
  create(): Promise<boolean>;
  complete(id: number): Promise<boolean>;
  toggleFold(): Promise<boolean>;
  reorder(id: number, before: number): Promise<boolean>;
};

/** One Todos cycle: insertion, completion, done-fold toggle, reorder, one per cycle in that order. It completes nothing that would leave the list empty. */
export const todosCycle = (todos: Todos) => async (index: number): Promise<boolean> => {
  const open = await todos.open();

  switch (index % 4) {
    case 0:
      return todos.create();
    case 1: {
      const last = open.at(-1);

      return open.length > 1 && last !== undefined && (await todos.complete(last));
    }

    case 2:
      return todos.toggleFold();
    default: {
      const [first, ...rest] = open;
      const last = rest.at(-1);

      return first !== undefined && last !== undefined && (await todos.reorder(last, first));
    }
  }
};

/** The Glyphs workload acts on nothing: it holds that ten working Glyphs stay in the Rail for the whole sample, under the one stream. */
export const glyphsCycle = (working: () => number) => async (): Promise<boolean> => working() >= WORKING_GLYPHS;

const SHELF_ROW = '.shelf [data-todo] .row-controls button[aria-label="Open"]';

const clickAt = (selector: string): boolean => {
  const target = document.querySelector(selector);

  if (!target) return false;

  target.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));

  return true;
};

/** Reads displayed boxes, as the U3010b rendered observer does; animation progress/time is not displacement. */
const halfDisplacement = async (panel: "drawer" | "shelf", action: () => boolean, journal: LayerAction[]): Promise<boolean> => {
  const element = document.querySelector<HTMLElement>(`.${panel}`);
  const root = document.querySelector("[data-layout-root]");

  if (!element || !root) return false;
  const before = element.getBoundingClientRect();
  const edge = root.getBoundingClientRect().right;

  if (before.width <= 0 || !action()) return false;
  // Solid commits the requested open state synchronously; geometry still reflects the displayed start.
  const open = element.dataset.open === "true";
  const destination = open ? edge - before.width : edge;
  const distance = destination - before.left;
  const todo = document.querySelector(SHELF_ROW)?.closest<HTMLElement>("[data-todo]")?.dataset.todo;
  const target = panel === "shelf" ? ".shelf-tab[data-selected]" : open ? `.shelf [data-todo="${todo}"] .row-controls button[aria-label="Open"]` : ".drawer .close";
  const entry: LayerAction = { panel, source: "synthetic-pointer", target, at_ms: performance.now(), from: before.left, destination, observed: null, completed: false, samples: [] };

  // Read the requested style before the lifetime owner's next-frame animation observation.
  // Otherwise its animation list can still be empty when a first Shelf close starts.
  entry.samples.push({ at_ms: performance.now(), left: element.getBoundingClientRect().left });
  journal.push(entry);

  if (Math.abs(distance) < 1) return false;

  return new Promise(resolve => {
    const deadline = performance.now() + SETTLE_MS;
    let finished = false;
    let frame = 0;

    const finish = (done: boolean) => {
      if (finished) return;
      finished = true;
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      entry.completed = done;
      resolve(done);
    };

    const sample = () => {
      if (!element.isConnected || element.hidden || performance.now() >= deadline) return finish(false);
      const left = element.getBoundingClientRect().left;
      const progress = (left - before.left) / distance;

      entry.observed = left;
      entry.samples.push({ at_ms: performance.now(), left });

      // A jump to final geometry did not expose an interruptible half-displacement.
      if (progress >= 0.5) return finish(progress < 1 - 1 / Math.abs(distance));
      frame = requestAnimationFrame(sample);
    };

    const timer = setTimeout(() => finish(false), SETTLE_MS);

    frame = requestAnimationFrame(sample);
  });
};

export const domLayers = (journal: LayerAction[]): Layers => ({
  openDrawer: () => clickAt(SHELF_ROW),
  closeDrawer: () => clickAt(".drawer .close"),
  escapeDrawer: () => {
    const close = document.querySelector<HTMLElement>(".drawer .close");

    close?.focus();
    const box = close?.closest(".drawer")?.getBoundingClientRect();

    close?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));

    if (close && box) journal.push({ panel: "drawer", source: "synthetic-key", target: ".drawer .close", at_ms: performance.now(), from: box.left, destination: document.querySelector("[data-layout-root]")?.getBoundingClientRect().right ?? box.right, observed: box.left, completed: document.querySelector<HTMLElement>(".drawer")?.dataset.open === "false", samples: [] });

    return close !== null && document.querySelector<HTMLElement>(".drawer")?.dataset.open === "false";
  },
  toggleShelf: () => clickAt(".shelf-tab[data-selected]"),
  keyShelf: () => {
    const tab = document.querySelector<HTMLElement>(".shelf-tab[data-selected]");
    const shelf = document.querySelector<HTMLElement>(".shelf");

    if (!tab || !shelf) return false;
    const before = shelf.getBoundingClientRect();

    // HTMLElement.click has detail=0, which the existing activation owner classifies as key input.
    tab.click();
    const completed = document.querySelector<HTMLElement>("[data-layout-root]")?.dataset.shelf === "open";

    journal.push({ panel: "shelf", source: "synthetic-key", target: ".shelf-tab[data-selected]", at_ms: performance.now(), from: before.left, destination: (document.querySelector("[data-layout-root]")?.getBoundingClientRect().right ?? before.right) - before.width, observed: before.left, completed, samples: [] });

    return completed;
  },
  halfway: (panel, action) => halfDisplacement(panel, action, journal),
});

const workingGlyphs = () => [...document.querySelectorAll('.rail .glyph[data-drawing="quarter"]')].filter(glyph => {
  const box = glyph.getBoundingClientRect();

  return box.width > 0 && box.height > 0 && box.top >= 0 && box.bottom <= innerHeight && box.left >= 0 && box.right <= innerWidth;
}).length;

const wallClock: Clock = { sleep };

const attempted = async <T>(work: () => Promise<T>): Promise<boolean> => {
  try {
    await work();

    return true;
  } catch {
    return false;
  }
};

/**
 * Creates a Todo in `home`. A created Todo has no home, and the Shelf of a selected Workstream lists only its own Todos: a homeless one
 * never reaches a row the driver can press, so the Layers cycle found no target on WKWebView and the run stayed invalid (U3010g).
 */
export const createHomed = async (app: Pick<AppSeam, "rpc">, home: string, title: string): Promise<void> => {
  const todo = await app.rpc("todo.create", { title, body: null, blockers: null });

  await app.rpc("todo.move", { id: todo.id, home });
};

/** The Workstream the run made: the last one on the Rail, which the new Workstream's selected row is. */
const runWorkstream = async (app: AppSeam): Promise<string> => {
  const home = (await app.rpc("rail.tree", null)).filter((node) => node.kind === "workstream").at(-1)?.id;

  if (!home) throw new Error("the Project has no Workstream to hold the Todos");

  return home;
};

const domTodos = (app: AppSeam, home: string): Todos => {
  let made = 0;

  return {
    open: async () => (await app.rpc("todo.list", null)).filter((todo) => !todo.done && todo.home === home).map((todo) => todo.id),
    create: () => attempted(() => createHomed(app, home, `motion ${(made += 1)}`)),
    complete: (id) => attempted(() => app.rpc("todo.complete", { id })),
    toggleFold: () =>
      attempted(async () => {
        const fold = await Promise.race([
          appears(() => document.querySelector<HTMLElement>(".shelf-done-line button"), "the done fold"),
          sleep(CYCLE_MS / 2).then(() => Promise.reject(new Error("no done fold"))),
        ]);

        fold.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
      }),
    reorder: (id, before) => attempted(() => app.rpc("todo.reorder", { id, before })),
  };
};

/** The workload's setup, then the cycle its actions repeat; an unknown workload is an error, never an empty run. */
const prepare = async (app: AppSeam, workload: string, journal: LayerAction[], fixture?: Fixture): Promise<(index: number) => Promise<boolean>> => {
  if (workload === "layers" || workload === "todos" || workload === "drag") {
    // Rows to open, complete and reorder; one open Todo always stays.
    const home = fixture?.home ?? await runWorkstream(app);

    if (workload === "drag") {
      for (let each = 0; each < 40; each += 1) await createHomed(app, home, `seed ${each}`);
    } else if (!fixture) throw new Error("missing native fixture");

    if (fixture && document.querySelector<HTMLElement>("[data-layout-root]")?.dataset.shelf !== "open") {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "k", code: "KeyK", metaKey: true, bubbles: true, cancelable: true }));
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "s", code: "KeyS", bubbles: true, cancelable: true }));
      await appears(() => document.querySelector(".shelf-groups"), "the scoped Shelf after the work-items command");
    }

    // Open the existing owner groups through their controls; setup does not replace their state owner.
    if (fixture) {
      for (const control of document.querySelectorAll<HTMLElement>('.shelf-groups [aria-expanded="false"] .shelf-group-control')) control.click();
    }

    if (workload === "drag") clickAt('.shelf-groups [aria-expanded="false"] .shelf-group-control');

    // The press targets must be on screen before the sample, so a missing one is an error naming it, not a silent invalid run.
    await appears(() => document.querySelector(SHELF_ROW), "the Shelf's first Todo row");

    // Native pointer input is supplied by the Mac observer, never by a synthetic event driver.
    if (workload === "drag") return async () => true;

    if (workload === "layers") return layersCycle(domLayers(journal));

    return todosCycle(domTodos(app, home));
  }

  if (workload === "glyphs") {
    if (!fixture) throw new Error("missing native fixture");
    await appears(() => workingGlyphs() >= WORKING_GLYPHS ? true : null, "ten visible working Glyphs");

    return glyphsCycle(workingGlyphs);
  }

  throw new Error(`the workload ${workload} is not layers, todos, drag or glyphs`);
};

/**
 * The frame run of `scenarios/ui-motion.md` U3010e: in a build made with `VITE_ROUNDUP_PERF` and `VITE_ROUNDUP_PERF_WORKLOAD`,
 * `start` opens a Terminal, records the workload's frame intervals and writes one `FRAMES <json>` line through that Terminal.
 */
export const createFrameRun = (app: AppSeam, workload: string, cwd: string) => {
  const terminal = reportTerminal(createXtermEmulators());

  const report = async (body: FrameReport | NativeDragReport | { error: string }) => {
    const id = terminal.target();

    if (id === null) throw new Error("no Terminal printed the ready line to report through");

    await writeInChunks(new TextEncoder().encode(`FRAMES ${JSON.stringify(body)}\n`), async (data) => void (await app.rpc("terminal.write", { id, data: toBase64(data) })));
  };

  const measure = async () => {
    const input = await terminalReady(app, terminal);

    if (workload === "drag-compatibility") {
      const { runNativeDragProbe } = await import("./nativeDragProbe");

      await report(await runNativeDragProbe(app));

      return;
    }

    const layerActions: LayerAction[] = [];
    const viewport = { width: innerWidth, height: innerHeight, device_pixel_ratio: devicePixelRatio };
    const shelfMode = document.querySelector<HTMLElement>("[data-layout-root]")?.dataset.shelfMode ?? "missing";
    const nativeFixture = ["layers", "todos", "glyphs"].includes(workload);

    if (nativeFixture && (viewport.width !== 1512 || viewport.height !== 950 || !matchMedia("(prefers-color-scheme: dark)").matches || !["reserved", "overlay"].includes(shelfMode))) {
      throw new Error("native motion needs dark 1512×950 and an identified reserved or overlay Shelf");
    }

    const fixture = nativeFixture ? await bounded(prepareFixture(app, cwd, terminal.target()!), SETUP_BOUND_MS, "the native fixture setup") : undefined;

    if (fixture) {
      for (const control of document.querySelectorAll<HTMLElement>('.rail [aria-expanded="false"] .rail-chevron')) control.click();
      await appears(() => workingGlyphs() >= WORKING_GLYPHS ? true : null, "ten visible working Glyphs");
    }

    const cycle = await bounded(prepare(app, workload, layerActions, fixture), SETUP_BOUND_MS, `the ${workload} setup`);

    if (fixture) {
      const bubble = input.closest<HTMLElement>(".bubble[data-bubble]");

      if (!bubble || bubble.hidden || bubble.dataset.bubble !== fixture.terminal) throw new Error("the fixture streaming Terminal is not selected and visible");
      input.focus();
    }

    const controller = new AbortController();
    const dragActions = { released: 0, cancelled: 0 };

    const count = (event: Event) => {
      if (!event.isTrusted || !document.querySelector(".sortable-source,[data-dnd-dragging]")) return;

      if (event instanceof PointerEvent) dragActions.released += 1;
      else if (event instanceof KeyboardEvent && event.key === "Escape") dragActions.cancelled += 1;
    };

    const dragCycle = async () => {
      const before = dragActions.released + dragActions.cancelled;

      await sleep(CYCLE_MS);

      return dragActions.released + dragActions.cancelled > before;
    };

    if (workload === "drag") {
      window.addEventListener("pointerup", count, { capture: true, signal: controller.signal });
      window.addEventListener("keydown", count, { capture: true, signal: controller.signal });
    }

    try {
      const measured = await recordFrames(
        { frame: (callback) => void requestAnimationFrame(callback), hidden: () => document.hidden, now: () => performance.now(), afterUpdate: afterUpdate, after: (ms, callback) => void setTimeout(callback, ms) },
        {
          workload,
          timeOriginMs: performance.timeOrigin,
          engine: /Chrome|Chromium/.test(navigator.userAgent) ? "chromium" : "webkit",
          timerResolutionMs: timerResolutionMs(),
          userAgent: navigator.userAgent,
          entryTypes: [...(PerformanceObserver.supportedEntryTypes ?? [])],
        },
        async () => (await everyTwoSeconds(wallClock, workload === "drag" ? dragCycle : cycle)).completed,
      );

      const result = workload === "drag" ? { ...measured, dragActions } : measured;

      const observer: NonNullable<FrameReport["observer"]> = {
        viewport, shelf_mode: shelfMode, layer_actions: layerActions, variant: "unqualified",
        native_qualification: "incomplete: trusted pointer actions, restored Todo repeats, both Shelf cases and live preference variants remain unqualified",
      };

      if (fixture) observer.fixture = fixture;

      const observed = { ...result, observer };

      await report(observed);
    } finally {
      controller.abort();
    }
  };

  return {
    traced: (real: App): App => real,
    createEmulator: terminal.createEmulator,
    start: async () => {
      try {
        await measure();
      } catch (failure) {
        if (!(failure instanceof Error) || terminal.target() === null) throw failure;

        await report({ error: failure.message });
      }
    },
  };
};
