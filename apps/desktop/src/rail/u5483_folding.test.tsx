import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { agent, workstream, NOW, event } from "../testing/nodes";
import { mountRail, rowNames, rowOf, settled } from "./railFixture";

afterEach(cleanup);

const empty = { attempt: "1", turn: "1", finished: "1", kind: "empty" as const };

it("u5940a_settled_children_fold_without_final_text_protection", async () => {
  await mountRail([workstream("stream"),
    agent("done", "done", "Terminal closed", { parent: "stream" }),
    agent("idle", "idle", "idle", { parent: "stream", status: { kind: "idle", label: "idle", since: NOW - 60_000, finished: "1" }, final_text: { ...empty, kind: "present" } }),
    agent("busy", "working", "working", { parent: "stream" }),
  ]);
  await settled();
  expect(rowNames()).toEqual(["stream", "busy"]);
});

it.each(["absent", "unknown", "empty", "present"] as const)("u5940a_settled_children_fold_whatever_the_final_text %s", async text => {
  const final_text = text === "absent" ? {} : { final_text: { ...empty, finished: "0", kind: text } };

  const { setNow } = await mountRail([workstream("stream"),
    agent("done", "done", "finished", { parent: "stream", ...final_text }),
    agent("idle", "idle", "idle", { parent: "stream", status: { kind: "idle", label: "idle", since: NOW, finished: "0" }, ...final_text }),
    agent("busy", "working", "working", { parent: "stream" }),
  ]);

  await settled();
  expect(rowNames()).toEqual(["stream", "idle", "busy"]);
  setNow(NOW + 59_999);
  expect(rowNames()).toEqual(["stream", "idle", "busy"]);
  setNow(NOW + 60_000);
  await settled();
  expect(rowNames()).toEqual(["stream", "busy"]);
});

it("u5940a_collapsed_workstream_counts_only_children_in_progress", async () => {
  const { rail } = await mountRail([workstream("stream"),
    agent("done", "done", "finished", { parent: "stream" }),
    agent("busy", "working", "working", { parent: "stream" }),
  ]);

  rail.toggleCollapsed("stream");
  await waitFor(() => expect(screen.getAllByRole("img", { name: /^1 hidden/ })).toHaveLength(1));
});

it("u5940a_working_idle_one_minute_then_working_returns", async () => {
  const child = agent("child", "working", "working", { parent: "stream", final_text: empty });
  const { app, rail, setNow } = await mountRail([workstream("stream"), child, agent("busy", "working", "working", { parent: "stream", order: 1 })]);
  rail.select("child");
  const calls = app.calls.length;
  app.emit(event({ name: "agent.status", data: { id: "child", attempt: "1", status_revision: "2", status: { kind: "idle", label: "idle", since: NOW, finished: "1" } } }));
  setNow(NOW + 59_999);
  expect(rowNames()).toContain("child");
  setNow(NOW + 60_000);
  await settled();
  expect(rowNames()).toEqual(["stream", "child", "busy"]);
  rail.select("busy");
  await waitFor(() => expect(rowNames()).toEqual(["stream", "busy"]));
  app.emit(event({ name: "agent.status", data: { id: "child", attempt: "1", status_revision: "3", status: { kind: "working", label: "working", since: NOW + 60_000, finished: "1" } } }));
  expect(rowNames()).toEqual(["stream", "child", "busy"]);
  expect(rail.selected()).toBe("busy");
  expect(app.calls.slice(calls).filter(call => !["message.list", "pad.list", "todo.list"].includes(call.method))).toEqual([]);
});

it("u5483b_click_opens_and_closes_the_branch", async () => {
  await mountRail([workstream("stream"), agent("child", "done", "done", { parent: "stream", final_text: { ...empty, finished: "0" } })]);
  const branch = () => screen.getByRole("treeitem", { name: /idle/ });
  await waitFor(() => expect(branch().getAttribute("aria-expanded")).toBe("false"));
  fireEvent.click(branch().querySelector("[data-part=branch-control]")!);
  await settled();
  expect(rowNames()).toContain("child");
  fireEvent.click(branch().querySelector("[data-part=branch-control]")!);
  await settled();
  expect(rowNames()).not.toContain("child");
  await waitFor(() => expect(branch().getAttribute("aria-expanded")).toBe("false"));
  expect(rowOf("stream")).toBeDefined();
});

