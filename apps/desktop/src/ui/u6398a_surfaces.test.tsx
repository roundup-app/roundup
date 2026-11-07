import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { agent, node, USER, workstream } from "../testing/nodes";
import { openShelf, padOf } from "../pads/padsFixture";
import { mountRail } from "../rail/railFixture";
import { mountTodos, todo } from "../todos/testHarness";
import { foldMotion } from "./fold";
import type { FoldEngine } from "./fold";

const engine = { animateLayout: vi.fn<FoldEngine["animateLayout"]>(), animate: vi.fn<FoldEngine["animate"]>() };

let stop = () => {};

beforeEach(() => {
  engine.animateLayout.mockReset().mockImplementation((_scope, update) => update().then(() => ({ finished: new Promise<void>(() => {}) })));
  engine.animate.mockReset();
  stop = foldMotion(document, () => false, engine);
});

afterEach(() => { stop(); cleanup(); localStorage.clear(); });

it("u6398a_a_pointer_press_on_the_rail_section_head_and_workstream_chevron_starts_one_projection_each", async () => {
  await mountRail([node("root", { order: 0 }), workstream("mode", { order: 1 }), node("mode-child", { parent: "mode" })]);

  for (const selector of [".rail-chevron", ".rail-tree .section-head"]) {
    engine.animateLayout.mockClear();
    fireEvent.click(document.querySelector(selector)!, { detail: 1 });
    expect(engine.animateLayout).toHaveBeenCalledOnce();
  }
});

it("u6398a_a_pointer_press_on_the_todos_done_fold_starts_one_projection", async () => {
  await mountTodos([todo(1, { done: true, title: "old one" }), todo(2)]);
  fireEvent.click(await screen.findByRole("button", { name: "1 done" }), { detail: 1 });
  expect(engine.animateLayout).toHaveBeenCalledOnce();
  expect(screen.getByText(/old one/)).toBeTruthy();
});

it("u6398a_a_pointer_press_on_the_idle_fold_starts_one_projection", async () => {
  await mountRail([workstream("stream"), agent("parent", "done", "done", { parent: "stream", final_text: { attempt: "1", turn: "1", finished: "0", kind: "empty" } })]);
  await waitFor(() => expect(document.querySelector(".rail-fold")).not.toBeNull());
  fireEvent.click(document.querySelector(".rail-fold")!, { detail: 1 });
  expect(engine.animateLayout).toHaveBeenCalledOnce();
});

it("u6398a_a_pointer_press_on_a_shelf_owner_group_starts_one_projection", async () => {
  await openShelf([{ ...padOf("alpha", USER), home: "w1" }]);
  const control = await waitFor(() => document.querySelector<HTMLElement>(".pads-tab .shelf-group-control")!);
  fireEvent.click(control, { detail: 1 });
  expect(engine.animateLayout).toHaveBeenCalledOnce();
});
