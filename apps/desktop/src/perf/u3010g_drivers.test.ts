import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildReport } from "./frames";
import { createHomed, fixtureTodos, everyTwoSeconds, glyphsCycle, layersCycle, pointerReorder, todosCycle } from "./frame_run";
import type { Layers, Todos } from "./frame_run";
import { bounded, writeInChunks } from "./run";
import { prepareFixture } from "./fixture";
import { createFakeApp } from "../testing/fakeApp";
import { todoHandlers, padHandlers } from "../testing/stores";
import { agent, info, workstream } from "../testing/nodes";
import type { AppSeam } from "../app/seam";

const clock = { sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)) };

const SAMPLE_MS = 60_000;

beforeEach(() => vi.useFakeTimers());

afterEach(() => vi.useRealTimers());

const layers = (log: [number, string][], missing?: keyof Layers): Layers => {
  const press = (name: keyof Layers) => () => {
    log.push([Date.now(), name]);

    return name !== missing;
  };

  return { openDrawer: press("openDrawer"), closeDrawer: press("closeDrawer"), escapeDrawer: press("escapeDrawer"), toggleShelf: press("toggleShelf"), keyShelf: press("keyShelf"), halfway: async (_panel, action) => action() };
};

const fixtureApp = (prefix: string) => {
  const app = createFakeApp();
  const tree = [workstream(`${prefix}-home`)];
  const store = { todos: [] };
  const pads = { pads: [], history: [] };

  Object.assign(app.handlers, todoHandlers(store, () => {}), padHandlers(pads, () => {}));
  app.handlers["rail.tree"] = () => structuredClone(tree);
  app.handlers["rail.rename"] = ({ id, name }) => {
    const found = tree.find(row => row.id === id)!;

    found.name = name;

    return found;
  };

  app.handlers["rail.createWorkstream"] = ({ name, parent }) => {
    const row = workstream(`${prefix}-${tree.length}`, { name, parent });

    tree.push(row);

    return row;
  };

  app.handlers["agent.spawn"] = ({ name, parent }) => {
    const row = agent(`${prefix}-${tree.length}`, "idle", "idle", { name: name ?? "stand-in", parent });

    tree.push(row);

    return row;
  };

  app.handlers["agent.signal"] = ({ id, payload }) => {
    const row = tree.find(row => row.id === id)!;

    row.status = { kind: payload.hook_event_name === "UserPromptSubmit" ? "working" : "idle", label: "fixture", since: 0, finished: "0" };

    return null;
  };

  app.handlers["terminal.list"] = () => [info("shell")];

  return app;
};

