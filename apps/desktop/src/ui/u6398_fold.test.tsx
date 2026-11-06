import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createSignal } from "solid-js";

const engine = { animateLayout: vi.fn<FoldEngine["animateLayout"]>(), animate: vi.fn<FoldEngine["animate"]>() };

import { Disclosure } from "./Disclosure";
import { TreeView } from "./TreeView";
import { foldMotion } from "./fold";
import type { FoldEngine } from "./fold";

let stop = () => {};

const install = (reduced = false) => { stop = foldMotion(document, () => reduced, engine); };

beforeEach(() => {
  engine.animateLayout.mockReset().mockImplementation((_scope, update) => update().then(() => ({ finished: new Promise<void>(() => {}) })));
  engine.animate.mockReset();
});

afterEach(() => { stop(); cleanup(); });

const surfaces = () => (
  <>
    <Disclosure label="More"><p>more row</p></Disclosure>
    <TreeView.Root collection={tree}>
      <TreeView.Tree>
        <TreeView.NodeProvider node={tree.at([0])!} indexPath={[0]}><TreeView.Branch>
          <TreeView.BranchControl>Group</TreeView.BranchControl>
          <TreeView.BranchContent><TreeView.NodeProvider node={tree.at([0, 0])!} indexPath={[0, 0]}><TreeView.Item>leaf</TreeView.Item></TreeView.NodeProvider></TreeView.BranchContent>
        </TreeView.Branch></TreeView.NodeProvider>
      </TreeView.Tree>
    </TreeView.Root>
    {(() => {
      const [open, setOpen] = createSignal(false);

      return <button type="button" aria-expanded={open()} onClick={() => setOpen(!open())}>Plain</button>;
    })()}
  </>
);

import { createTreeCollection } from "@ark-ui/solid/tree-view";

const tree = createTreeCollection({ rootNode: { id: "root", name: "", children: [{ id: "a", name: "a", children: [{ id: "b", name: "b" }] }] } });

it("u6398a_a_pointer_press_on_a_fold_starts_one_projection_through_the_fold_helper", async () => {
  install();
  render(surfaces);

  for (const name of ["More", "Group", "Plain"]) {
    engine.animateLayout.mockClear();
    fireEvent.click(screen.getByRole("button", { name }), { detail: 1 });
    expect(engine.animateLayout, name).toHaveBeenCalledOnce();
  }
});

it("u6398b_a_second_press_retargets_the_running_projection", async () => {
  install();
  engine.animateLayout.mockImplementation(() => new Promise<{ finished: Promise<void> }>(() => {}));
  render(surfaces);
  const plain = screen.getByRole("button", { name: "Plain" });
  fireEvent.click(plain, { detail: 1 });
  fireEvent.click(plain, { detail: 1 });
  const [first, second] = engine.animateLayout.mock.calls;
  expect(second?.[0]).toBe(first?.[0]);
  expect(engine.animate).not.toHaveBeenCalled();
});

it("u6398c_a_keyboard_fold_starts_no_projection_and_reduced_motion_fades_only", async () => {
  install();
  render(surfaces);
  fireEvent.click(screen.getByRole("button", { name: "Plain" }), { detail: 0 });
  expect(engine.animateLayout).not.toHaveBeenCalled();
  expect(engine.animate).not.toHaveBeenCalled();
  stop(); install(true);
  fireEvent.click(screen.getByRole("button", { name: "More" }), { detail: 1 });
  await new Promise(resolve => setTimeout(resolve, 80));
  expect(engine.animateLayout).not.toHaveBeenCalled();

  for (const [, keyframes] of engine.animate.mock.calls) expect(Object.keys(keyframes)).toEqual(["opacity"]);
  expect(engine.animate).toHaveBeenCalled();
});
