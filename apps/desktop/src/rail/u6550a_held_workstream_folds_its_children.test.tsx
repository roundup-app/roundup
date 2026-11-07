import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { agent, workstream } from "../testing/nodes";
import { mountRail, settled } from "./railFixture";

// jsdom has no Web Animations: the library asks the document for its running ones when a drag starts.
Object.assign(document, { getAnimations: () => [] });
Object.assign(window, { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) });
Object.assign(Element.prototype, { getAnimations: () => [], animate: () => ({ cancel() {}, finished: Promise.resolve(), addEventListener() {} }) });

afterEach(() => { cleanup(); localStorage.clear(); });

const tree = () => [
  workstream("W0", { order: 0 }),
  ...["A0", "A1", "A2"].map((id, order) => agent(id, "working", "live", { parent: "W0", order })),
  workstream("W1", { order: 1 }),
  workstream("W2", { order: 2 }),
];

const lift = async (name: string) => {
  const handle = await screen.findByRole("button", { name: `Move ${name}` });
  handle.focus();
  fireEvent.keyDown(handle, { key: " ", code: "Space" });
  await settled();

  return handle;
};

const ids = () => [...document.querySelectorAll<HTMLElement>(".rail-row[data-id]:not([data-dnd-placeholder])")].map(row => row.dataset.id);

it("u6550a_held_workstream_folds_its_children", async () => {
  const nodes = tree();
  const m = await mountRail(nodes);
  await settled();
  const moves: unknown[] = [];

  m.app.handlers["rail.move"] = params => { moves.push(params);

 return null; };
  expect(ids()).toEqual(["W0", "A0", "A1", "A2", "W1", "W2"]);

  // Held: the count shows on the Door and the children leave the list; Escape puts them back in place.
  const handle = await lift("W0");
  expect(screen.getByRole("img", { name: "3 rows move with it" }).textContent).toBe("+3");
  expect(ids()).toEqual(["W0", "W1", "W2"]);
  fireEvent.keyDown(handle, { key: "Escape", code: "Escape" });
  await waitFor(() => expect(ids()).toEqual(["W0", "A0", "A1", "A2", "W1", "W2"]));
  expect(screen.queryByRole("img", { name: /rows move with it/ })).toBeNull();

  // A drop where it was lifted ends the hold: the children are under the Door again and no move was sent.
  const dropped = await lift("W0");
  expect(ids()).toEqual(["W0", "W1", "W2"]);
  fireEvent.keyDown(dropped, { key: " ", code: "Space" });
  await waitFor(() => expect(ids()).toEqual(["W0", "A0", "A1", "A2", "W1", "W2"]));
  expect(screen.queryByRole("img", { name: /rows move with it/ })).toBeNull();
  expect(moves).toEqual([]);
});

it("u6550a_a_held_row_without_children_has_no_count", async () => {
  await mountRail(tree());
  await settled();
  await lift("W1");
  expect(screen.queryByRole("img", { name: /rows move with it/ })).toBeNull();
});
