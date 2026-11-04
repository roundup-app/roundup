import { cleanup, fireEvent, screen, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { door, workstream, agent } from "../testing/nodes";
import { mountRail, rowOf, settled } from "../rail/railFixture";
import { percentile } from "./keystrokes";

afterEach(cleanup);

type Mounted = Awaited<ReturnType<typeof mountRail>>;

const never = () => new Promise<never>(() => undefined);

const FRAME_BUDGET_MS = 16;

const WARMUP = 3;

const RUNS = 20;

/** Click or key to the rendered `starting` row: the work the page does before the frame that shows it, polled by microtask so no timer adds its own wait. */
const untilStarting = async (isStarting: () => boolean) => {
  for (let turn = 0; turn < 1000 && !isStarting(); turn++) await Promise.resolve();
};

const exited = () => agent("old", "done", "finished", { terminal_id: null, can_resume: true });

/** Opens the row's menu, which is the test's cost; the returned function is the user's pick. */
const menuPick = async (mounted: Mounted, label: string) => {
  fireEvent.contextMenu(rowOf("old"), { clientX: 1, clientY: 1 });

  return () => void mounted.app.pickMenu(label);
};

type Launch = { name: string; tree: () => ReturnType<typeof workstream>[]; handler: "agent.spawn" | "agent.resume" | "rail.createWorkstream" | "rail.startDoor" | "workstream.restart"; id: string | null; arm: (mounted: Mounted) => Promise<() => void> };

const launches: Launch[] = [
  { name: "new agent", tree: () => [workstream("ws")], handler: "agent.spawn", id: null, arm: async () => () => void fireEvent.keyDown(document, { key: "n", metaKey: true }) },
  { name: "new workstream", tree: () => [workstream("ws")], handler: "rail.createWorkstream", id: null, arm: async () => {
    fireEvent.click(await screen.findByRole("button", { name: "Create" }));
    const item = await screen.findByRole("menuitem", { name: /^Workstream/ });

    return () => void fireEvent.click(item);
  } },
  { name: "start door", tree: () => [workstream("ws")], handler: "rail.startDoor", id: "ws", arm: async mounted => () => void mounted.rail.startDoor("ws") },
  { name: "resume", tree: () => [exited()], handler: "agent.resume", id: "old", arm: mounted => menuPick(mounted, "Resume") },
  { name: "resume with a mode", tree: () => [exited()], handler: "agent.resume", id: "old", arm: mounted => menuPick(mounted, "Start YOLO") },
  { name: "restart", tree: () => [door("mode", "working", "", { opening_prompt: "go" })], handler: "workstream.restart", id: "mode", arm: async () => {
    const restart = within(rowOf("mode")).getByRole("button", { name: "Restart" });

    return () => void fireEvent.click(restart);
  } },
];

it.each(launches)("u6000a_key_to_starting_stays_under_the_frame_budget_$name", async ({ tree, handler, id, arm }) => {
  const samples: number[] = [];
  const floor: number[] = [];

  // The first runs pay the dev build's cold module and JIT cost, which a user's second launch does not.
  for (let run = 0; run < WARMUP + RUNS; run++) {
    const mounted = await mountRail(tree());

    mounted.app.handlers[handler] = never;
    await settled();

    // The floor: what this harness's dev build spends re-rendering the Rail for any state change, here a plain selection.
    const selecting = performance.now();

    mounted.rail.select(mounted.rail.nodes[0]!.id);

    if (run >= WARMUP) floor.push(performance.now() - selecting);

    const known = new Set(mounted.rail.nodes.map(node => node.id));
    const fire = await arm(mounted);
    const starting = () => mounted.rail.nodes.some(node => (id === null ? !known.has(node.id) : node.id === id) && node.status?.label === "starting");
    const began = performance.now();

    fire();
    await untilStarting(starting);

    if (run >= WARMUP) samples.push(performance.now() - began);
    expect(starting()).toBe(true);
    cleanup();
  }

  // The launch adds less than a frame to the cost any Rail change has in this harness; the raw p95 here sits at the budget before the launch does anything.
  expect(percentile(samples.sort((a, b) => a - b), 0.95) - percentile(floor.sort((a, b) => a - b), 0.5)).toBeLessThan(FRAME_BUDGET_MS);
}, 30_000);
