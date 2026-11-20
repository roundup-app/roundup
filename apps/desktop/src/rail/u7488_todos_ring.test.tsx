import { cleanup, render } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { PadsControl } from "./pads/AgentPads";
import { ConnectedProjectContext } from "../state/connectedProject";

afterEach(cleanup);

const noop = () => undefined;

// SAFETY: the control reads only `showPadsOf` from the connected project, which this stub holds.
const connected = { showPadsOf: noop } as never;

const find = (root: ParentNode, selector: string): HTMLElement => {
  const found = root.querySelector<HTMLElement>(selector);

  if (found === null) throw new Error(`missing ${selector}`);

  return found;
};

const ring = (done: number, total: number) => render(() => <ConnectedProjectContext value={connected}><div class="rail-row"><span class="row-state"><svg /></span><PadsControl todos={{ done, total }} agent="a" /></div></ConnectedProjectContext>).container;

it.each([[0, 3], [1, 3], [3, 3]])("u7488c_the_ring_fills_by_done_share: %i of %i", (done, total) => {
  const root = ring(done, total);
  const bar = find(root, ".todo-ring");

  expect(bar.getAttribute("aria-valuenow")).toBe(String(done));
  expect(bar.getAttribute("aria-valuemax")).toBe(String(total));
  expect(bar.style.getPropertyValue("--ring-ratio")).toBe(String(done / total));
  expect(find(root, "[data-pads-control]").textContent).toBe("");
});

it("u7488c_the_ring_is_not_the_status_glyph", () => {
  const root = ring(1, 3);

  expect(root.querySelector(".row-state .todo-ring")).toBeNull();
});

it("u7488c_no_todos_shows_no_ring", () => {
  const root = ring(0, 0);

  expect(root.querySelector(".todo-ring, [data-pads-control]")).toBeNull();
});

it("u7488c_the_ring_has_a_label_and_no_title", () => {
  const button = find(ring(1, 3), "[data-pads-control]");

  expect(button.getAttribute("aria-label")).toBe("1/3 Todos");
  expect(button.getAttribute("title")).toBe("");
});
