import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { agent, workstream, event } from "../testing/nodes";
import { mountRail, rowNames, settled } from "./railFixture";

afterEach(cleanup);

it("u5531b_visibility_projects_one_membership_in_rail_order", async () => {
  const children = [
    agent("internal-last", "working", "working", { parent: "stream", order: 3, visibility: "internal" }),
    agent("idle", "done", "done", { parent: "stream", order: 1, final_text: { attempt: "1", turn: "1", finished: "0", kind: "empty" } }),
    agent("shown", "working", "working", { parent: "stream", order: 2 }),
    agent("internal-first", "working", "working", { parent: "stream", order: 0, visibility: "internal" }),
  ];

  const { app } = await mountRail([workstream("stream"), ...children]);
  await waitFor(() => expect(rowNames()).toEqual(["stream", "shown"]));
  const branch = screen.getByRole("treeitem", { name: /internal/ });
  expect(branch.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(branch.querySelector("[data-part=branch-control]")!);
  await waitFor(() => expect(rowNames()).toEqual(["stream", "shown", "internal-first", "internal-last"]));
  fireEvent.click(screen.getByRole("treeitem", { name: /idle/ }).querySelector("[data-part=branch-control]")!);
  await waitFor(() => expect(rowNames()).toEqual(["stream", "shown", "internal-first", "internal-last", "idle"]));
  app.handlers["rail.tree"] = () => [workstream("stream"), ...children.map(child => ({ ...child, visibility: "shown" as const }))];
  app.emit(event({ name: "rail.changed" }));
  await waitFor(() => expect(rowNames()).toEqual(["stream", "internal-first", "shown", "internal-last", "idle"]));
  expect(screen.queryByRole("treeitem", { name: /internal/ })).toBeNull();
  await settled();
});

it("u5531b_open_choices_survive_updates_independently", async () => {
  const child = agent("helper", "working", "working", { parent: "stream", visibility: "internal" });
  const nodes = [workstream("stream"), child, agent("settled", "done", "done", { parent: "stream", final_text: { attempt: "1", turn: "1", finished: "0", kind: "empty" } }), workstream("other"), agent("peer", "working", "working", { parent: "other", visibility: "internal" })];
  const { app, rail } = await mountRail(nodes);
  const branch = () => document.querySelector('[data-id="fold:internal:stream"]')!;
  await waitFor(() => expect(branch()).not.toBeNull());
  fireEvent.click(branch().querySelector("[data-part=branch-control]")!);
  await waitFor(() => expect(rowNames()).toContain("helper"));
  expect(rowNames()).not.toContain("settled");
  expect(rowNames()).not.toContain("peer");
  rail.toggleCollapsed("stream");
  rail.toggleCollapsed("stream");
  expect(rowNames()).toContain("helper");
  app.handlers["rail.tree"] = () => nodes.map(node => node.id === "helper" ? { ...node, visibility: "shown" as const } : node);
  app.emit(event({ name: "rail.changed" }));
  await waitFor(() => expect(branch()).toBeNull());
  app.handlers["rail.tree"] = () => nodes;
  app.emit(event({ name: "rail.changed" }));
  await waitFor(() => expect(branch()?.getAttribute("aria-expanded")).toBe("true"));
  expect(rowNames()).toContain("helper");
  fireEvent.click(branch().querySelector("[data-part=branch-control]")!);
  await waitFor(() => expect(rowNames()).not.toContain("helper"));
});

it.each(["needs-you", "error"] as const)("u5531c_attention_promotes_internal_children_without_a_timer %s", async kind => {
  const child = agent("helper", "working", "working", { parent: "stream", visibility: "internal" });
  const { app, rail } = await mountRail([workstream("stream"), child]);
  await waitFor(() => expect(rowNames()).toEqual(["stream"]));
  app.handlers["rail.tree"] = () => [workstream("stream"), { ...child, visibility: "shown", status: { ...child.status!, kind } }];
  app.emit(event({ name: "rail.changed" }));
  await waitFor(() => expect(rowNames()).toEqual(["stream", "helper"]));
  expect(rail.nodes.find(node => node.id === "helper")?.visibility).toBe("shown");
  expect(screen.queryByRole("treeitem", { name: /internal/ })).toBeNull();
});

it("u5531c_known_empty_settled_internal_child_stays_internal", async () => {
  await mountRail([workstream("stream"), agent("helper", "done", "done", { parent: "stream", visibility: "internal", final_text: { attempt: "1", turn: "1", finished: "0", kind: "empty" } })]);
  await settled();
  expect(rowNames()).toEqual(["stream"]);
  expect(screen.queryByRole("treeitem", { name: /idle/ })).toBeNull();
  fireEvent.click(screen.getByRole("treeitem", { name: /internal/ }).querySelector("[data-part=branch-control]")!);
  await waitFor(() => expect(rowNames()).toEqual(["stream", "helper"]));
});
