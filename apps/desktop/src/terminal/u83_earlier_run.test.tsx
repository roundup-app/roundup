import { cleanup, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { agent, info, node, terminal } from "../testing/nodes";
import { callsTo, mountPane } from "./paneHarness";

afterEach(cleanup);

const LINE = "No output kept from an earlier run";

describe("u83 a node from an earlier run", () => {
  it.each([
    ["Agent", agent("a", "done", "finished", { terminal_id: null })],
    ["Terminal", terminal("a", { terminal_id: null })],
    ["Door", node("a", { terminal_id: null, status: { kind: "idle", label: "waiting", since: 0 } })],
  ])("u83_a_selected_%s_with_no_terminal_preserves_the_history_note_without_terminal_calls", async (_kind, selected) => {
    const { connected, container, app, emulators } = await mountPane([selected]);

    connected.rail.select("a");

    const line = await screen.findByText(LINE);

    expect(line).toBeTruthy();
    expect(container.querySelector(".pane-failure")?.textContent).toBe("");
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(emulators.size).toBe(0);
    expect(callsTo(app, "terminal.write")).toEqual([]);
    expect(callsTo(app, "terminal.resize")).toEqual([]);
  });

  it("u83_a_node_with_a_terminal_never_shows_the_line_even_before_output", async () => {
    const { connected } = await mountPane([node("a")], [info("t-a")]);

    connected.rail.select("a");

    expect(screen.queryByText(LINE)).toBeNull();
  });

  it("u83_nothing_selected_keeps_its_empty_line_and_not_this_one", async () => {
    await mountPane([node("a", { terminal_id: null })]);

    expect(screen.getByText("Select an Agent or a Terminal")).toBeTruthy();
    expect(screen.queryByText(LINE)).toBeNull();
  });

  it("u83_the_line_leaves_when_a_node_with_output_is_selected_next", async () => {
    const { connected, emulators } = await mountPane([node("a", { terminal_id: null }), node("b")], [info("t-b")]);

    connected.rail.select("a");
    await screen.findByText(LINE);
    connected.rail.select("b");

    expect(screen.queryByText(LINE)).toBeNull();
    expect(emulators.has("t-b")).toBe(true);
  });
});
