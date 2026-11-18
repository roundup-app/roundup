import { cleanup, fireEvent, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { agent, workstream } from "../testing/nodes";
import { cases, target } from "../shelf/u3789RowsHarness";
import { itemOf, mountRail } from "./railFixture";
import { copy } from "./copy";

afterEach(cleanup);

const SLOTS = ["restart", "run", "more", "todos", "changes"];

const slotsOf = (row: HTMLElement) => [...row.querySelectorAll<HTMLElement>(".action-slot")].map(slot => slot.dataset.slot);

it("u7488a_each_action_renders_in_its_own_slot", async () => {
  await mountRail([
    agent("a", "working", "go", { name: "alpha", order: 0 }),
    agent("b", "done", "ok", { name: "beta", order: 1 }),
  ]);
  const row = itemOf("alpha");

  for (const name of SLOTS) expect(row.querySelectorAll(`.action-slot[data-slot="${name}"]`)).toHaveLength(1);

  expect(row.querySelector(`button[aria-label="${copy.stop}"]`)?.parentElement?.dataset.slot).toBe("run");

  // A slot with no action stays in the row, empty.
  for (const slot of row.querySelectorAll<HTMLElement>('.action-slot[data-slot="todos"], .action-slot[data-slot="changes"]')) expect(slot.children).toHaveLength(0);
});

it("u7488a_slots_keep_one_order", async () => {
  await mountRail([workstream("w", { name: "ws" }), agent("a", "working", "go", { name: "alpha" })]);

  for (const name of ["alpha"]) expect(slotsOf(itemOf(name))).toEqual(SLOTS);
});

it("u7488b_hover_focus_and_selection_share_one_reveal", async () => {
  for (const kind of cases) {
    const { row, view } = await target(kind);
    const root = row.closest<HTMLElement>(".rail-row, .shelf-row");

    if (root === null) throw new Error("no row");


    expect(root.dataset.reveal).toBeUndefined();
    fireEvent.pointerEnter(root);
    await waitFor(() => expect(root.dataset.reveal).toBe("shown"));
    fireEvent.pointerLeave(root);
    await waitFor(() => expect(root.dataset.reveal).toBeUndefined());
    fireEvent.focusIn(row);
    await waitFor(() => expect(root.dataset.reveal).toBe("shown"));
    fireEvent.focusOut(row, { relatedTarget: document.body });
    await waitFor(() => expect(root.dataset.reveal).toBeUndefined());
    fireEvent.click(row);
    await waitFor(() => expect(root.dataset.reveal).toBe("shown"));
    view.unmount();
    cleanup();
  }
});
