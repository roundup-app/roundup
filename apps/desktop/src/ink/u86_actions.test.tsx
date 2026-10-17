import { cleanup, fireEvent, screen, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { workstream, USER } from "../testing/nodes";import { itemOf, mountRail, pinnedAdd } from "../rail/railFixture";import { openPad, openShelf, padOf, AGENT } from "../pads/padsFixture";
import { mountTodos, todo } from "../todos/testHarness";

afterEach(cleanup);

const vector = (element: Element, name: string) => {
  const svg = element.querySelector(`svg.lucide-${name}`);
  expect(svg).not.toBeNull();
  expect(svg?.getAttribute("aria-hidden")).toBe("true");
};

it("u86_disclosure_uses_vectors_and_preserves_expansion", async () => {
  await mountRail([workstream("topic")]);
  const button = screen.getByRole("button", { name: "Collapse" });
  vector(button, "chevron-down");
  fireEvent.click(button);
  vector(button, "chevron-right");
  expect(itemOf("topic").getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(button);
  expect(itemOf("topic").getAttribute("aria-expanded")).toBe("true");
});

it("u86_rail_add_actions_keep_their_names", async () => {
  const mounted = await mountRail([workstream("g")]);
  mounted.rail.select("g");

  vector(pinnedAdd(), "plus");

  vector(screen.getByLabelText("Add Agent"), "plus");
});

it("u86_todo_add_and_drawer_close_are_named_vector_actions", async () => {
  await mountTodos([todo(1)]);
  const add = screen.getByRole("button", { name: "Add Todo" });
  vector(add, "plus");
  fireEvent.click(add);
  expect(screen.getByRole("textbox", { name: "New Todo title" })).toBeTruthy();
  fireEvent.click(await screen.findByRole("button", { name: /todo 1/ }));
  const drawer = screen.getByLabelText("Drawer");
  vector(within(drawer).getByRole("button", { name: "Close" }), "x");
  vector(await within(drawer).findByRole("button", { name: "Blocker" }), "plus");
  expect(drawer.contains(document.activeElement)).toBe(true);
});

it("u86_pad_ownership_and_add_use_vectors_without_duplicate_drawer_names", async () => {
  await openShelf([padOf("notes", AGENT), padOf("draft", USER)]);
  vector(screen.getByRole("button", { name: "Add Pad" }), "plus");
  vector(screen.getByRole("button", { name: "Make notes yours" }), "diamond-plus");
  vector(screen.getByRole("img", { name: "User owned" }), "diamond");
  await openPad("notes");
  const drawer = screen.getByLabelText("Drawer");
  expect(within(drawer).queryByRole("img", { name: "Agent owned" })).toBeNull();
  vector(drawer, "diamond-plus");
});