it("u5483b_opening_a_fold_preserves_agent_descendants", async () => {
  const { rail } = await mountRail([
    workstream("stream"),
    agent("parent", "done", "done", { parent: "stream", final_text: { ...empty, finished: "0" } }),
    agent("descendant", "working", "working", { parent: "parent" }),
  ]);

  await waitFor(() => expect(rowNames()).toEqual(["stream"]));
  fireEvent.click(document.querySelector('.rail-fold')!);
  await waitFor(() => expect(rowNames()).toEqual(["stream", "parent", "descendant"]));
  fireEvent.click(rowOf("descendant"));
  await settled();
  expect(rail.selected()).toBe("descendant");
});

it("u5483b_folding_an_ancestor_recovers_descendant_focus", async () => {
  const { app } = await mountRail([
    workstream("stream"),
    agent("parent", "working", "working", { parent: "stream", final_text: { ...empty, finished: "0" } }),
    agent("descendant", "working", "working", { parent: "parent" }),
  ]);

  rowOf("descendant").focus();
  await settled();
  app.emit(event({ name: "agent.status", data: { id: "parent", attempt: "1", status_revision: "2", status: { kind: "done", label: "finished", since: NOW, finished: "0" } } }));
  await waitFor(() => expect(document.activeElement).toBe(document.querySelector('[data-id="fold:stream"] [data-part="branch-control"]')));
});

it.each(["needs-you", "error", "blocked"] as const)("u5483b_attention_and_work_return_immediately %s", async kind => {
  const { app } = await mountRail([workstream("stream"), agent("child", "done", "finished", { parent: "stream", final_text: { ...empty, finished: "0" } })]);
  await waitFor(() => expect(rowNames()).not.toContain("child"));
  app.emit(event({ name: "agent.status", data: { id: "child", attempt: "1", status_revision: "2", status: { kind, label: kind, since: NOW, finished: "0" } } }));
  expect(rowNames()).toEqual(["stream", "child"]);
  expect(screen.queryByRole("treeitem", { name: /idle/ })).toBeNull();
});

it("u5483a_only_idle_or_done_workstream_children_fold", async () => {
  await mountRail([workstream("stream"), agent("root", "done", "finished", { final_text: { ...empty, finished: "0" } }), ...(["working", "needs-you", "error", "blocked"] as const).map(kind => agent(kind, kind, kind, { parent: "stream", final_text: { ...empty, finished: "0" } }))]);
  await settled();
  expect(rowNames()).toEqual(["stream", "working", "needs-you", "error", "blocked", "root"]);
});

it("u5483b_open_choice_survives_membership_changes", async () => {
  const child = agent("child", "done", "finished", { parent: "stream", final_text: { ...empty, finished: "0" } });
  const { app, rail } = await mountRail([workstream("stream"), child]);
  await waitFor(() => expect(screen.getByRole("treeitem", { name: /idle/ })).toBeDefined());
  fireEvent.click(document.querySelector('.rail-fold')!);
  await waitFor(() => expect(rowNames()).toContain("child"));
  rail.toggleCollapsed("stream");
  rail.toggleCollapsed("stream");
  expect(rowNames()).toContain("child");
  app.emit(event({ name: "agent.status", data: { id: "child", attempt: "1", status_revision: "2", status: { kind: "working", label: "working", since: NOW, finished: "0" } } }));
  app.emit(event({ name: "agent.status", data: { id: "child", attempt: "1", status_revision: "3", status: { kind: "done", label: "finished", since: NOW + 1, finished: "0" } } }));
  expect(rowNames()).toContain("child");
  expect(screen.getByRole("treeitem", { name: /idle/ }).getAttribute("aria-expanded")).toBe("true");
});


