// fallow-ignore-file duplicate-export -- Clock sleeps for the frame driver; state/clock’s Clock reads time. Neither is barrel-exported.
import { createComputed, createRoot } from "solid-js";
import type { Accessor } from "solid-js";
import { makeEventListener } from "@solid-primitives/event-listener";
import type { App, AppSeam } from "../app/seam";
import { toBase64 } from "../terminal/base64";
import { createXtermEmulators } from "../terminal/emulator";
import { prepareFixture } from "./fixture";
import type { Fixture } from "./fixture";
import { recordFrames } from "./frames";
import type { FrameReport, LayerAction, PreferenceAction, TodoAction } from "./frames";
import type { NativeDragReport } from "./nativeDragProbe";
import { SETUP_BOUND_MS, appears, bounded, reportTerminal, sleep, terminalReady, timerResolutionMs, writeInChunks } from "./run";

/** `docs/motion.md`, **Native performance protocol**: every 2 s one cycle of the workload, over the 60 s sample. */
const CYCLE_MS = 2000;

const CYCLES = 30;

const SETTLE_MS = 400;

const WORKING_GLYPHS = 10;

/** Reads the App's accessor; disposal releases only this recorder, never the App's media subscription. */
export const observePreference = (reduced: Accessor<boolean>, now: () => number, phase: () => PreferenceAction["phase"], journal: PreferenceAction[], movement: () => PreferenceAction["movement"] = () => undefined): (() => void) => createRoot(dispose => {
  let initial = true;
  createComputed(() => {
    const entry: PreferenceAction = { at_ms: now(), reduced: reduced(), phase: phase() };

    // The initial value is setup, not a switch. Sample displacement synchronously
    // with the shared source change, before a later frame can reach its endpoint.
    if (!initial && entry.phase === "sample") {
      const observed = movement();

      if (observed) entry.movement = observed;
    }

    initial = false;
    journal.push(entry);
  });

  return dispose;
});

