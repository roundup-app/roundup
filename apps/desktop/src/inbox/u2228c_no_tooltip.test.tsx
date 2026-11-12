import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import type { RailNode } from "@contracts/agent/RailNode";
import { agent } from "../testing/nodes";
import { mountTodos } from "../todos/testHarness";
import { AskBar } from "../ask/AskBar";
import { ConnectedProjectContext } from "../state/connectedProject";

afterEach(cleanup);

const at = (kind: "needs-you" | "blocked" | "error", label: string) => ({ kind, label, since: Date.now() - 12 * 60_000, finished: "0" } as const);

const NODES: RailNode[] = [
  agent("a", "needs-you", "Waiting for approval", { name: "alpha", order: 0, status: at("needs-you", "Waiting for approval") }),
  agent("b", "blocked", "Needs a decision", { name: "beta", order: 1, status: at("blocked", "Needs a decision") }),
  agent("c", "error", "Quota used up", { name: "gamma", order: 2, status: at("error", "Quota used up") }),
];

it("u2228c_inbox_and_switcher_rows_open_no_tooltip", async () => {
  const m = await mountTodos([], true, structuredClone(NODES));

  render(() => <ConnectedProjectContext.Provider value={m.connected}><AskBar /></ConnectedProjectContext.Provider>);
  m.connected.showView(null);
  m.connected.showView("attention");
  await screen.findByRole("region", { name: "Needs you" });

  const heads = await waitFor(() => {
    const found = document.querySelectorAll<HTMLElement>(".inbox-row");

    expect(found.length).toBeGreaterThan(1);

    return found;
  });

  for (const head of heads) {
    fireEvent.pointerMove(head, { pointerType: "mouse" });
    head.focus();
  }

  await new Promise((done) => setTimeout(done, 600));
  expect(screen.queryByRole("tooltip")).toBeNull();
});
