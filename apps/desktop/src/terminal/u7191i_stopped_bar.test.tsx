import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { flush } from "solid-js";
import { afterEach, describe, expect, it } from "vitest";
import type { RailNode } from "@contracts/agent/RailNode";
import { node } from "../testing/nodes";
import { event } from "../testing/nodes";
import { mountRailAndPane } from "./paneHarness";

afterEach(cleanup);

const SESSION = "11111111-2222-4333-8444-555555555555";

const stopped = (id: string): RailNode => node(id, { terminal_id: null, can_resume: true, has_conversation: true, overview: { program: "Claude Code", id: SESSION } });

const mount = async (tree: RailNode[]) => {
  const mounted = await mountRailAndPane(tree);

  mounted.app.handlers["rail.tree"] = () => structuredClone(tree);
  mounted.connected.rail.select("a");
  flush();

  return { ...mounted, tree };
};

const calls = (app: { calls: { method: string; params: unknown }[] }, method: string) => app.calls.filter(call => call.method === method).map(call => call.params);

describe("u7191i stopped Agent bar", () => {
  it("u7191i_the_bar_names_the_conversation_and_copy_writes_the_full_id", async () => {
    const { app } = await mount([stopped("a")]);

    await screen.findByText("Conversation 11111111…");
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => { expect(app.clipboardWrites).toEqual([SESSION]); });
  });

  it("u7191i_fork_sends_one_offshoot_and_selects_the_new_row", async () => {
    const { app, connected, tree } = await mount([stopped("a"), node("z")]);

    app.handlers["agent.offshoot"] = () => {
      const made = node("b");

      tree.splice(1, 0, made);
      app.emit(event({ name: "rail.changed" }));

      return made;
    };

    fireEvent.click(await screen.findByRole("button", { name: "Fork" }));

    await waitFor(() => { expect(connected.rail.selected()).toBe("b"); });
    expect(calls(app, "agent.offshoot")).toEqual([{ id: "a" }]);
    expect(connected.rail.nodes.map(each => each.id)).toEqual(["a", "b", "z"]);
  });

  it("u7191i_restart_in_the_bar_resumes_the_conversation_like_the_row", async () => {
    const { app } = await mount([stopped("a")]);

    app.handlers["agent.resume"] = () => node("a");
    fireEvent.click(within(await screen.findByRole("group", { name: "Saved conversation" })).getByRole("button", { name: "Restart" }));

    await waitFor(() => { expect(calls(app, "agent.resume")).toEqual([{ id: "a", mode: "normal" }]); });
  });

  it("u7191i_a_running_agent_shows_no_bar", async () => {
    const { container } = await mount([node("a", { overview: { program: "Claude Code", id: SESSION } })]);

    expect(container.querySelector(".stopped-bar")).toBeNull();
  });
});
