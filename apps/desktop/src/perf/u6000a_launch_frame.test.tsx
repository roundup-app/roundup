import { cleanup, fireEvent, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { door, workstream, agent } from "../testing/nodes";
import { mountRail, rowOf, settled } from "../rail/railFixture";
import { percentile } from "./keystrokes";

afterEach(cleanup);

const never = () => new Promise<never>(() => undefined);

const FRAME_BUDGET_MS = 16;

const RUNS = 20;

/** Click or key to the rendered `starting` row: the work the page does before the frame that shows it, polled by microtask so no timer adds its own wait. */
const untilStarting = async (isStarting: () => boolean) => {
  for (let turn = 0; turn < 1000 && !isStarting(); turn++) await Promise.resolve();
};

it("u6000a_key_to_starting_stays_under_the_frame_budget", async () => {
  const samples: number[] = [];
  const floor: number[] = [];

  for (let run = 0; run < RUNS; run++) {
    const mounted = await mountRail([agent("old", "done", "finished", { terminal_id: null, can_resume: true }), workstream("ws"), door("mode", "working", "", { opening_prompt: "go" })]);

    mounted.app.handlers["agent.resume"] = never;
    mounted.app.handlers["workstream.restart"] = never;
    mounted.app.handlers["rail.startDoor"] = never;
    mounted.app.handlers["agent.spawn"] = never;
    await settled();

    // Finding the button is the test's cost, not the page's.
    const restart = within(rowOf("mode")).getByRole("button", { name: "Restart" });
    // The floor: what this harness's dev build spends re-rendering the Rail for any state change, here a plain selection.
    const began0 = performance.now();

    mounted.rail.select("ws");
    floor.push(performance.now() - began0);

    const launches: [string, () => void][] = [
      ["mode", () => fireEvent.click(restart)],
      ["ws", () => void mounted.rail.startDoor("ws")],
    ];

    for (const [id, fire] of launches) {
      const began = performance.now();

      fire();
      await untilStarting(() => mounted.rail.nodes.find(node => node.id === id)?.status?.label === "starting");
      samples.push(performance.now() - began);
      expect(mounted.rail.nodes.find(node => node.id === id)?.status?.label).toBe("starting");
    }

    cleanup();
  }

  const sorted = samples.sort((a, b) => a - b);

  // The launch adds less than a frame to the cost any Rail change has in this harness.
  expect(percentile(sorted, 0.95) - percentile(floor.sort((a, b) => a - b), 0.5)).toBeLessThan(FRAME_BUDGET_MS);
}, 30_000);
