import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { mountRail, settled } from "./railFixture";
import { attentionCount, attentionHolders, attentionCounts } from "./attention";
import { agent, event, info } from "../testing/nodes";
import { renderTabs, path, tab } from "../header/stripFixture";
import { copy as headerCopy } from "../header/copy";
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
    const terminals = [info("owned", { status: blocked }), info("w", { status: { ...blocked, kind: "working" } }), info("free", { status: blocked })];
    const { needsYou, error } = attentionCounts(attentionHolders(nodes, terminals, dismissed));

    // the free blocked Terminal adds one entry; the owned one reaches the count as its Agent's Kind
    expect(needsYou + error).toBe(attentionCount(nodes, dismissed) + 1);
  });

  it("ps12_the_tab_tooltip_counts_a_free_blocked_terminal", async () => {
    const { app } = renderTabs({ api: [agent("a", "working", "x")], web: [] });

    app.of(path("api")).handlers["terminal.list"] = () => [info("free", { status: blocked })];
    await waitFor(() => expect(tab("api").getAttribute("aria-busy")).toBe("false"), { timeout: 3000 });
    await settled();
    app.of(path("api")).emit(event({ name: "terminal.changed" }));
    await settled();
    await settled();

    fireEvent.pointerOver(tab("api"), { pointerType: "mouse" });

    await waitFor(() => expect(screen.getByRole("tooltip").textContent).toContain(headerCopy.needYouError(1, 0)));
  });

  it("ps12_a_terminal_tab_shows_its_status_label_and_age_on_focus", async () => {
    await mountBubbles("a", [{ ...TERMINALS[0]!, status: { kind: "needs-you", label: "Allow?", since: Date.now(), finished: "0" } }, ...TERMINALS.slice(1)], TREE);
    const tab = document.querySelector<HTMLElement>('.terminal-tab[data-bubble="1"]')!;

    fireEvent.keyDown(document.body, { key: "Tab" });
    tab.focus();

    expect((await screen.findByRole("tooltip")).textContent).toMatch(/Allow\? · /);
  });
});
