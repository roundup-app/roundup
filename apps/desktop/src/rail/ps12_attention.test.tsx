import { cleanup, fireEvent, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { mountRail } from "./railFixture";
import { attentionCount, attentionHolders, attentionCounts } from "./attention";
import { agent, event, info } from "../testing/nodes";
import { mountBubbles, TERMINALS, TREE } from "../bubbles/bubblesFixture";

afterEach(cleanup);

const blocked = { kind: "needs-you", label: "Allow?", since: 0, finished: "0" } as const;

describe("ps12 Terminals count toward attention", () => {
  it("ps12_a_blocked_terminal_counts_in_the_tab_and_the_dock_badge", async () => {
    const { app, rail } = await mountRail([agent("a", "working", "x")], [info("t", { status: blocked })]);

    expect(app.badges.at(-1)).toBe(1);
    expect(attentionCounts(attentionHolders(rail.nodes, rail.terminals()))).toEqual({ needsYou: 1, error: 0 });

    app.emit(event({ name: "terminal.status", data: { id: "t", status: null } }));
    await rail.settled();

    expect(app.badges.at(-1)).toBe(0);
  });

  it("ps12_counts_equal_the_attention_entries_for_agents_and_terminals", async () => {
    const nodes = [agent("a", "needs-you", "x"), agent("b", "error", "x"), agent("c", "working", "x"), agent("d", "error", "x", { terminal_id: "owned" })];
    const dismissed = (node: { id: string }) => node.id === "b";
    const terminals = [info("owned", { status: blocked }), info("w", { status: { ...blocked, kind: "working" } })];
    const { needsYou, error } = attentionCounts(attentionHolders(nodes, terminals, dismissed));

    expect(needsYou + error).toBe(attentionCount(nodes, dismissed));
  });

  it("ps12_a_terminal_tab_shows_its_status_label_and_age_on_focus", async () => {
    await mountBubbles("a", [{ ...TERMINALS[0]!, status: { kind: "needs-you", label: "Allow?", since: Date.now(), finished: "0" } }, ...TERMINALS.slice(1)], TREE);
    const tab = document.querySelector<HTMLElement>('.terminal-tab[data-bubble="1"]')!;

    fireEvent.keyDown(document.body, { key: "Tab" });
    tab.focus();

    expect((await screen.findByRole("tooltip")).textContent).toMatch(/Allow\? · /);
  });
});
