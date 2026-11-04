import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { agent, workstream, event } from "../testing/nodes";
import { mountRail, rowNames, rowOf, settled } from "./railFixture";

afterEach(() => { cleanup(); localStorage.clear(); });

it("u5531b_visibility_projects_one_membership_in_rail_order", async () => {
  const children = [
    agent("internal-last", "working", "working", { parent: "stream", order: 3, visibility: "internal" }),
    agent("idle", "done", "done", { parent: "stream", order: 1, final_text: { attempt: "1", turn: "1", finished: "0", kind: "empty" } }),
    agent("shown", "working", "working", { parent: "stream", order: 2 }),
    agent("internal-first", "working", "working", { parent: "stream", order: 0, visibility: "internal" }),
  ];

  const { app } = await mountRail([workstream("stream"), ...children]);
  await waitFor(() => expect(rowNames()).toEqual(["stream", "shown"]));
  const branch = screen.getByRole("treeitem", { name: / internal$/ });
  expect(branch.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(branch.querySelector("[data-part=branch-control]")!);
  await waitFor(() => expect(rowNames()).toEqual(["stream", "shown", "internal-first", "internal-last"]));
  fireEvent.click(screen.getByRole("treeitem", { name: /idle/ }).querySelector("[data-part=branch-control]")!);
  await waitFor(() => expect(rowNames()).toEqual(["stream", "shown", "internal-first", "internal-last", "idle"]));
  app.handlers["rail.tree"] = () => [workstream("stream"), ...children.map(child => ({ ...child, visibility: "shown" as const }))];
  app.emit(event({ name: "rail.changed" }));
  await waitFor(() => expect(rowNames()).toEqual(["stream", "internal-first", "shown", "internal-last", "idle"]));
  expect(screen.queryByRole("treeitem", { name: / internal$/ })).toBeNull();
  await settled();
});

it("u5531b_open_choices_survive_updates_independently", async () => {
  const child = agent("helper", "working", "working", { parent: "stream", visibility: "internal" });
  const nodes = [workstream("stream"), child, agent("settled", "done", "done", { parent: "stream", final_text: { attempt: "1", turn: "1", finished: "0", kind: "empty" } }), workstream("other"), agent("peer", "working", "working", { parent: "other", visibility: "internal" })];
  const { app, rail } = await mountRail(structuredClone(nodes));
  const branch = () => document.querySelector('[data-id="fold:internal:stream"]')!;
  await waitFor(() => expect(branch()).not.toBeNull());
  fireEvent.click(branch().querySelector("[data-part=branch-control]")!);
  await waitFor(() => expect(rowNames()).toContain("helper"));
  expect(rowNames()).not.toContain("settled");
  expect(rowNames()).not.toContain("peer");
  rail.toggleCollapsed("stream");
  await waitFor(() => expect(branch()).toBeNull());
  rail.toggleCollapsed("stream");
  await waitFor(() => expect(branch()).not.toBeNull());
  expect(rowNames()).toContain("helper");
  app.handlers["rail.tree"] = () => structuredClone(nodes).map(node => node.id === "helper" ? { ...node, visibility: "shown" as const } : node);
  app.emit(event({ name: "rail.changed" }));
  await waitFor(() => expect(branch()).toBeNull());
  app.handlers["rail.tree"] = () => structuredClone(nodes);
  app.emit(event({ name: "rail.changed" }));
  await waitFor(() => expect(branch()?.getAttribute("aria-expanded")).toBe("true"));
  expect(rowNames()).toContain("helper");
  fireEvent.click(branch().querySelector("[data-part=branch-control]")!);
  await waitFor(() => expect(rowNames()).not.toContain("helper"));
});

it.each(["internal", "idle"] as const)("u5531b_disappearing_focused_branch_returns_to_its_workstream %s", async group => {
  const children = [
    agent("helper", "working", "working", { parent: "stream", visibility: "internal" }),
    agent("settled", "done", "done", { parent: "stream", final_text: { attempt: "1", turn: "1", finished: "0", kind: "empty" } }),
  ];

  const { app } = await mountRail([workstream("stream"), ...children]);
  const key = group === "internal" ? "fold:internal:stream" : "fold:stream";
  const branch = () => document.querySelector<HTMLElement>(`[data-id="${key}"] [data-part=branch-control]`);
  await waitFor(() => expect(branch()).not.toBeNull());
  branch()!.focus();
  await waitFor(() => expect(document.activeElement).toBe(branch()));
  app.handlers["rail.tree"] = () => [workstream("stream"), ...children.map(child => child.id === (group === "internal" ? "helper" : "settled")
    ? agent(child.id, "working", "working", { parent: "stream" }) : child)];
  app.emit(event({ name: "rail.changed" }));
  await waitFor(() => expect(document.activeElement).toBe(rowOf("stream")));
});

it.each(["needs-you", "error"] as const)("u5531c_attention_promotes_internal_children_without_a_timer %s", async kind => {
  const child = agent("helper", "working", "working", { parent: "stream", visibility: "internal" });
  const { app, rail } = await mountRail([workstream("stream"), child]);
  await waitFor(() => expect(rowNames()).toEqual(["stream"]));
  app.handlers["rail.tree"] = () => [workstream("stream"), agent("helper", kind, kind, { parent: "stream", visibility: "shown" })];
  app.emit(event({ name: "rail.changed" }));
  await waitFor(() => expect(rowNames()).toEqual(["stream", "helper"]));
  expect(rail.nodes.find(node => node.id === "helper")?.visibility).toBe("shown");
  expect(screen.queryByRole("treeitem", { name: / internal$/ })).toBeNull();
  expect(screen.queryByRole("treeitem", { name: / idle$/ })).toBeNull();
});

it.each(["absent", "unknown", "present"] as const)("u5940a_settled_internal_children_stay_internal %s", async text => {
  const final_text = text === "absent" ? {} : { final_text: { attempt: "1", turn: "1", finished: "0", kind: text } };
  await mountRail([workstream("stream"),
    agent("done", "done", "done", { parent: "stream", visibility: "internal", ...final_text }),
    agent("idle", "idle", "idle", { parent: "stream", visibility: "internal", status: { kind: "idle", label: "idle", since: 0, finished: "0" }, ...final_text }),
  ]);
  await settled();
  expect(rowNames()).toEqual(["stream"]);
  expect(screen.queryByRole("treeitem", { name: /idle$/ })).toBeNull();
  fireEvent.click(screen.getByRole("treeitem", { name: / internal$/ }).querySelector("[data-part=branch-control]")!);
  await waitFor(() => expect(rowNames()).toEqual(["stream", "done", "idle"]));
});

it("u5531b_direct_message_terminal_and_draft_keep_the_child_identity", async () => {
  const { info } = await import("../testing/nodes");
  const { fakeEmulators } = await import("../terminal/paneHarness");
  const { message } = await import("../testing/centreFixture");
  const { railCallsTo } = await import("./railFixture");
  const child = agent("helper", "working", "working", { parent: "stream", visibility: "internal" });
  const m = await mountRail([workstream("stream"), child], [info("t-helper")], undefined, undefined, { pane: fakeEmulators().factory });
  fireEvent.click(screen.getByRole("treeitem", { name: / internal$/ }).querySelector("[data-part=branch-control]")!);
  await waitFor(() => expect(rowNames()).toContain("helper"));
  fireEvent.click(rowOf("helper"));
  await waitFor(() => expect(m.rail.selected()).toBe("helper"));
  fireEvent.keyDown(rowOf("helper"), { key: "Enter" });
  await waitFor(() => expect(document.querySelector('[data-terminal="t-helper"]')).not.toBeNull());
  const { notesFor } = await import("../changes/notes");
  const { COMPARISON } = await import("../changes/noteHarness");
  const notes = notesFor(m.app, m.connected.project.path, m.connected.drafts);
  await notes.save("helper", { comparison: COMPARISON, side: "new", start: 1, end: 1, source: "after", text: " exact\n😀 " });

  for (const visibility of ["shown", "internal"] as const) {
    m.app.handlers["rail.tree"] = () => [workstream("stream"), { ...child, visibility }];
    m.app.emit(event({ name: "rail.changed" }));
    await m.rail.settled();
    expect(m.rail.selected()).toBe("helper");
    expect(notes.list("helper").map(note => note.text)).toEqual([" exact\n😀 "]);
    expect(railCallsTo(m.app, "message.send")).toEqual([]);
  }

  m.app.handlers["message.send"] = params => message(1, { to: params.to, body: params.body });
  await notes.send("helper");
  expect(notes.list("helper")).toEqual([]);
  expect(railCallsTo(m.app, "message.send")).toEqual([{ to: "helper", body: expect.any(String), kind: "note", replyTo: null }]);
  // SAFETY: the preceding contract assertion verifies a single send with a string body.
  const sent = railCallsTo(m.app, "message.send")[0] as { body: string };
  expect(JSON.parse(sent.body).notes[0]["User comment:"]).toBe(" exact\n😀 ");
  expect(m.app.calls.filter(call => ["agent.stop", "agent.resume", "agent.spawn", "terminal.write"].includes(call.method))).toEqual([]);
});
