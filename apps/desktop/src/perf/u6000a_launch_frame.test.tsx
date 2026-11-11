import { cleanup, fireEvent, screen, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { agent, door, workstream } from "../testing/nodes";
import { mountRail, rowOf } from "../rail/railFixture";
import { framesLate, MAX_FRAMES_LATE, type TimedAction } from "./framesLate";
import { percentile } from "./keystrokes";

afterEach(cleanup);

const exited = () =>
  agent("old", "done", "finished", { terminal_id: null, can_resume: true });

/** Row `id`, or with `null` any row, shows the `starting` Status. */
const starting =
  (id: string | null): TimedAction["shown"] =>
  ({ rail }) =>
    expect(
      rail.nodes.some(
        (node) =>
          (id === null || node.id === id) && node.status?.label === "starting",
      ),
    ).toBe(true);

const launches: TimedAction[] = [
  {
    name: "new agent",
    mount: () => mountRail([workstream("ws")]),
    method: "agent.spawn",
    fire: () => void fireEvent.keyDown(document, { key: "n", metaKey: true }),
    shown: starting(null),
  },
  {
    name: "new workstream",
    mount: () => mountRail([workstream("ws")]),
    method: "rail.createWorkstream",
    fire: async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Create" }));
      fireEvent.click(
        await screen.findByRole("menuitem", { name: /^Workstream/ }),
      );
    },
    shown: starting(null),
  },
  {
    name: "start door",
    mount: () => mountRail([workstream("ws")]),
    method: "rail.startDoor",
    fire: ({ rail }) => void rail.startDoor("ws"),
    shown: starting("ws"),
  },
  {
    name: "resume",
    mount: () => mountRail([exited()]),
    method: "agent.resume",
    fire: async ({ app }) => {
      fireEvent.contextMenu(rowOf("old"));
      await app.pickMenu("Resume");
    },
    shown: starting("old"),
  },
  {
    name: "resume with a mode",
    mount: () => mountRail([exited()]),
    method: "agent.resume",
    fire: async ({ app }) => {
      fireEvent.contextMenu(rowOf("old"));
      await app.pickMenu("Start YOLO");
    },
    shown: starting("old"),
  },
  {
    name: "restart",
    mount: () =>
      mountRail([agent("mode", "working", "", { opening_prompt: "go" })]),
    method: "workstream.restart",
    fire: () =>
      void fireEvent.click(
        within(rowOf("mode")).getByRole("button", { name: "Restart" }),
      ),
    shown: starting("mode"),
  },
];

it("u6000a_key_to_starting_stays_under_the_frame_budget", async () => {
  // The first mount warms the module graph and the document; it is not a sample.
  await framesLate(launches[0]!);
  const samples: number[] = [];

  for (const launch of launches) samples.push(await framesLate(launch));
  expect(
    percentile(
      samples.toSorted((a, b) => a - b),
      0.95,
    ),
  ).toBeLessThanOrEqual(MAX_FRAMES_LATE);
}, 60_000);
