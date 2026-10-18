import { cleanup, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { agent, info, node } from "../testing/nodes";
import { callsTo, mountPane } from "./paneHarness";

afterEach(cleanup);

const overview = { program: "Claude Code", id: "opaque-session", name: "Recipe notebook", used: 84000, limit: 200000,
  card: { intent: "Collect recipes", shape: "Local notebook", facts: ["Stored on disk"], outcome: "Recipes saved" } };

describe("U83 closed Agent overview", () => {
  it("u83_a_closed_agent_shows_available_parts_without_a_terminal_or_a_drawer", async () => {
    const { connected, app, emulators, container } = await mountPane([agent("a", "done", "finished", {
      terminal_id: null, overview, work: { kind: "work", ask: "Keep family recipes", done: "Notebook opens", limits: ["Keep it local"] },
    })]);
    app.handlers["agent.spawnPrompt"] = () => ({ prompt: "Use a single file" });
    connected.rail.select("a");
    for (const text of [overview.program, overview.id, overview.name, overview.card.intent, overview.card.shape, overview.card.facts[0]!, overview.card.outcome,
      "Keep family recipes", "Notebook opens", "Keep it local", "Use a single file"]) {
      expect(await screen.findByText(text)).toBeTruthy();
    }
    expect(screen.getByRole("meter").getAttribute("aria-valuenow")).toBe("84000");
    expect(screen.getByRole("meter").getAttribute("aria-valuemax")).toBe("200000");
    const range = document.createRange();
    range.selectNodeContents(screen.getByText(overview.id));
    window.getSelection()?.addRange(range);
    expect(window.getSelection()?.toString()).toBe(overview.id);
    expect(container.querySelector(".order-line")).toBeNull();
    expect(container.querySelector("details")).toBeNull();
    expect(emulators.size).toBe(0);
    expect(callsTo(app, "terminal.write")).toEqual([]);
    expect(callsTo(app, "terminal.resize")).toEqual([]);
  });

  it("u83_a_closed_agent_omits_missing_parts_and_replaces_them_on_selection", async () => {
    const { connected, app } = await mountPane([
      agent("a", "done", "finished", { terminal_id: null, overview }),
      agent("b", "done", "finished", { terminal_id: null, overview: { program: "Other agent", id: "other-session" } }),
    ]);
    app.handlers["agent.spawnPrompt"] = () => ({ prompt: null });
    connected.rail.select("a");
    await screen.findByText(overview.id);
    connected.rail.select("b");
    await screen.findByText("other-session");
    expect(screen.queryByText(overview.id)).toBeNull();
    expect(screen.queryByText(overview.name)).toBeNull();
    expect(screen.queryByText(overview.card.intent)).toBeNull();
    expect(screen.queryByRole("meter")).toBeNull();
    await waitFor(() => expect(document.querySelector(".order-prompt")).toBeNull());
  });

  it("u83_a_running_agent_keeps_its_order_line_and_hides_overview_data", async () => {
    const { connected, app } = await mountPane([node("a", { overview, work: { kind: "clarification", question: "Which recipes?" } })], [info("t-a")]);
    connected.rail.select("a");
    expect(document.querySelector(".order-line")).not.toBeNull();
    for (const text of [overview.program, overview.id, overview.name, ...Object.values(overview.card).flat()]) expect(screen.queryByText(text)).toBeNull();
    expect(screen.queryByRole("meter")).toBeNull();
    expect(app.calls.some((call) => call.method === "agent.spawnPrompt")).toBe(false);
  });
});