describe("u3010g the frame recorder drives every workload", () => {
  it("u3010g_an_incompatible_project_is_refused_before_fixture_writes", async () => {
    const app = createFakeApp();

    app.handlers["rail.tree"] = () => [workstream("ours"), workstream("other")];

    await expect(prepareFixture(app, "/temporary", "shell")).rejects.toThrow("isolated");
    expect(app.calls.every(call => ["rail.tree", "todo.list", "pad.list"].includes(call.method))).toBe(true);
  });

  it("u3010g_the_fixture_is_nested_owned_and_independent_of_allocated_ids", async () => {
    const app = fixtureApp("base");
    const fixture = await prepareFixture(app, "/temporary", "shell");
    const other = await prepareFixture(fixtureApp("head"), "/other", "shell");
    const rows = await app.rpc("todo.list", null);
    const rail = await app.rpc("rail.tree", null);

    expect(rows).toHaveLength(8);
    expect(rows.every(row => !row.done && row.home === "base-home")).toBe(true);
    expect(rows.slice(0, 4).map(row => row.owner?.kind)).toEqual(["user", "user", "user", "user"]);
    expect(rows.slice(4).every(row => row.owner?.id === fixture.rail.find(node => node.name === "token-rotation")?.id)).toBe(true);
    expect(rows.map(row => row.blockers)).toEqual([[], [1], [2], [], [], [5], [6], []]);
    expect(rail).toHaveLength(40);
    expect(rail.filter(row => row.status?.kind === "working")).toHaveLength(10);
    expect(await app.rpc("pad.list", null)).toHaveLength(4);
    expect(other.bytes).toBe(fixture.bytes);
    expect(other.sha256).toBe(fixture.sha256);
    expect(other.rail).not.toEqual(fixture.rail);
  });

  it("u3010g_an_acknowledged_but_unapplied_fixture_write_is_refused", async () => {
    const app = fixtureApp("bad");

    app.handlers["todo.move"] = ({ id }) => app.rpc("todo.get", { id });

    await expect(prepareFixture(app, "/temporary", "shell")).rejects.toThrow("readback differs");
  });

  it("u3010g_a_large_report_reaches_the_terminal_whole_and_in_order", async () => {
    const bytes = Uint8Array.from({ length: 20_000 }, (_, at) => at % 251);
    const seen: Uint8Array[] = [];

    await writeInChunks(bytes, async (chunk) => { seen.push(chunk); });

    expect(seen.length).toBeGreaterThan(1);
    expect(Uint8Array.from(seen.flatMap((chunk) => [...chunk]))).toEqual(bytes);
  });

  it("u3010g_layers_perform_the_drawer_and_shelf_sequence_every_two_seconds", async () => {
    const log: [number, string][] = [];
    const start = Date.now();
    const run = everyTwoSeconds(clock, layersCycle(layers(log)));

    await vi.advanceTimersByTimeAsync(SAMPLE_MS);

    expect(await run).toEqual({ performed: 30, completed: true });

    const at = (name: string) => log.flatMap(([time, action]) => (action === name ? [time - start] : []));

    expect(at("escapeDrawer")).toHaveLength(15);
    expect(at("toggleShelf")).toHaveLength(45);
    expect(at("keyShelf")).toHaveLength(15);
    // A cycle starts every two seconds, the Drawer then the Shelf: 0 s Drawer, 2 s Shelf, 4 s Drawer.
    const starts = log.filter((_, index) => index % 4 === 0);

    expect(starts.slice(0, 3).map(([time, action]) => [time - start, action])).toEqual([[0, "openDrawer"], [2000, "toggleShelf"], [4000, "openDrawer"]]);
    expect(log.slice(0, 4).map(([, action]) => action)).toEqual(["openDrawer", "closeDrawer", "openDrawer", "escapeDrawer"]);
  });

  it.each([0, 1])("u3010g_layers_wait_for_observed_displacement_before_reversing (%s)", async index => {
    const log: [number, string][] = [];
    let release: (done: boolean) => void = () => {};

    const controls = layers(log);
    controls.halfway = async (_panel, action) => action() && await new Promise<boolean>(resolve => { release = resolve; });
    const run = layersCycle(controls)(index);

    // Time alone cannot authorize a reversal: the geometry observer owns readiness.
    await vi.advanceTimersByTimeAsync(399);
    expect(log).toHaveLength(1);
    release(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(log).toHaveLength(2);
    release(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(log).toHaveLength(3);
    release(false);
    expect(await run).toBe(false);
    expect(log).toHaveLength(3);
  });

  it("u3010g_todos_cycle_one_structural_action_every_two_seconds", async () => {
    let open = [1, 2, 3, 4];
    let next = 5;
    const seen: string[] = [];

    const todos: Todos = {
      open: async () => [...open],
      create: async () => (open.push(next++), seen.push("insert"), true),
      complete: async (id) => (open = open.filter((each) => each !== id), seen.push("complete"), true),
      toggleFold: async () => (seen.push("fold"), true),
      reorder: async (id, before) => (open = [id, ...open.filter((each) => each !== id)], seen.push(`reorder ${id} before ${before}`), true),
    };

    const run = everyTwoSeconds(clock, todosCycle(todos));

    await vi.advanceTimersByTimeAsync(SAMPLE_MS);
    await run;

    expect(seen.slice(0, 4)).toEqual(["insert", "complete", "fold", "reorder 4 before 1"]);
    expect(seen).toHaveLength(30);
    expect(open.length).toBeGreaterThan(0);

    const lone: Todos = { ...todos, open: async () => [9], complete: async () => true };

    expect(await todosCycle(lone)(1)).toBe(false);
  });

  it("u3010g_todo_repeats_restore_the_fixture_before_inserting_again", async () => {
    const app = fixtureApp("repeat");
    const fixture = await prepareFixture(app, "/temporary", "shell");
    const initial = await app.rpc("todo.list", null);
    const journal: import("./frames").TodoAction[] = [];

    const controls = fixtureTodos(app, fixture, {
      toggleFold: async () => true,
      reorder: async (id, before) => {
        await app.rpc("todo.reorder", { id, before });

        return true;
      },
    }, journal);

    const cycle = todosCycle(controls);

    for (let index = 0; index < 8; index += 1) expect(await cycle(index)).toBe(true);
    expect(journal.map(row => row.action)).toEqual(["insert", "complete", "fold", "reorder", "insert", "complete", "fold", "reorder"]);
    expect(journal.every(row => row.completed)).toBe(true);
    // A repeat restores every original row's home, owner, body, nesting and open state.
    const actual = await app.rpc("todo.list", null);

    expect(actual.filter(row => fixture.todos.some(target => target.id === row.id)).toSorted((a, b) => a.id - b.id)).toEqual(initial);
    expect(actual).toHaveLength(9);
    expect(actual.filter(row => row.done)).toHaveLength(1);
    expect(journal.flatMap(row => row.action === "reorder" ? [row.targets] : [])).toEqual([[4, 1], [8, 5]]);
  });

  it("u3010g_synthetic_pointer_events_cannot_complete_the_native_reorder_phase", async () => {
    const run = pointerReorder(4);

    window.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
    window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, button: 0 }));
    await vi.advanceTimersByTimeAsync(1000);

    expect(await run).toBe(false);
  });

  it("u3010g_an_unapplied_pointer_reorder_is_not_completed", async () => {
    const app = fixtureApp("no-order");
    const fixture = await prepareFixture(app, "/temporary", "shell");
    const journal: import("./frames").TodoAction[] = [];
    const controls = fixtureTodos(app, fixture, { toggleFold: async () => true, reorder: async () => true }, journal);

    await controls.create();
    expect(await controls.reorder(4, 1)).toBe(false);
    expect(journal.at(-1)).toMatchObject({ action: "reorder", targets: [4, 1], completed: false });
  });

  it("u3010g_an_unapplied_todo_action_is_not_completed", async () => {
    const app = fixtureApp("unapplied");
    const fixture = await prepareFixture(app, "/temporary", "shell");
    const journal: import("./frames").TodoAction[] = [];
    const controls = fixtureTodos(app, fixture, { toggleFold: async () => true, reorder: async () => true }, journal);

    expect(await controls.create()).toBe(true);
    app.handlers["todo.complete"] = ({ id }) => app.rpc("todo.get", { id });
    const open = await controls.open();

    expect(await controls.complete(open.at(-1)!)).toBe(false);
    expect(journal.at(-1)).toMatchObject({ action: "complete", completed: false });
  });

  it("u3010g_a_driven_todo_is_homed_in_the_workstream_whose_shelf_shows_it", async () => {
    const calls: [string, unknown][] = [];
    const rpc = async (method: string, params: Record<string, string | number | null>) => (calls.push([method, params]), { id: 7 });

    // SAFETY: createHomed calls only todo.create and todo.move, which this stub answers; the other methods are never reached.
    await createHomed({ rpc } as Pick<AppSeam, "rpc">, "ws-1", "seed 0");

    expect(calls).toEqual([["todo.create", { title: "seed 0", body: null, blockers: null }], ["todo.move", { id: 7, home: "ws-1" }]]);
  });

  it("u3010g_glyphs_need_ten_working_glyphs", async () => {
    expect(await glyphsCycle(() => 9)()).toBe(false);
    expect(await glyphsCycle(() => 10)()).toBe(true);
  });

  it("u3010g_a_missing_target_leaves_the_run_invalid", async () => {
    const run = everyTwoSeconds(clock, layersCycle(layers([], "closeDrawer")));

    await vi.advanceTimersByTimeAsync(SAMPLE_MS);

    const { performed, completed } = await run;

    const report = buildReport({
      workload: "layers", hz: 60, engine: "chromium", timerResolutionMs: 0.1, userAgent: "test",
      sample: Array(600).fill(16.7), idle: Array(300).fill(16.7), hidden: false, completed: true, actionsDone: completed,
    });

    expect(performed).toBe(0);
    expect(report).toMatchObject({ verdict: "invalid", exit: 2 });
    expect(report.invalid).toContain("the workload's actions did not complete");
  });

  it("u3010g_a_setup_that_never_answers_ends_in_an_error_naming_it", async () => {
    const outcome = bounded(new Promise<never>(() => {}), 5_000, "the glyphs setup").catch((failure: Error) => failure.message);

    await vi.advanceTimersByTimeAsync(5_000);

    expect(await outcome).toBe("the glyphs setup did not finish within 5000 ms");
  });
});