/** The first task after the rendering update that follows the current animation callback. */
const afterUpdate = (callback: () => void) => {
  const channel = new MessageChannel();

  channel.port1.onmessage = () => {
    channel.port1.close();
    channel.port2.close();
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

/** The Layers actions: test controls activate directly; the App observes native input and its result. */
export type Layers = {
  openDrawer(): boolean | Promise<boolean>;
  closeDrawer(): boolean | Promise<boolean>;
  /** The key close: Escape inside the Drawer. */
  escapeDrawer(): boolean | Promise<boolean>;
  toggleShelf(): boolean | Promise<boolean>;
  keyShelf(): boolean | Promise<boolean>;
  /** Performs an action and waits for half the actual distance to its destination; missing movement fails. */
  halfway(panel: "drawer" | "shelf", action: () => boolean | Promise<boolean>): Promise<boolean>;
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

type LayerStart = { at_ms: number; left: number; width: number; edge: number; opening: boolean };

/** Reads displayed boxes; animation progress/time is not displacement. */
const halfDisplacement = async (panel: "drawer" | "shelf", action: () => boolean | Promise<boolean>, journal: LayerAction[], activation: () => LayerStart | null): Promise<boolean> => {
  const element = document.querySelector<HTMLElement>(`.${panel}`);
  const root = document.querySelector("[data-layout-root]");

  if (!element || !root) return false;
  const initial = element.getBoundingClientRect();
  const edge = root.getBoundingClientRect().right;
  const todo = document.querySelector(SHELF_ROW)?.closest<HTMLElement>("[data-todo]")?.dataset.todo;
  const opening = element.dataset.open !== "true";
  const target = panel === "shelf" ? ".shelf-tab[data-selected]" : opening ? `.shelf [data-todo="${todo}"] .row-controls button[aria-label="Open"]` : ".drawer";
  const entry: LayerAction = { panel, source: "trusted-pointer", target, at_ms: performance.now(), from: initial.left, destination: opening ? edge - initial.width : edge, observed: null, completed: false, samples: [] };

  journal.push(entry);

  if (initial.width <= 0) return false;
  const applied = await action();
  const before = activation();

  if (!before || before.width <= 0) return false;
  const destination = before.opening ? before.edge - before.width : before.edge;
  const distance = destination - before.left;

  entry.at_ms = before.at_ms;
  entry.from = before.left;
  entry.destination = destination;
  entry.samples.push({ at_ms: before.at_ms, left: before.left });

  if (!applied) return false;

  // Read the requested style before the lifetime owner's next-frame animation observation.
  // Otherwise its animation list can still be empty when a first Shelf close starts.
  entry.samples.push({ at_ms: performance.now(), left: element.getBoundingClientRect().left });

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

type Listen = (type: "click" | "keydown" | "pointerdown", listener: (event: Event) => void) => () => void;

/** Observe the platform's real activation; never send input or take focus from its current owner. */
const observeActivation = (selector: string, source: "pointer" | "hairline" | "key" | "escape", accept: () => boolean, listen: Listen, applied: () => boolean = () => true): Promise<boolean> => {
  const target = document.querySelector(selector);

  if (!target) return Promise.resolve(false);

  return new Promise(resolve => {
    const finish = (completed: boolean) => {
      clearTimeout(timer);
      clear();
      resolve(completed);
    };

    const timer = setTimeout(() => finish(false), CYCLE_MS / 2);

    const clear = listen(source === "escape" ? "keydown" : source === "hairline" ? "pointerdown" : "click", event => {
      if (!event.isTrusted || !(event.target instanceof Node) || !target.contains(event.target)) return;

      if (source === "hairline") {
        if (!(event instanceof MouseEvent) || event.button !== 0 || event.target !== target) return;
        const x = event.clientX - target.getBoundingClientRect().left;

        const width = parseFloat(getComputedStyle(target).borderLeftWidth);

        if (!Number.isFinite(width) || width <= 0 || x < 0 || x >= width) return;
      } else if (source === "escape" ? !(event instanceof KeyboardEvent) || event.key !== "Escape" : !(event instanceof MouseEvent) || (source === "pointer" ? event.detail <= 0 : event.detail !== 0)) return;

      if (!accept()) return;
      // Native event dispatch can checkpoint microtasks between listeners. A task observes
      // the existing activation/keyboard owner after propagation, including Solid delegation.
      afterUpdate(() => finish(target.isConnected && applied()));
    });
  });
};

export const domLayers = (journal: LayerAction[], listen: Listen = (type, listener) => makeEventListener(window, type, listener, { capture: true })): Layers => {
  let pending: LayerAction | null = null;
  let activation: LayerStart | null = null;

  const interruptible = () => {
    if (!pending) return true;
    const element = document.querySelector<HTMLElement>(`.${pending.panel}`);

    return element !== null && element.isConnected && !element.hidden && Math.abs(element.getBoundingClientRect().left - pending.destination) >= 1;
  };

  const pointerAction = (panel: "drawer" | "shelf", selector: string, source: "pointer" | "hairline") => {
    const element = document.querySelector<HTMLElement>(`.${panel}`);
    const root = document.querySelector<HTMLElement>("[data-layout-root]");

    if (!element || !root) return Promise.resolve(false);
    let opening = false;

    return observeActivation(selector, source, () => {
      if (!interruptible()) return false;
      const box = element.getBoundingClientRect();

      opening = panel === "drawer" ? element.dataset.open !== "true" : root.dataset.shelf !== "open";
      // Capture before propagation: a post-activation task can already see movement.
      activation = { at_ms: performance.now(), left: box.left, width: box.width, edge: root.getBoundingClientRect().right, opening };

      return true;
    }, listen, () => panel === "drawer" ? element.dataset.open === String(opening) : root.dataset.shelf === (opening ? "open" : "closed"));
  };

  const keyInterruption = async (panel: "drawer" | "shelf", target: string, source: "key" | "escape", open: boolean) => {
    const element = document.querySelector<HTMLElement>(`.${panel}`);
    const root = document.querySelector<HTMLElement>("[data-layout-root]");

    if (!element || !root) return false;
    const before = element.getBoundingClientRect();
    const entry: LayerAction = { panel, source: "trusted-key", target, at_ms: performance.now(), from: before.left, destination: root.getBoundingClientRect().right - (open ? before.width : 0), observed: null, completed: false, samples: [] };

    journal.push(entry);

    if (!(await observeActivation(target, source, interruptible, listen))) return false;
    entry.at_ms = performance.now();
    entry.observed = element.getBoundingClientRect().left;
    entry.completed = panel === "drawer" ? element.dataset.open === String(open) : root.dataset.shelf === (open ? "open" : "closed");

    if (entry.completed) pending = null;

    return entry.completed;
  };

  return {
    openDrawer: () => pointerAction("drawer", SHELF_ROW, "pointer"),
    closeDrawer: () => pointerAction("drawer", ".drawer", "hairline"),
    escapeDrawer: () => keyInterruption("drawer", ".drawer", "escape", false),
    toggleShelf: () => pointerAction("shelf", ".shelf-tab[data-selected]", "pointer"),
    keyShelf: () => keyInterruption("shelf", ".shelf-tab[data-selected]", "key", true),
    halfway: async (panel, action) => {
      activation = null;
      const completed = await halfDisplacement(panel, action, journal, () => activation);

      if (completed) pending = journal.at(-1) ?? null;

      return completed;
    },
  };
};

const workingGlyphs = () => [...document.querySelectorAll('.rail .glyph[data-drawing="quarter"]')].filter(glyph => {
  const box = glyph.getBoundingClientRect();

  return box.width > 0 && box.height > 0 && box.top >= 0 && box.bottom <= innerHeight && box.left >= 0 && box.right <= innerWidth;
}).length;

const wallClock: Clock = { sleep };

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

/** Fixture writes stay at the existing RPC seam; rendered controls retain fold, drag and focus ownership. */
export const fixtureTodos = (app: Pick<AppSeam, "rpc">, fixture: Fixture, controls: Pick<Todos, "toggleFold" | "reorder">, journal: TodoAction[]): Todos => {
  let inserted: number | null = null;
  let repeat = 0;
  let group = fixture.todos.slice(0, 4);

  const record = async (action: TodoAction["action"], targets: number[], source: TodoAction["source"], work: () => Promise<boolean>) => {
    const entry: TodoAction = { action, targets, source, completed: false };

    journal.push(entry);
    entry.completed = await work();

    return entry.completed;
  };

  const restore = async () => {
    // Never delete an unrecorded row, or silently adopt a changed owner/body/dependency.
    const rows = await app.rpc("todo.list", null);

    if (rows.length !== fixture.todos.length + (inserted === null ? 0 : 1) || !fixture.todos.every(target => rows.some(row => row.id === target.id && row.home === fixture.home && row.title === target.title && row.body === "body text" && JSON.stringify(row.owner) === JSON.stringify(target.owner) && JSON.stringify(row.blockers) === JSON.stringify(target.blockers)))) return false;

    if (inserted !== null) {
      await app.rpc("todo.delete", { operation: crypto.randomUUID(), ids: [inserted] });
    }

    for (const row of fixture.todos) {
      if (rows.find(actual => actual.id === row.id)?.done) await app.rpc("todo.reopen", { id: row.id });
    }

    // Restoration is preparation, never a measured pointer action.
    for (let index = fixture.todos.length - 1; index >= 0; index -= 1) {
      await app.rpc("todo.reorder", { id: fixture.todos[index]!.id, before: fixture.todos[index + 1]?.id ?? null });
    }

    const restored = await app.rpc("todo.list", null);

    if (restored.length !== 8 || restored.some((row, index) => row.id !== fixture.todos[index]?.id || row.done)) return false;
    inserted = null;

    return true;
  };

  return {
    open: async () => {
      const rows = await app.rpc("todo.list", null);
      const roots = group.filter(row => row.blockers.length === 0).map(row => row.id);

      return rows.filter(row => !row.done && (roots.includes(row.id) || row.id === inserted)).map(row => row.id);
    },
    create: async () => {
      if (!(await restore())) return false;
      group = fixture.todos.slice((repeat % 2) * 4, (repeat % 2) * 4 + 4);
      repeat += 1;

      return record("insert", [], "rpc", async () => {
        const made = await app.rpc("todo.create", { title: "motion insertion", body: "body text", blockers: [], owner: group[0]!.owner });

        inserted = made.id;
        journal.at(-1)!.targets.push(made.id);
        await app.rpc("todo.move", { id: made.id, home: fixture.home });
        const actual = await app.rpc("todo.get", { id: made.id });

        return !actual.done && actual.home === fixture.home && actual.title === "motion insertion" && JSON.stringify(actual.owner) === JSON.stringify(group[0]!.owner);
      });
    },
    complete: async id => record("complete", [id], "rpc", async () => {
      if (id !== inserted) return false;
      await app.rpc("todo.complete", { id });

      return (await app.rpc("todo.get", { id })).done;
    }),
    toggleFold: () => record("fold", inserted === null ? [] : [inserted], "synthetic-pointer", controls.toggleFold),
    reorder: () => {
      const id = group[3]!.id;
      const before = group[0]!.id;

      return record("reorder", [id, before], "trusted-pointer", async () => {
        if (!(await controls.reorder(id, before))) return false;
        const rows = await app.rpc("todo.list", null);
        const ids = rows.filter(row => group.some(target => target.id === row.id)).map(row => row.id);

        return ids[0] === id && ids[1] === before && group.every(target => rows.some(row => row.id === target.id && JSON.stringify(row.blockers) === JSON.stringify(target.blockers) && JSON.stringify(row.owner) === JSON.stringify(target.owner)));
      });
    },
  };
};

/** Observe native input without generating it. Both the actual source and the authoritative result must match. */
export const pointerReorder = (id: number): Promise<boolean> => new Promise(resolve => {
  const controller = new AbortController();
  let pressed = false;

  const finish = (completed: boolean) => {
    clearTimeout(timer);
    controller.abort();
    resolve(completed);
  };

  const timer = setTimeout(() => finish(false), CYCLE_MS / 2);

  window.addEventListener("pointerdown", event => {
    pressed = event.isTrusted && event.button === 0 && event.target instanceof Element && event.target.closest("[data-todo]")?.getAttribute("data-todo") === String(id);
  }, { capture: true, signal: controller.signal });
  window.addEventListener("pointerup", event => {
    if (!pressed || !event.isTrusted || !document.querySelector(".sortable-source,[data-dnd-dragging]")) return;
    // The existing drag owner receives the release before its public RPC readback.
    queueMicrotask(() => finish(true));
  }, { capture: true, signal: controller.signal });
  window.addEventListener("keydown", event => { if (event.key === "Escape") finish(false); }, { capture: true, signal: controller.signal });
});

export const domTodos = (app: AppSeam, fixture: Fixture, journal: TodoAction[]): Todos => fixtureTodos(app, fixture, {
  toggleFold: async () => {
    const fold = document.querySelector<HTMLElement>(".shelf-done-line button");

    if (!fold) return false;
    const before = document.querySelector<HTMLElement>(".todo-done-fold")?.dataset.open === "true";

    fold.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));

    return Promise.race([
      appears(() => document.querySelector<HTMLElement>(".todo-done-fold")?.dataset.open === String(!before) ? true : null, "the changed done fold"),
      sleep(SETTLE_MS).then(() => false),
    ]);
  },
  reorder: async (id, before) => {
    if (!document.querySelector(`.shelf [data-todo="${id}"]`) || !document.querySelector(`.shelf [data-todo="${before}"]`)) return false;

    if (!(await pointerReorder(id))) return false;
    // Drag mutations are asynchronous. Keep the existing settling bound and refuse an unapplied result.
    const until = performance.now() + SETTLE_MS;

    do {
      const rows = await app.rpc("todo.list", null);
      const at = rows.findIndex(row => row.id === id);

      if (at >= 0 && rows[at + 1]?.id === before) return true;
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    } while (performance.now() < until);

    return false;
  },
}, journal);

/** The workload's setup, then the cycle its actions repeat; an unknown workload is an error, never an empty run. */
const prepare = async (app: AppSeam, workload: string, journal: LayerAction[], todoJournal: TodoAction[], fixture?: Fixture): Promise<(index: number) => Promise<boolean>> => {
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

    return todosCycle(domTodos(app, fixture!, todoJournal));
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
export const createFrameRun = (app: AppSeam, workload: string, cwd: string, reduced: Accessor<boolean>) => {
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
    const todoActions: TodoAction[] = [];
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

    const cycle = await bounded(prepare(app, workload, layerActions, todoActions, fixture), SETUP_BOUND_MS, `the ${workload} setup`);

    if (fixture) {
      const bubble = input.closest<HTMLElement>(".bubble[data-bubble]");

      if (!bubble || bubble.hidden || bubble.dataset.bubble !== fixture.terminal) throw new Error("the fixture streaming Terminal is not selected and visible");
      input.focus();
    }

    const preference: PreferenceAction[] = [];
    let phase: PreferenceAction["phase"] = "warmup";
    const stopPreference = observePreference(reduced, () => performance.now(), () => phase, preference, () => {
      const action = layerActions.at(-1);

      if (!action || action.source !== "trusted-pointer" || action.samples.length === 0) return undefined;
      const element = document.querySelector<HTMLElement>(`.${action.panel}`);
      const distance = action.destination - action.from;

      if (!element || !element.isConnected || element.hidden || Math.abs(distance) < 1) return undefined;
      const observed = element.getBoundingClientRect().left;
      const progress = (observed - action.from) / distance;

      // A settled, reversed or never-started segment is not a live movement.
      if (progress <= 0 || progress >= 1 - 1 / Math.abs(distance)) return undefined;

      return { panel: action.panel, target: action.target, action_at_ms: action.at_ms, from: action.from, destination: action.destination, observed, progress };
    });
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
        async () => {
          phase = "sample";
          const actions = await everyTwoSeconds(wallClock, workload === "drag" ? dragCycle : cycle);

          phase = "after-actions";

          return actions.completed;
        },
      );

      const result = workload === "drag" ? { ...measured, dragActions } : measured;

      const observer: NonNullable<FrameReport["observer"]> = {
        viewport, shelf_mode: shelfMode, layer_actions: layerActions, todo_actions: todoActions, preference, variant: "unqualified",
        native_qualification: "incomplete: trusted layer sequence, both Shelf cases and live preference variants remain unqualified",
      };

      if (fixture) observer.fixture = fixture;

      const observed = { ...result, observer };

      await report(observed);
    } finally {
      controller.abort();
      stopPreference();
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
