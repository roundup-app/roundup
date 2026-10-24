import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildReport } from "./frames";
import { everyTwoSeconds, glyphsCycle, layersCycle, todosCycle, writeInChunks } from "./frame_run";
import type { Layers, Todos } from "./frame_run";

const clock = { sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)) };

const SAMPLE_MS = 60_000;

beforeEach(() => vi.useFakeTimers());

afterEach(() => vi.useRealTimers());

const layers = (log: [number, string][], missing?: keyof Layers): Layers => {
  const press = (name: keyof Layers) => () => {
    log.push([Date.now(), name]);

    return name !== missing;
  };

  return { openDrawer: press("openDrawer"), closeDrawer: press("closeDrawer"), escapeDrawer: press("escapeDrawer"), toggleShelf: press("toggleShelf") };
};

describe("u3010g the frame recorder drives every workload", () => {
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
    const run = everyTwoSeconds(clock, layersCycle(layers(log), clock));

    await vi.advanceTimersByTimeAsync(SAMPLE_MS);

    expect(await run).toEqual({ performed: 30, completed: true });

    const at = (name: string) => log.flatMap(([time, action]) => (action === name ? [time - start] : []));

    expect(at("escapeDrawer")).toHaveLength(15);
    expect(at("toggleShelf")).toHaveLength(30);
    // A cycle starts every two seconds, the Drawer then the Shelf: 0 s Drawer, 2 s Shelf, 4 s Drawer.
    const starts = log.filter(([, action], index) => action === "toggleShelf" ? log[index - 1]?.[1] !== "toggleShelf" && log[index + 1]?.[1] === "toggleShelf" : action === "openDrawer" && log[index - 1]?.[1] !== "closeDrawer");

    expect(starts.slice(0, 3).map(([time, action]) => [time - start, action])).toEqual([[0, "openDrawer"], [2000, "toggleShelf"], [4000, "openDrawer"]]);
    expect(log.slice(0, 4).map(([, action]) => action)).toEqual(["openDrawer", "closeDrawer", "openDrawer", "escapeDrawer"]);
  });

  it("u3010g_todos_cycle_one_structural_action_every_two_seconds", async () => {
    let open = [1, 2, 3, 4];
    let next = 5;
    const seen: string[] = [];
    const counts: number[] = [];

    const todos: Todos = {
      open: async () => [...open],
      create: async () => (open.push(next++), seen.push("insert"), true),
      complete: async (id) => (open = open.filter((each) => each !== id), seen.push("complete"), true),
      toggleFold: async () => (seen.push("fold"), true),
      reorder: async (id, before) => (open = [id, ...open.filter((each) => each !== id)], seen.push(`reorder ${id} before ${before}`), counts.push(open.length), true),
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

  it("u3010g_glyphs_need_ten_working_glyphs", async () => {
    expect(await glyphsCycle(() => 9)()).toBe(false);
    expect(await glyphsCycle(() => 10)()).toBe(true);
  });

  it("u3010g_a_missing_target_leaves_the_run_invalid", async () => {
    const run = everyTwoSeconds(clock, layersCycle(layers([], "closeDrawer"), clock));

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
});
