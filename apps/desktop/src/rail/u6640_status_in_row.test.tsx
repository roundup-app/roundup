import { cleanup, fireEvent, screen } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { agent } from "../testing/nodes";
import { copy } from "../ink/copy";
import { mountRail } from "./railFixture";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const KINDS = ["blocked", "needs-you", "working", "error"] as const;
const since = () => ({ since: Date.now() - 15 * 60_000, finished: "0" });

it("u6640a_a_rail_row_holds_its_status_and_its_mark_has_no_tooltip", async () => {
  const nodes = KINDS.map((kind, order) => agent(kind, kind, `${kind} label`, { name: kind, order, status: { kind, label: `${kind} label`, ...since() } }));

  await mountRail(nodes);

  for (const kind of KINDS) {
    const row = document.querySelector<HTMLElement>(`.rail-row[data-id="${kind}"]`)!;
    const mark = row.querySelector<HTMLElement>(".row-state")!;

    expect(row.querySelector(".row-status")!.textContent).toBe(copy.statusReveal(`${kind} label`, copy.statusAge.minutes(15)));
    fireEvent.pointerMove(mark, { pointerType: "mouse" });
    fireEvent.focusIn(mark);
    row.focus();
    await new Promise((done) => setTimeout(done, 250));
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(row.closest("[role=treeitem]")!.getAttribute("aria-label")).toContain(`${kind} label`);
  }
});

it("u6640b_a_long_status_is_one_cut_line", async () => {
  const label = "Which of the three migration strategies should I take for the payments tables? ".repeat(3).trim();

  await mountRail([agent("a", "needs-you", label, { name: "alpha", status: { kind: "needs-you", label, ...since() } })]);
  const status = document.querySelector<HTMLElement>(".rail-row[data-id='a'] .row-status")!;

  expect(status.textContent).toContain(label);
  expect(status.hasAttribute("title")).toBe(false);
});
