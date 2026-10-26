import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildReport } from "./frames";
import { createHomed, everyTwoSeconds, glyphsCycle, layersCycle, todosCycle } from "./frame_run";
import type { Layers, Todos } from "./frame_run";
import { bounded, writeInChunks } from "./run";
import { prepareFixture } from "./fixture";
import { createFakeApp } from "../testing/fakeApp";
import { workstream } from "../testing/nodes";
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

describe("u3010g the frame recorder drives every workload", () => {
  it("u3010g_an_incompatible_project_is_refused_before_fixture_writes", async () => {
    const app = createFakeApp();

    app.handlers["rail.tree"] = () => [workstream("ours"), workstream("other")];

    await expect(prepareFixture(app, "/temporary", "shell")).rejects.toThrow("isolated");
    expect(app.calls.every(call => ["rail.tree", "todo.list", "pad.list"].includes(call.method))).toBe(true);
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
    expect(await bounded(Promise.resolve(3), 5_000, "x")).toBe(3);
  });
});
