import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { agent, event, info, node } from "../testing/nodes";
import { callsTo, mountPane } from "./paneHarness";

afterEach(cleanup);

const overview = { program: "Claude Code", id: "opaque-session", name: "Recipe notebook", used: 84000, limit: 200000,
  // oxlint-disable-next-line anti-slop/no-shape-in-symbol-names -- A2681c contract field.
  card: { intent: "Collect recipes", shape: "Local notebook", facts: ["Stored on disk"], outcome: "Recipes saved" } };

describe("U83 closed Agent overview", () => {
  it("u83_a_closed_agent_shows_available_parts_without_a_terminal_or_a_drawer", async () => {
    const { connected, app, emulators, container } = await mountPane([agent("a", "done", "finished", {
      terminal_id: null, overview, work: { kind: "work", ask: "Keep family recipes", done: "Notebook opens", limits: ["Keep it local"] },
    })]);

    app.handlers["agent.spawnPrompt"] = () => ({ prompt: "Use a single file" });

    connected.rail.select("a");

    for (const text of [overview.program, overview.id, overview.name, overview.card.intent, overview.card.shape, overview.card.facts[0]!, overview.card.outcome,
      "Keep family recipes", "Notebook opens", "Keep it local"]) {
      expect((await screen.findAllByText(text)).length).toBeGreaterThan(0);
    }

    expect(screen.getByRole("meter").getAttribute("aria-valuenow")).toBe("84000");

    expect(screen.getByRole("meter").getAttribute("aria-valuemax")).toBe("200000");

    const range = document.createRange();
    range.selectNodeContents(screen.getByRole("button", { name: "Copy session id" }));
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

    app.handlers["agent.spawnPrompt"] = ({ id }) => id === "a" ? { prompt: "First session prompt" } : new Promise(() => {});

    connected.rail.select("a");
    await screen.findByRole("button", { name: "Copy session id" });

    connected.rail.select("b");
    await waitFor(() => expect(screen.getByRole("button", { name: "Copy session id" }).textContent).toBe("other-session"));
    expect(screen.queryAllByText(overview.id)).toHaveLength(0);
    expect(screen.queryByText(overview.name)).toBeNull();
    expect(screen.queryAllByRole("heading")).toHaveLength(0);

    for (const text of Object.values(overview.card).flat()) expect(screen.queryByText(text)).toBeNull();
    expect(screen.queryByRole("meter")).toBeNull();
  });

  it.each(["t-a", null])("u83_a_running_agent_keeps_its_order_line_and_hides_overview_data (%s)", async (terminalId) => {
    const { connected, app } = await mountPane([node("a", { terminal_id: terminalId, overview, work: { kind: "clarification", question: "Which recipes?" } })], terminalId === null ? [] : [info("t-a")]);

    connected.rail.select("a");
    expect(document.querySelector(".order-line")).not.toBeNull();

    for (const text of [overview.program, overview.id, overview.name, ...Object.values(overview.card).flat()]) expect(screen.queryByText(text)).toBeNull();
    expect(screen.queryByRole("meter")).toBeNull();
    expect(app.calls.some((call) => call.method === "agent.spawnPrompt")).toBe(false);
  });

  it("u83_a_live_exit_reveals_the_clarification_even_when_the_prompt_read_fails", async () => {
    const { connected, app } = await mountPane([node("a", { work: { kind: "clarification", question: "Which recipes?" } })], [info("t-a")]);

    app.handlers["agent.spawnPrompt"] = () => { throw new Error("Prompt read failed"); };

    connected.rail.select("a");
    app.emit(event({ name: "terminal.exited", data: { id: "t-a", code: 0 } }));

    expect(await screen.findByText("Which recipes?")).toBeTruthy();
    expect(await screen.findByText("Prompt read failed")).toBeTruthy();
    expect(document.querySelector(".order-line")).toBeNull();
  });

  describe("O17 the session id copies", () => {
    const setup = async (write: (text: string) => Promise<void>) => {
      Object.defineProperty(navigator, "clipboard", { value: { writeText: write }, configurable: true });
      const { connected } = await mountPane([agent("a", "done", "finished", { terminal_id: null, overview })]);
      connected.rail.select("a");

      return await screen.findByRole("button", { name: "Copy session id" });
    };

    it("o17_clicking_the_session_id_copies_it", async () => {
      const written: string[] = [];
      const button = await setup(async (text) => { written.push(text); });
      fireEvent.click(button);
      await waitFor(() => expect(button.textContent).toBe("Copied"));
      expect(written).toEqual([overview.id]);
      await waitFor(() => expect(button.textContent).toBe(overview.id), { timeout: 2500 });
    });

    it("o17_enter_on_the_session_id_copies_it", async () => {
      const written: string[] = [];
      const button = await setup(async (text) => { written.push(text); });
      // A native button turns Enter into a click; jsdom does not, so the test pins the element.
      button.focus();
      expect(document.activeElement).toBe(button);
      expect(button.tagName).toBe("BUTTON");
      expect(button.getAttribute("type")).toBe("button");
      fireEvent.click(button);
      await waitFor(() => expect(written).toEqual([overview.id]));
    });

    it("o17_a_refused_copy_says_so", async () => {
      const button = await setup(async () => { throw new Error("denied"); });
      fireEvent.click(button);
      await waitFor(() => expect(button.textContent).toBe("Copy failed"));
      await waitFor(() => expect(button.textContent).toBe(overview.id), { timeout: 2500 });
    });
  });
});
