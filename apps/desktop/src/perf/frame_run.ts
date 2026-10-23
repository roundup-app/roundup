import type { AppSeam } from "../app/seam";
import { toBase64 } from "../terminal/base64";
import { createXtermEmulators } from "../terminal/emulator";
import { recordFrames } from "./frames";
import type { FrameReport } from "./frames";
import { READY, SETUP_BOUND_MS, appears, sleep, timerResolutionMs } from "./run";

/** `docs/motion.md`, **Native performance protocol**: every 2 s one cycle of the workload, over the 60 s sample. */
const CYCLE_MS = 2000;

const CYCLES = 30;

/** Half of the 180 ms Drawer and Shelf slide: where the protocol reverses a layer. */
const HALF_SLIDE_MS = 90;

const SETTLE_MS = 400;

const WORKING_GLYPHS = 10;

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
};

/** One Layers cycle: a Drawer cycle, then a Shelf cycle, alternating. Each opens, reverses at half the slide, reopens and settles. */
export const layersCycle = (layers: Layers, clock: Clock) => async (index: number): Promise<boolean> => {
  const pause = (ms: number) => clock.sleep(ms);

  if (index % 2 === 0) {
    if (!layers.openDrawer()) return false;

    await pause(HALF_SLIDE_MS);

    if (!layers.closeDrawer()) return false;

    await pause(HALF_SLIDE_MS);

    if (!layers.openDrawer()) return false;

    await pause(SETTLE_MS);

    return layers.escapeDrawer();
  }

  // The Shelf starts open: close, reverse at half, and settle open.
  if (!layers.toggleShelf()) return false;

  await pause(HALF_SLIDE_MS);

  if (!layers.toggleShelf()) return false;

  await pause(SETTLE_MS);

  return true;
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

const SHELF_ROW = ".shelf [data-todo] .todo-row-button";

const clickAt = (selector: string): boolean => {
  const target = document.querySelector(selector);

  if (!target) return false;

  target.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));

  return true;
};

const domLayers: Layers = {
  openDrawer: () => clickAt(SHELF_ROW),
  closeDrawer: () => clickAt(".drawer .close"),
  escapeDrawer: () => {
    const close = document.querySelector<HTMLElement>(".drawer .close");

    close?.focus();
    close?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));

    return close !== null;
  },
  toggleShelf: () => clickAt(".shelf-tab[data-selected]"),
};

const workingGlyphs = () => document.querySelectorAll('.rail .glyph[data-drawing="quarter"]').length;

const wallClock: Clock = { sleep };

const attempted = async <T>(work: () => Promise<T>): Promise<boolean> => {
  try {
    await work();

    return true;
  } catch {
    return false;
  }
};

const domTodos = (app: AppSeam): Todos => {
  let made = 0;

  return {
    open: async () => (await app.rpc("todo.list", null)).filter((todo) => !todo.done).map((todo) => todo.id),
    create: () => attempted(() => app.rpc("todo.create", { title: `motion ${(made += 1)}`, body: null, blockers: null })),
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

/** Ten Agents of the temporary Project, each told by a prompt that it works, so ten Glyphs turn their arc. */
const startWorkingAgents = async (app: AppSeam, cwd: string) => {
  const tree = await app.rpc("rail.tree", null);
  const parent = tree.filter((node) => node.kind === "workstream").at(-1)?.id;

  if (!parent) throw new Error("the Project has no Workstream to hold ten working Glyphs");

  for (let each = 0; each < WORKING_GLYPHS; each += 1) {
    const agent = await app.rpc("agent.spawn", { cwd, prompt: null, parent });

    await app.rpc("agent.signal", { id: agent.id, attempt: agent.attempt ?? "1", payload: { hook_event_name: "UserPromptSubmit", prompt: "work" } });
  }

  await Promise.race([
    appears(() => (workingGlyphs() >= WORKING_GLYPHS ? true : null), "ten working Glyphs"),
    sleep(SETUP_BOUND_MS).then(() => Promise.reject(new Error(`fewer than ${WORKING_GLYPHS} Glyphs work`))),
  ]);
};

/** The workload's setup, then the cycle its actions repeat; an unknown workload is an error, never an empty run. */
const prepare = async (app: AppSeam, workload: string, cwd: string): Promise<(index: number) => Promise<boolean>> => {
  if (workload === "layers" || workload === "todos") {
    // Rows to open, complete and reorder; one open Todo always stays.
    for (let each = 0; each < 4; each += 1) await app.rpc("todo.create", { title: `seed ${each}`, body: null, blockers: null });
  }

  if (workload === "layers") return layersCycle(domLayers, wallClock);

  if (workload === "todos") return todosCycle(domTodos(app));

  if (workload === "glyphs") {
    await startWorkingAgents(app, cwd);

    return glyphsCycle(workingGlyphs);
  }

  throw new Error(`the workload ${workload} is not layers, todos or glyphs`);
};

/**
 * The frame run of `scenarios/ui-motion.md` U3010e: in a build made with `VITE_ROUNDUP_PERF` and `VITE_ROUNDUP_PERF_WORKLOAD`,
 * `start` opens a Terminal, records the workload's frame intervals and writes one `FRAMES <json>` line through that Terminal.
 */
export const createFrameRun = (app: AppSeam, workload: string, cwd: string) => {
  let terminalId: string | null = null;
  let ready: () => void = () => {};

  const isReady = new Promise<void>((resolve) => (ready = resolve));

  const emulators = createXtermEmulators({
    written: (bytes) => {
      if (new TextDecoder().decode(bytes).includes(READY)) ready();
    },
    rendered: () => {},
    renderer: () => {},
  });

  const report = async (body: FrameReport | { error: string }) => {
    if (terminalId === null) throw new Error("no Terminal was opened to report through");

    const line = `FRAMES ${JSON.stringify(body)}\n`;

    await app.rpc("terminal.write", { id: terminalId, data: toBase64(new TextEncoder().encode(line)) });
  };

  const measure = async () => {
    const create = await appears(
      () => [...document.querySelectorAll("button")].find((button) => (button.textContent?.trim() === "new Workstream" || button.getAttribute("aria-label") === "Add Workstream") && button.getAttribute("aria-disabled") !== "true") ?? null,
      "the new Workstream button",
    );

    create.click();
    await appears(() => document.querySelector('[role="treeitem"][aria-selected="true"]'), "the new Workstream's selected row");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "t", code: "KeyT", metaKey: true, bubbles: true, cancelable: true }));
    await appears(() => document.querySelector("textarea.xterm-helper-textarea"), "the Terminal's input");
    await Promise.race([isReady, sleep(SETUP_BOUND_MS).then(() => Promise.reject(new Error(`the Terminal never printed ${READY}`)))]);

    const cycle = await prepare(app, workload, cwd);

    await report(
      await recordFrames(
        { frame: (callback) => void requestAnimationFrame(callback), hidden: () => document.hidden },
        {
          workload,
          engine: /Chrome|Chromium/.test(navigator.userAgent) ? "chromium" : "webkit",
          timerResolutionMs: timerResolutionMs(),
          userAgent: navigator.userAgent,
        },
        async () => (await everyTwoSeconds(wallClock, cycle)).completed,
      ),
    );
  };

  return {
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
