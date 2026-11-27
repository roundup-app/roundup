import { cleanup, fireEvent, screen } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { chooseAction, mountRail, rowOf, settled } from "./railFixture";
import { agent, doorOf, workstream } from "../testing/nodes";

afterEach(() => { cleanup(); localStorage.clear(); });

const turns = (app: { calls: { method: string }[] }) => app.calls.map(call => call.method).filter(method => /^(agent|terminal)\.(send|write|stop|restart)|^message\.(?!list$)/.test(method));

const dot = (name: string) => rowOf(name).querySelector<HTMLElement>(".row-mark");

const mustDot = (name: string): HTMLElement => {
  const found = dot(name);

  if (found === null) throw new Error(`no dot on ${name}`);

  return found;
};

it("u7915a_clicking_the_needs_you_dot_marks_it_done", async () => {
  await mountRail([agent("a", "needs-you", "stays your call"), agent("b", "working", "x")]);

  expect(dot("b")).toBeNull();
  fireEvent.pointerEnter(mustDot("a"), { pointerType: "mouse", clientX: 0, clientY: 0 });
  await screen.findByRole("tooltip");
  fireEvent.click(mustDot("a"));
  await settled();

  expect(rowOf("a").getAttribute("data-kind")).toBe("idle");
  expect(dot("a")).toBeNull();
});

it("u7915a_the_click_selects_nothing_and_sends_nothing", async () => {
  const { app, rail } = await mountRail([agent("a", "needs-you", "stays your call")]);

  fireEvent.click(mustDot("a"));
  await settled();

  expect(rail.selected()).toBeNull();
  expect(turns(app)).toEqual([]);
});

it("u7915b_the_fold_arrow_still_folds_an_amber_row", async () => {
  await mountRail([workstream("g"), agent("a", "needs-you", "x", { parent: "g" })]);

  expect(dot("g")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Collapse" }));
  await settled();
  expect(rowOf("g").getAttribute("data-kind")).toBe("needs-you");
  await screen.findByRole("button", { name: "Expand" });
});

it("u7915b_mark_done_in_a_folded_rows_menu_clears_its_agents", async () => {
  const { app, rail } = await mountRail([workstream("g"), agent("a", "needs-you", "x", { parent: "g" }), agent("b", "needs-you", "x", { parent: "g" }), agent("c", "idle", "x", { parent: "g" })]);

  fireEvent.click(screen.getByRole("button", { name: "Collapse" }));
  await settled();
  await chooseAction(app, "g", "Mark done");
  await settled();

  expect(rowOf("g").getAttribute("data-kind")).toBe("idle");
  expect(rail.nodes.filter(node => rail.dismissed(node)).map(node => node.id).toSorted()).toEqual(["a", "b"]);
});

it("u7915c_the_menu_offers_mark_done_only_while_needs_you", async () => {
  const { app } = await mountRail([agent("a", "needs-you", "x"), agent("b", "working", "x"), agent("c", "error", "boom")]);

  fireEvent.contextMenu(rowOf("a"), { clientX: 1, clientY: 1 });
  expect(app.menuLabels()).toContain("Mark done");
  await app.closeMenu();
  fireEvent.contextMenu(rowOf("b"), { clientX: 1, clientY: 1 });
  expect(app.menuLabels()).not.toContain("Mark done");
  await app.closeMenu();
  fireEvent.contextMenu(rowOf("c"), { clientX: 1, clientY: 1 });
  expect(app.menuLabels()).not.toContain("Mark done");
  expect(app.menuLabels()).toContain("Dismiss error");
});

it("u7915c_a_native_prompt_stays_after_mark_done", async () => {
  const { app, rail } = await mountRail([agent("a", "needs-you", "Allow Bash?")]);

  await chooseAction(app, "a", "Mark done");
  await settled();

  expect(rowOf("a").getAttribute("data-kind")).toBe("idle");
  expect(doorOf(rail.nodes.find(node => node.id === "a"))?.status?.label).toBe("Allow Bash?");
  expect(turns(app)).toEqual([]);
});

const unstamped = { attempt: null, status_revision: null } as const;

it("u7915b_an_error_agent_with_a_null_status_revision_can_be_dismissed", async () => {
  const { app, rail } = await mountRail([agent("a", "error", "x", unstamped)]);

  await chooseAction(app, "a", "Dismiss error");
  await settled();

  expect(rail.nodes.every(node => rail.dismissed(node))).toBe(true);
  expect(rowOf("a").getAttribute("data-kind")).toBe("idle");
});

it("u7915b_a_null_revision_needs_you_marks_done_and_returns_on_a_new_status", async () => {
  const { app, rail } = await mountRail([agent("a", "needs-you", "x", unstamped)]);

  await chooseAction(app, "a", "Mark done");
  await settled();

  expect(rail.nodes.every(node => rail.dismissed(node))).toBe(true);
  expect(rail.dismissed(agent("a", "needs-you", "x", { ...unstamped, status: { kind: "needs-you", label: "x", since: 9, finished: "0" } }))).toBe(false);
});
