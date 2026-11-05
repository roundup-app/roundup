import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { agent, door, workstream } from "../testing/nodes";
import { ConnectedProjectContext } from "../state/connectedProject";
import { mountRail } from "./railFixture";
import { copy } from "./copy";
import { RailStrip } from "./RailStrip";

afterEach(cleanup);

const TREE = [
  door("ship", "error", "failed", { workstream_state: "error", order: 0 }),
  agent("ship-a", "needs-you", "asks", { parent: "ship", order: 0 }),
  agent("ship-b", "error", "failed", { parent: "ship", order: 1 }),
  agent("ship-c", "working", "typing", { parent: "ship", order: 2 }),
  workstream("calm", { order: 1 }),
  agent("calm-a", "working", "typing", { parent: "calm", order: 0 }),
  agent("loose", "needs-you", "asks", { order: 2 }),
];

const mountBoth = async (tree = TREE) => {
  const mounted = await mountRail(tree);

  const expand = vi.fn();

  render(() => <ConnectedProjectContext.Provider value={mounted.connected}><RailStrip expand={expand} /></ConnectedProjectContext.Provider>);

  return { ...mounted, expand, strip: document.querySelector<HTMLElement>(".rail-strip")! };
};

const mark = (strip: HTMLElement, id: string) => strip.querySelector<HTMLElement>(`[role=treeitem][data-id="${id}"]`)!;

const railRow = (id: string) => document.querySelector<HTMLElement>(`.rail-row[data-id="${id}"]`)!;

it("u6228_a_mark_rolls_up_the_state_its_rail_row_shows", async () => {
  const { strip, rail } = await mountBoth();

  await waitFor(() => expect(strip.querySelectorAll("[role=treeitem][data-id]")).toHaveLength(2));

  // A folded Rail row is the one that rolls its Agents up; the strip marks are always folded.
  for (const id of ["ship", "calm"]) rail.toggleCollapsed(id);

  for (const id of ["ship", "calm"]) expect(mark(strip, id).dataset.kind, id).toBe(railRow(id).dataset.kind);

  // The worst state wins and the count rolls up from the Agents below.
  expect(mark(strip, "ship").dataset.kind).toBe("error");
  expect(mark(strip, "ship").getAttribute("aria-label")).toBe(copy.markName("ship", "Error", 3, false));
  expect(mark(strip, "calm").getAttribute("aria-label")).toBe(copy.markName("calm", "Working", 0, false));
});

it("u6228_what_needs_you_outside_a_workstream_reaches_the_overview_mark", async () => {
  const { strip } = await mountBoth();

  await waitFor(() => expect(strip.querySelector("[data-overview]")?.getAttribute("aria-label")).toBe(copy.overviewMark(4)));
});

it("u6228_a_mark_selects_its_door", async () => {
  const { strip, rail } = await mountBoth();

  fireEvent.click(await within(strip).findByRole("treeitem", { name: /^calm/ }));

  await waitFor(() => expect(rail.selected()).toBe("calm"));
  await waitFor(() => expect(mark(strip, "calm").getAttribute("aria-selected")).toBe("true"));
});

it("u6228_arrow_keys_walk_the_marks_by_name", async () => {
  const { strip } = await mountBoth();
  const first = await within(strip).findByRole("treeitem", { name: /^ship/ });

  first.focus();
  fireEvent.keyDown(first, { key: "ArrowDown" });

  await waitFor(() => expect(document.activeElement).toBe(mark(strip, "calm")));
});

it("u6228_the_expand_and_add_controls_stay_on_the_strip", async () => {
  const { strip, expand } = await mountBoth([]);

  expect(within(strip).queryAllByRole("treeitem")).toHaveLength(0);
  fireEvent.click(strip.querySelector(".rail-strip-expand")!);
  expect(expand).toHaveBeenCalledOnce();
  expect(strip.querySelector(".rail-strip-add")).not.toBeNull();
});
