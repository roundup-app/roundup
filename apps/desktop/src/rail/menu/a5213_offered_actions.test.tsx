import { cleanup, fireEvent, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import type { RailNode } from "@contracts/agent/RailNode";
import { agent, door, workstream } from "../../testing/nodes";
import { exitedTerminal, mountRail, railCallsTo, rowOf } from "../railFixture";

afterEach(cleanup);

/**
 * The Daemon's `agent.resume` guard (`crates/agents/src/resume.rs`, A5213): a live row takes only
 * a `mode`; an exited one needs a saved conversation, which `can_resume` reports.
 */
const accepted = (node: RailNode, live: boolean, params: { mode?: string }) => (live ? params.mode !== undefined : node.can_resume);

const rows: { name: string; node: RailNode; live: boolean }[] = [
  { name: "agent-exited-with-data", node: agent("x", "done", "done", { can_resume: true }), live: false },
  { name: "agent-exited-without-data", node: agent("x", "done", "done"), live: false },
  { name: "agent-running", node: agent("x", "working", "busy"), live: true },
  { name: "door-exited-with-data", node: door("x", "done", "done", { can_resume: true }), live: false },
  { name: "door-exited-without-data", node: door("x", "done", "done"), live: false },
  { name: "door-running", node: door("x", "working", "busy"), live: true },
  { name: "group", node: workstream("x"), live: false },
];

describe("a5213 offered means accepted", () => {
  for (const { name, node, live } of rows) {
    it(`a5213_every_offered_entry_is_accepted_by_the_guard: ${name}`, async () => {
      const { app } = await mountRail([node], live ? [] : [exitedTerminal("x", 0)]);

      app.handlers["agent.resume"] = () => node;
      fireEvent.contextMenu(rowOf("x"), { clientX: 120, clientY: 80 });
      const offered = (app.shownMenus.at(-1)?.items ?? []).filter((item) => item.enabled && ["Resume", "Start YOLO"].includes(item.label)).map((item) => item.label);

      for (const label of offered) {
        const before = railCallsTo(app, "agent.resume").length;

        await app.pickMenu(label);
        await waitFor(() => expect(railCallsTo(app, "agent.resume").length).toBe(before + 1));
        const params = railCallsTo(app, "agent.resume").at(-1) as { mode?: string };

        expect(accepted(node, live, params), `${label} on ${name}`).toBe(true);
        fireEvent.contextMenu(rowOf("x"), { clientX: 120, clientY: 80 });
      }
    });
  }
});
