import { cleanup, fireEvent, screen } from "@solidjs/testing-library";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { node, workstream } from "../testing/nodes";
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
