// fallow-ignore-file duplicate-export -- Clock sleeps for the frame driver; state/clock’s Clock reads time. Neither is barrel-exported.
import { createComputed, createRoot, onCleanup, untrack } from "solid-js";
import { is, string } from "valibot";
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
export const observePreference = (reduced: Accessor<boolean>, now: () => number, phase: () => PreferenceAction["phase"], journal: PreferenceAction[], displacement: () => Pick<PreferenceAction, "movement" | "glyphs" | "todos"> = () => ({}), settlement?: {
  previousFrame?(): PreferenceAction["previous_frame"];
  afterUpdate(callback: () => void): void;
  read(change: PreferenceAction): "settled" | "moving" | "unavailable";
}): (() => void) => createRoot(dispose => {
  let initial = true;
  let pending: PreferenceAction | undefined;

  onCleanup(() => {
    if (pending) pending.settlement = { status: "disposed" };
    pending = undefined;
  });
  createComputed(() => {
    const value = reduced();
    const entry: PreferenceAction = { at_ms: now(), reduced: value, phase: untrack(phase) };

    if (pending) pending.settlement = { status: "superseded" };
    pending = undefined;

    // The initial value is setup, not a switch. Sample displacement synchronously
    // with the shared source change, before a later frame can reach its endpoint.
    if (!initial && entry.phase === "sample") {
      Object.assign(entry, untrack(displacement));
      const previous = untrack(() => settlement?.previousFrame?.());

      // A frame from before another source change or the sample cannot establish
      // the immediately preceding movement of the value being replaced.
      if (previous && previous.reduced !== value && previous.at_ms < entry.at_ms && previous.at_ms > (journal.at(-1)?.at_ms ?? -Infinity)) entry.previous_frame = previous;

      if (value && settlement) {
        entry.settlement = { status: "pending" };
        pending = entry;
        settlement.afterUpdate(() => {
          if (pending !== entry) return;
          pending = undefined;
          entry.settlement = { status: phase() === "sample" ? settlement.read(entry) : "unavailable", at_ms: now() };
        });
      }
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
export const everyTwoSeconds = async (clock: Clock, cycle: (index: number) => Promise<boolean>, present: () => boolean = () => true): Promise<{ performed: number; completed: boolean }> => {
  let performed = 0;

  for (let index = 0; index < CYCLES; index += 1) {
    if (!present()) return { performed, completed: false };
    const [done] = await Promise.all([cycle(index), clock.sleep(CYCLE_MS)]);

    if (!done || !present()) return { performed, completed: false };

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
  /** Waits for half-displacement, or records final settlement if the live source reduces movement first. */
  halfway(panel: "drawer" | "shelf", action: () => boolean | Promise<boolean>): Promise<boolean>;
  /** Reduced motion has final geometry rather than interruptible displacement. */
  settled(panel: "drawer" | "shelf", action: () => boolean | Promise<boolean>): Promise<boolean>;
};

/** One Layers cycle: a Drawer cycle, then a Shelf cycle, alternating. Normal motion reverses at measured half-displacement; reduced motion observes settlement before the next action. */
export const layersCycle = (layers: Layers, reduced: Accessor<boolean> = () => false) => async (index: number): Promise<boolean> => {
  // Read the live source for every segment: a switch can settle the preceding one.
  const movement = (panel: "drawer" | "shelf", action: () => boolean | Promise<boolean>) => reduced() ? layers.settled(panel, action) : layers.halfway(panel, action);

  if (index % 2 === 0) {
    if (!(await movement("drawer", layers.openDrawer))) return false;

    if (!(await movement("drawer", layers.closeDrawer))) return false;

    if (!(await movement("drawer", layers.openDrawer))) return false;

    // Interrupt the reopened movement with a key before it settles.
    return layers.escapeDrawer();
  }

  // Start open, reverse twice, then interrupt by key back to open for the next cycle.
  if (!(await movement("shelf", layers.toggleShelf))) return false;

  if (!(await movement("shelf", layers.toggleShelf))) return false;

  if (!(await movement("shelf", layers.toggleShelf))) return false;

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

const SHELF_ROW = '.shelf [data-todo] .todo-row-button';

const clickAt = (selector: string): boolean => {
  const target = document.querySelector(selector);

  if (!target) return false;

  target.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));

  return true;
};

type LayerStart = { at_ms: number; left: number; width: number; edge: number; opening: boolean; reduced: boolean };

/** Reads displayed boxes; animation progress/time is not displacement. */
const observeLayerMovement = async (panel: "drawer" | "shelf", action: () => boolean | Promise<boolean>, journal: LayerAction[], activation: () => LayerStart | null, reduced: Accessor<boolean>, criterion: "halfway" | "reduced-settlement"): Promise<boolean> => {
  const element = document.querySelector<HTMLElement>(`.${panel}`);
  const root = document.querySelector("[data-layout-root]");

  if (!element || !root) return false;
  const initial = element.getBoundingClientRect();
  const edge = root.getBoundingClientRect().right;
  const todo = document.querySelector(SHELF_ROW)?.closest<HTMLElement>("[data-todo]")?.dataset.todo;
  const opening = element.dataset.open !== "true";
  const target = panel === "shelf" ? ".shelf-tab[data-selected]" : opening ? `.shelf [data-todo="${todo}"] .todo-row-button` : ".drawer";
  const entry: LayerAction = { panel, source: "trusted-pointer", criterion, reduced: reduced(), target, at_ms: performance.now(), from: initial.left, destination: opening ? edge - initial.width : edge, observed: null, completed: false, samples: [] };

  journal.push(entry);

  if (initial.width <= 0) return false;
  const applied = await action();
  const before = activation();

  if (!before || before.width <= 0) return false;
  const destination = before.opening ? before.edge - before.width : before.edge;
  const distance = destination - before.left;

  entry.reduced = before.reduced;
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

      // A live switch can settle an in-flight normal segment. Preserve that actual
      // completion criterion; final geometry never becomes half-displacement evidence.
      if (reduced()) {
        entry.criterion = "reduced-settlement";

        return finish(Math.abs(left - destination) < 1);
      }

      if (criterion === "reduced-settlement") return finish(false);

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

export const domLayers = (journal: LayerAction[], listen: Listen = (type, listener) => makeEventListener(window, type, listener, { capture: true }), reduced: Accessor<boolean> = () => false): Layers => {
  let pending: LayerAction | null = null;
  let activation: LayerStart | null = null;

  const interruptible = () => {
    if (!pending || reduced()) return true;
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
      activation = { at_ms: performance.now(), left: box.left, width: box.width, edge: root.getBoundingClientRect().right, opening, reduced: reduced() };

      return true;
    }, listen, () => panel === "drawer" ? element.dataset.open === String(opening) : root.dataset.shelf === (opening ? "open" : "closed"));
  };

  const keyInterruption = async (panel: "drawer" | "shelf", target: string, source: "key" | "escape", open: boolean) => {
    const element = document.querySelector<HTMLElement>(`.${panel}`);
    const root = document.querySelector<HTMLElement>("[data-layout-root]");

    if (!element || !root) return false;
    const before = element.getBoundingClientRect();
    const entry: LayerAction = { panel, source: "trusted-key", criterion: "key-settlement", reduced: reduced(), target, at_ms: performance.now(), from: before.left, destination: root.getBoundingClientRect().right - (open ? before.width : 0), observed: null, completed: false, samples: [] };

    journal.push(entry);

    if (!(await observeActivation(target, source, () => {
      entry.reduced = reduced();

      return interruptible();
    }, listen))) return false;
    entry.at_ms = performance.now();
    entry.observed = element.getBoundingClientRect().left;
    entry.completed = (panel === "drawer" ? element.dataset.open === String(open) : root.dataset.shelf === (open ? "open" : "closed")) && Math.abs(entry.observed - entry.destination) < 1;

    if (entry.completed) pending = null;

    return entry.completed;
  };

  const movement = async (panel: "drawer" | "shelf", action: () => boolean | Promise<boolean>, criterion: "halfway" | "reduced-settlement") => {
    activation = null;
    const completed = await observeLayerMovement(panel, action, journal, () => activation, reduced, criterion);
    const entry = journal.at(-1);

    pending = completed && entry?.criterion === "halfway" ? entry : null;

    return completed;
  };

  return {
    openDrawer: () => pointerAction("drawer", SHELF_ROW, "pointer"),
    closeDrawer: () => pointerAction("drawer", ".drawer", "hairline"),
    escapeDrawer: () => keyInterruption("drawer", ".drawer", "escape", false),
    toggleShelf: () => pointerAction("shelf", ".shelf-tab[data-selected]", "pointer"),
    keyShelf: () => keyInterruption("shelf", ".shelf-tab[data-selected]", "key", true),
    halfway: (panel, action) => movement(panel, action, "halfway"),
    settled: (panel, action) => movement(panel, action, "reduced-settlement"),
  };
};

const workingGlyphs = (fixture?: Fixture) => [...document.querySelectorAll('.rail-row[data-kind="working"] .glyph[data-drawing="quarter"]')].filter(glyph => {
  if (fixture && !fixture.working.includes(glyph.closest<HTMLElement>(".rail-row")?.dataset.id ?? "")) return false;
  const box = glyph.getBoundingClientRect();

  return box.width > 0 && box.height > 0 && box.top >= 0 && box.bottom <= innerHeight && box.left >= 0 && box.right <= innerWidth;
}).length;

/** Read the fixture's current arcs before the shared source cancels their loops; never infer angle from animation time. */
export const glyphDisplacement = (fixture: Pick<Fixture, "working">): NonNullable<PreferenceAction["glyphs"]> => fixture.working.flatMap(id => {
  const row = [...document.querySelectorAll<HTMLElement>('.rail-row[data-kind="working"]')].find(row => row.dataset.id === id);
  const arc = row?.querySelector<SVGPathElement>('.glyph[data-drawing="quarter"] > .kind-mark > .working-arc');

  if (!arc || !arc.isConnected || row?.closest('[hidden], [inert]')) return [];
  const box = arc.getBoundingClientRect();

  if (box.width <= 0 || box.height <= 0 || box.top < 0 || box.bottom > innerHeight || box.left < 0 || box.right > innerWidth) return [];

  // Only the active transform loop qualifies. An outgoing frozen arc or opacity fade does not.
  if (!arc.getAnimations().some(animation => animation.playState === "running" && animation.effect instanceof KeyframeEffect && animation.effect.getTiming().iterations === Infinity && animation.effect.getKeyframes().some(frame => frame.transform !== undefined))) return [];

  const transform = getComputedStyle(arc).transform;
  const matrix = new DOMMatrixReadOnly(transform);
  const degrees = (Math.atan2(matrix.b, matrix.a) * 180 / Math.PI + 360) % 360;

  return Number.isFinite(degrees) ? [{ target: id, transform, degrees }] : [];
});

/** The installed row owner animates translations to final geometry; read its displayed offset, never animation time. */
export const todoDisplacement = (fixture: Pick<Fixture, "todos">, action: TodoAction | undefined): PreferenceAction["todos"] => {
  if (!action) return undefined;
  const ids = new Set([...fixture.todos.map(row => row.id), ...action.targets]);
  const rows: NonNullable<PreferenceAction["todos"]>["rows"] = [];

  for (const row of document.querySelectorAll<HTMLElement>(".shelf [data-todo]")) {
    const target = Number(row.dataset.todo);

    if (!ids.has(target) || !row.isConnected || row.closest('[hidden], [inert], [aria-hidden="true"]')) continue;
    const box = row.getBoundingClientRect();

    if (box.width <= 0 || box.height <= 0 || box.bottom <= 0 || box.top >= innerHeight || box.right <= 0 || box.left >= innerWidth) continue;

    for (const animation of row.getAnimations()) {
      if (animation.playState !== "running" || !(animation.effect instanceof KeyframeEffect)) continue;
      const frames = animation.effect.getKeyframes();
      const from = frames[0]?.transform;
      const to = frames.at(-1)?.transform;

      // The existing sorted-list owner uses exactly two translation endpoints.
      // Fades, loops, keyframes with intermediate destinations and other effects cannot stand for row displacement.
      if (frames.length !== 2 || !is(string(), from) || !is(string(), to) || animation.effect.getTiming().iterations !== 1) continue;
      const start = new DOMMatrixReadOnly(from);
      const end = new DOMMatrixReadOnly(to);
      const transform = getComputedStyle(row).transform;
      const shown = new DOMMatrixReadOnly(transform);

      if (![start, end, shown].every(matrix => matrix.is2D && matrix.a === 1 && matrix.b === 0 && matrix.c === 0 && matrix.d === 1)) continue;
      const dx = end.e - start.e;
      const dy = end.f - start.f;
      const distance = dx * dx + dy * dy;

      if (distance < 1) continue;
      const progress = ((shown.e - start.e) * dx + (shown.f - start.f) * dy) / distance;

      if (!Number.isFinite(progress) || progress <= 0 || progress >= 1) continue;
      rows.push({ target, transform, from, to, x: box.left, y: box.top, progress });
    }
  }

  return { action_at_ms: action.at_ms, action: action.action, targets: [...action.targets], rows };
};

/** Read the existing motion owners after a live enable change; missing fixture/targets never establish settlement. */
export const preferenceSettlement = (workload: string, fixture: Fixture | undefined, layer?: LayerAction, todo?: TodoAction): "settled" | "moving" | "unavailable" => {
  if (!fixture || workingGlyphs(fixture) !== WORKING_GLYPHS) return "unavailable";

  if (workload === "glyphs") return glyphDisplacement(fixture).length === 0 ? "settled" : "moving";

  if (workload === "todos") {
    const action = todo;
    const geometry = todoDisplacement(fixture, action);
    const mounted = fixture.todos.every(({ id }) => document.querySelector(`.shelf [data-todo="${id}"]`));

    if (!mounted || !action?.completed || !geometry) return "unavailable";

    return geometry.rows.length === 0 ? "settled" : "moving";
  }

  const action = layer;
  const panel = action && document.querySelector<HTMLElement>(`.${action.panel}`);

  if (!action || !panel?.isConnected) return "unavailable";
  const closed = action.panel === "drawer" ? panel.dataset.open === "false" : document.querySelector<HTMLElement>("[data-layout-root]")?.dataset.shelf === "closed";

  if (panel.hidden && closed) return "settled";

  if (panel.hidden || panel.getBoundingClientRect().width <= 0) return "unavailable";

  return Math.abs(panel.getBoundingClientRect().left - action.destination) < 1 ? "settled" : "moving";
};

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
    const entry: TodoAction = { action, targets, source, at_ms: performance.now(), completed_at_ms: null, completed: false };

    journal.push(entry);
    entry.completed = await work();
    entry.completed_at_ms = performance.now();

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

/** Preparation uses the existing disclosure owners, so nested structural actions reach rendered rows. */
export const expandFixtureTodos = async (fixture: Pick<Fixture, "todos">): Promise<void> => {
  for (const control of document.querySelectorAll<HTMLElement>('.shelf-groups [aria-expanded="false"] .shelf-group-control')) control.click();

  for (const id of new Set(fixture.todos.flatMap(row => row.blockers))) {
    const control = await appears(() => document.querySelector<HTMLElement>(`.shelf [data-group-toggle="${id}"]`), `the fixture Todo ${id} disclosure`);

    if (control.getAttribute("aria-expanded") === "false") control.click();
    await appears(() => control.isConnected && control.getAttribute("aria-expanded") === "true" ? true : null, `the expanded fixture Todo ${id}`);
  }

  await appears(() => fixture.todos.every(({ id }) => {
    const row = document.querySelector(`.shelf [data-todo="${id}"]`);

    return row && !row.closest('[hidden], [inert], [aria-hidden="true"]');
  }) ? true : null, "all eight unfolded fixture Todos");
};

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
const prepare = async (app: AppSeam, workload: string, journal: LayerAction[], todoJournal: TodoAction[], reduced: Accessor<boolean>, fixture?: Fixture): Promise<(index: number) => Promise<boolean>> => {
  if (workload === "layers" || workload === "todos" || workload === "drag") {
    // Rows to open, complete and reorder; one open Todo always stays.
    const home = fixture?.home ?? await runWorkstream(app);

    if (workload === "drag") {
      for (let each = 0; each < 40; each += 1) await createHomed(app, home, `seed ${each}`);
    } else if (!fixture) throw new Error("missing native fixture");

    if (fixture && document.querySelector<HTMLElement>("[data-layout-root]")?.dataset.shelf !== "open") {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "k", code: "KeyK", metaKey: true, bubbles: true, cancelable: true }));
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "b", code: "KeyB", bubbles: true, cancelable: true }));
      await appears(() => document.querySelector(".shelf-groups"), "the scoped Shelf after the work-items command");
    }

    // Open the existing owner groups through their controls; setup does not replace their state owner.
    if (fixture) await expandFixtureTodos(fixture);

    if (workload === "drag") clickAt('.shelf-groups [aria-expanded="false"] .shelf-group-control');

    // The press targets must be on screen before the sample, so a missing one is an error naming it, not a silent invalid run.
    await appears(() => document.querySelector(SHELF_ROW), "the Shelf's first Todo row");

    // Native pointer input is supplied by the Mac observer, never by a synthetic event driver.
    if (workload === "drag") return async () => true;

    if (workload === "layers") return layersCycle(domLayers(journal, undefined, reduced), reduced);

    return todosCycle(domTodos(app, fixture!, todoJournal));
  }

  if (workload === "glyphs") {
    if (!fixture) throw new Error("missing native fixture");
    await appears(() => workingGlyphs(fixture) >= WORKING_GLYPHS ? true : null, "ten visible working Glyphs");

    return glyphsCycle(() => workingGlyphs(fixture));
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
      await appears(() => workingGlyphs(fixture) >= WORKING_GLYPHS ? true : null, "ten visible working Glyphs");
    }

    const cycle = await bounded(prepare(app, workload, layerActions, todoActions, reduced, fixture), SETUP_BOUND_MS, `the ${workload} setup`);

    if (fixture) {
      const bubble = input.closest<HTMLElement>(".bubble[data-bubble]");

      if (!bubble || bubble.hidden || bubble.dataset.bubble !== fixture.terminal) throw new Error("the fixture streaming Terminal is not selected and visible");
      input.focus();
    }

    const fixtureFailures: { at_ms: number; reason: string }[] = [];

    const present = () => {
      if (!fixture) return true;
      const root = document.querySelector<HTMLElement>("[data-layout-root]");
      const bubble = input.closest<HTMLElement>(".bubble[data-bubble]");
      const screen = bubble?.getBoundingClientRect();

      const failures = [
        ...(innerWidth !== viewport.width || innerHeight !== viewport.height || devicePixelRatio !== viewport.device_pixel_ratio ? ["the viewport changed"] : []),
        ...(root?.dataset.shelfMode !== shelfMode ? ["the Shelf mode changed"] : []),
        ...(workingGlyphs(fixture) !== WORKING_GLYPHS ? ["the fixture no longer has ten visible working Glyphs"] : []),
        ...(!input.isConnected || !bubble || bubble.hidden || bubble.dataset.bubble !== fixture.terminal || !screen || screen.width <= 0 || screen.height <= 0 || screen.bottom <= 0 || screen.top >= innerHeight || screen.right <= 0 || screen.left >= innerWidth ? ["the fixture streaming Terminal is not selected and visible"] : []),
      ];

      fixtureFailures.push(...failures.map(reason => ({ at_ms: performance.now(), reason })));

      return failures.length === 0;
    };

    if (!present()) throw new Error(fixtureFailures.map(failure => failure.reason).join("; "));

    const preference: PreferenceAction[] = [];
    let phase: PreferenceAction["phase"] = "warmup";

    let previousFrame: PreferenceAction["previous_frame"];

    const displacement = (): Pick<PreferenceAction, "movement" | "glyphs" | "todos"> => {
      if (workload === "todos" && fixture) {
        const todos = todoDisplacement(fixture, todoActions.at(-1));

        return todos ? { todos } : {};
      }

      if (workload === "glyphs" && fixture) return { glyphs: glyphDisplacement(fixture) };

      const action = layerActions.at(-1);

      if (!action || action.source !== "trusted-pointer" || action.samples.length === 0) return {};
      const element = document.querySelector<HTMLElement>(`.${action.panel}`);
      const distance = action.destination - action.from;

      if (!element || !element.isConnected || element.hidden || Math.abs(distance) < 1) return {};
      const observed = element.getBoundingClientRect().left;
      const progress = (observed - action.from) / distance;

      // A settled, reversed or never-started segment is not a live movement.
      if (progress <= 0 || progress >= 1 - 1 / Math.abs(distance)) return {};

      return { movement: { panel: action.panel, target: action.target, action_at_ms: action.at_ms, from: action.from, destination: action.destination, observed, progress } };
    };

    const stopPreference = observePreference(reduced, () => performance.now(), () => phase, preference, displacement, {
      previousFrame: () => previousFrame,
      afterUpdate,
      read: change => preferenceSettlement(workload, fixture, layerActions.find(action => action.at_ms === change.movement?.action_at_ms), todoActions.find(action => action.at_ms === change.todos?.action_at_ms)),
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
        { frame: callback => void requestAnimationFrame(at => {
          previousFrame = phase === "sample" ? { at_ms: performance.now(), reduced: reduced(), ...displacement() } : undefined;
          callback(at);
        }), hidden: () => document.hidden, now: () => performance.now(), afterUpdate: afterUpdate, after: (ms, callback) => void setTimeout(callback, ms) },
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
          const actions = await everyTwoSeconds(wallClock, workload === "drag" ? dragCycle : cycle, present);

          phase = "after-actions";

          return actions.completed;
        },
      );

      const result = workload === "drag" ? { ...measured, dragActions } : measured;

      const observer: NonNullable<FrameReport["observer"]> = {
        viewport, shelf_mode: shelfMode, fixture_failures: fixtureFailures, layer_actions: layerActions, todo_actions: todoActions, preference, variant: "unqualified",
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
