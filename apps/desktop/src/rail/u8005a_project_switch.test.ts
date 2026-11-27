import { createRoot, createSignal, flush } from "solid-js";
import { expect, it, vi } from "vitest";
import { createChangesFold } from "./slide";

it("u8005a_a_project_switch_keeps_the_new_projects_folded_rail_folded", () => {
  const [open, setOpen] = createSignal(false);
  const [project, setProject] = createSignal<string | null>("/a");
  const [collapsed, setCollapsed] = createSignal(false);
  const set = vi.fn((next: boolean) => { setCollapsed(next); });
  const frame = { open: () => false, fold: vi.fn(), toggle: vi.fn() };

  createRoot(() => {
    createChangesFold(open, { collapsed }, { set }, frame, () => "pointer", project);
  });

  setOpen(true);
  flush();
  expect(set).toHaveBeenLastCalledWith(true, "click", false);

  // The switch re-reads B's Rail, which the user had folded, then Changes closes.
  setProject("/b");
  setCollapsed(true);
  setOpen(false);
  flush();

  expect(set.mock.calls).toEqual([[true, "click", false]]);
});