it("u5483a_idle_must_be_continuous", async () => {
  const { app, setNow } = await mountRail([workstream("stream"), agent("child", "idle", "idle", { parent: "stream", final_text: { ...empty, finished: "0" } })]);
  setNow(NOW + 59_999);
  app.emit(event({ name: "agent.status", data: { id: "child", attempt: "1", status_revision: "2", status: { kind: "blocked", label: "blocked", since: NOW + 59_999, finished: "0" } } }));
  app.emit(event({ name: "agent.status", data: { id: "child", attempt: "1", status_revision: "3", status: { kind: "idle", label: "idle", since: NOW + 60_000, finished: "0" } } }));
  setNow(NOW + 119_999);
  await settled();
  expect(rowNames()).toContain("child");
  app.emit(event({ name: "agent.status", data: { id: "child", attempt: "1", status_revision: "4", status: { kind: "idle", label: "renamed observation", since: NOW + 60_000, finished: "0" } } }));
  setNow(NOW + 120_000);
  expect(rowNames()).not.toContain("child");
});

it("u5483a_done_and_idle_share_one_branch", async () => {
  await mountRail([workstream("stream"), agent("done", "done", "finished", { parent: "stream", order: 0, final_text: { ...empty, finished: "0" } }), agent("idle", "idle", "idle", { parent: "stream", order: 1, status: { kind: "idle", label: "idle", since: NOW - 60_000, finished: "0" }, final_text: { ...empty, finished: "0" } }), agent("busy", "working", "working", { parent: "stream", order: 2 })]);
  await waitFor(() => expect(rowNames()).toEqual(["stream", "busy"]));
  expect(screen.getAllByRole("treeitem", { name: /idle/ })).toHaveLength(1);
  fireEvent.click(document.querySelector('.rail-fold')!);
  await waitFor(() => expect(rowNames()).toEqual(["stream", "busy", "done", "idle"]));
});

it("u5483a_workstreams_keep_separate_folds", async () => {
  await mountRail([workstream("first"), workstream("second", { order: 1 }), ...["first", "second"].map(parent => agent(`${parent}-child`, "done", "finished", { parent, final_text: { ...empty, finished: "0" } }))]);
  await waitFor(() => expect(screen.getAllByRole("treeitem", { name: /idle/ })).toHaveLength(2));
  fireEvent.click(document.querySelector('[data-id="fold:first"] [data-part="branch-control"]')!);
  await waitFor(() => expect(rowNames()).toContain("first-child"));
  expect(rowNames()).not.toContain("second-child");
});

const foldedStream = () => [workstream("stream"),
  agent("a", "done", "done", { parent: "stream" }),
  agent("b", "done", "done", { parent: "stream" }),
  agent("hidden", "idle", "idle", { parent: "stream", visibility: "internal" }),
  agent("busy", "working", "working", { parent: "stream" }),
];

const folds = () => [...document.querySelectorAll(".rail-fold-name")].map(fold => fold.textContent);

it.each(["a", "hidden"])("u6238a_closed_fold_lifts_out_the_selected_agent %s", async id => {
  const { rail } = await mountRail(foldedStream());
  await settled();
  expect(folds()).toEqual(["1 internal", "2 idle"]);
  rail.select(id);
  await settled();
  expect(rowNames()).toContain(id);
  expect(folds()).toEqual(id === "a" ? ["1 internal", "1 idle"] : ["2 idle"]);
  expect(rail.selected()).toBe(id);
});

it("u6238b_the_row_returns_when_selection_moves", async () => {
  const { rail } = await mountRail(foldedStream());
  await settled();
  rail.select("a");
  await settled();
  rail.select("busy");
  await settled();
  expect(rowNames()).toEqual(["stream", "busy"]);
  expect(folds()).toEqual(["1 internal", "2 idle"]);
  rail.select("a");
  await settled();
  fireEvent.click(document.querySelector('[data-id="fold:stream"] [data-part=branch-control]')!);
  await settled();
  expect(rowNames()).toEqual(["stream", "busy", "a", "b"]);
});
