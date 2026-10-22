import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gate, mountApp, select } from "../decisions/decisionsFixture";
import { RpcError } from "../app/seam";
import type { Kind } from "@contracts/Kind";
import type { Order } from "@contracts/agent/Order";
import { connectProject, ConnectedProjectContext } from "../state/connectedProject";
import { createFakeApp } from "../testing/fakeApp";
import { DrawerHost } from "../drawer/DrawerHost";
import { OrderDrawer } from "./OrderDrawer";
import { agent, clarifying, door } from "../testing/nodes";

beforeEach(() => window.localStorage.clear());

afterEach(() => vi.restoreAllMocks());

const limits = ["Change no file", "Keep it short", "Ask before deleting", "Use no network"];

const prompt = `## Details\n\n${"Walk through each part of the screenshot. ".repeat(60)}\n\n- **bold** item`;

const KINDS: Kind[] = ["error", "needs-you", "blocked", "working", "idle", "done"];

export const openDrawer = async (
  order: Order,
  options: { kind?: Kind; handlers?: Record<string, (params: never) => object | null> } = {},
) => {
  await mountApp([], (app) => {
    app.handlers["rail.tree"] = () => [
      agent("a", options.kind ?? "working", "editing", { name: "alpha", order: 0, work: order }),
      agent("b", "working", "editing", { name: "beta", order: 1, work: clarifying("which?") }),
      door("r", "working", "editing", { name: "harbor", order: 2, work: clarifying("why?") }),
    ];
    app.handlers["agent.spawnPrompt"] = () => ({ prompt });
    Object.assign(app.handlers, options.handlers ?? {});
  });
  select("alpha");
  await waitFor(() => expect(document.querySelector(".order-line")).not.toBeNull());
  fireEvent.click(document.querySelector(".order-line")!);

  return await screen.findByLabelText("Full order of alpha");
};

const full: Order = {
  kind: "work",
  title: "Give a Drawer tour",
  ask: "Give a tour of the Drawer",
  done: "The tour is written",
  limits,
};

describe("O15: the Drawer shows a title, the done line and no prompt", () => {
  it("o15_the_title_leads_and_the_ask_follows", async () => {
    const drawer = await openDrawer(full);
    const title = drawer.querySelector(".order-title")!;
    const ask = drawer.querySelector(".order-ask")!;
    expect(title.textContent).toContain("Give a Drawer tour");
    expect(ask.textContent).toContain("Give a tour of the Drawer");
  });

  it("o15_an_order_without_a_title_shows_its_ask", async () => {
    const drawer = await openDrawer({ kind: "work", ask: "Give a tour", limits: [] });
    expect(drawer.querySelector(".order-title")!.textContent).toContain("Give a tour");
    expect(drawer.querySelector(".order-ask")).toBeNull();
  });

  it("o15_the_done_mark_follows_the_agent_kind", async () => {
    for (const kind of KINDS) {
      const drawer = await openDrawer(full, { kind });
      const line = drawer.querySelector<HTMLElement>(".order-done-line")!;
      expect(line.textContent).toContain("The tour is written");

      expect(line.dataset.done, kind).toBe(String(kind === "done"));
      expect(line.querySelector("[role=img]")!.getAttribute("aria-label")).toBe(kind === "done" ? "Done" : "Not done");
      document.body.innerHTML = "";
    }
  });

  it("o15_no_done_no_line", async () => {
    const drawer = await openDrawer({ kind: "work", ask: "Give a tour", limits: [] });
    expect(drawer.querySelector(".order-done-line")).toBeNull();
  });

  it("o15_no_limits_part_is_drawn", async () => {
    const drawer = await openDrawer(full);
    
    for (const limit of limits) expect(drawer.textContent).not.toContain(limit);
    expect(drawer.textContent?.toLowerCase()).not.toContain("limits");
  });

  it("o15_no_list_is_drawn", async () => {
    const drawer = await openDrawer(full);
    expect(drawer.querySelector("ul, h3")).toBeNull();
  });
});

describe("O16: the user edits the order in the Drawer", () => {
  const edit = async (order: Order, setOrder: (params: never) => object | null) => {
    const drawer = await openDrawer(order, { handlers: { "agent.setOrder": setOrder } });
    fireEvent.click(screen.getByRole("button", { name: "Edit order" }));

    return drawer;
  };

  const field = (name: string) => document.querySelector<HTMLInputElement>(`[name=${name}]`)!;

  it("o16_edit_opens_fields_with_the_current_text", async () => {
    await edit(full, () => ({}));
    expect(field("title").value).toBe("Give a Drawer tour");
    expect(field("ask").value).toBe("Give a tour of the Drawer");
    expect(field("done").value).toBe("The tour is written");
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Copy title" })).toBeNull();
  });

  it("o16_save_sends_set_order_with_the_limits_unchanged", async () => {
    const sent: object[] = [];
    await edit(full, (params) => (sent.push(params), {}));
    fireEvent.input(field("title"), { target: { value: "Tour the Drawer" } });
    fireEvent.input(field("ask"), { target: { value: "Tour it" } });
    fireEvent.input(field("done"), { target: { value: "It is toured" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(document.querySelector(".order-edit")).toBeNull());
    expect(sent).toEqual([
      { id: "a", order: { kind: "work", title: "Tour the Drawer", ask: "Tour it", done: "It is toured", limits }, captured: { order: full } },
    ]);
  });

  it("o16_a_blank_title_or_done_is_sent_absent", async () => {
    const sent: { order: Order }[] = [];
    await edit(full, (params) => (sent.push(params), {}));
    fireEvent.input(field("title"), { target: { value: "   " } });
    fireEvent.input(field("done"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect("title" in sent[0]!.order).toBe(false);
    expect("done" in sent[0]!.order).toBe(false);
  });

  it("o16_a_rejected_save_keeps_the_input_and_shows_the_error", async () => {
    await edit(full, () => {
      throw new Error("order title is over 6 words");
    });
    fireEvent.input(field("title"), { target: { value: "one two three four five six seven" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("order title is over 6 words"));
    expect(field("title").value).toBe("one two three four five six seven");
    expect(screen.getByRole("img", { name: "Error" })).toBeTruthy();
  });

  it("o16_a_clarification_order_has_no_edit_button", async () => {
    await openDrawer(clarifying("which?"));
    expect(screen.queryByRole("button", { name: "Edit order" })).toBeNull();
  });
});

it("u2773a_orders_untouched_cancel_leaves_nothing_to_recover", async () => {
  await openDrawer(full);
  fireEvent.click(screen.getByRole("button", { name: "Edit order" }));
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("button", { name: "Recover unfinished work" })).toBeNull();
});

it("u2773a_orders_restores_exact_work_after_escape", async () => {
  const sent: object[] = [];
  await openDrawer(full, { handlers: { "agent.setOrder": (params) => { sent.push(params);

 return {}; } } });
  fireEvent.click(screen.getByRole("button", { name: "Edit order" }));
  const field = screen.getByLabelText<HTMLTextAreaElement>("Ask");
  const exact = "  draft\ncombining é 👋  \n";
  fireEvent.input(field, { target: { value: exact } });
  field.focus();
  field.setSelectionRange(3, 9, "backward");
  fireEvent.select(field);
  fireEvent.keyDown(field, { key: "Escape" });
  expect(document.querySelector(".order-edit")).toBeNull();
  expect(document.querySelector(".order-title")?.textContent).toContain("Give a Drawer tour");
  expect(sent).toEqual([]);
  fireEvent.click(screen.getByRole("button", { name: "Edit order" }));
  const restored = screen.getByLabelText<HTMLTextAreaElement>("Ask");
  expect([restored.value, restored.selectionStart, restored.selectionEnd, restored.selectionDirection]).toEqual([exact, 3, 9, "backward"]);
});

it("u2773a_orders_agent_switch_keeps_recipient", async () => {
  const sent: object[] = [];
  await openDrawer(full, { handlers: {
    "rail.tree": () => [agent("a", "working", "editing", { name: "alpha", work: full }), agent("b", "working", "editing", { name: "beta", work: full }), door("r", "working", "editing", { name: "harbor" })],
    "agent.setOrder": (params) => { sent.push(params);

 return {}; },
  } });
  fireEvent.click(screen.getByRole("button", { name: "Edit order" }));
  fireEvent.input(screen.getByLabelText("Ask"), { target: { value: "  alpha original 🧭\n" } });
  select("beta");
  fireEvent.click(await screen.findByRole("button", { name: "Order of beta" }));
  fireEvent.click(screen.getByRole("button", { name: "Edit order" }));
  expect(screen.getByLabelText<HTMLTextAreaElement>("Ask").value).toBe(full.ask);
  fireEvent.input(screen.getByLabelText("Ask"), { target: { value: "  beta original 👋\n" } });
  select("alpha");
  fireEvent.click(await screen.findByRole("button", { name: "Order of alpha" }));
  fireEvent.click(screen.getByRole("button", { name: "Edit order" }));
  expect(screen.getByLabelText<HTMLTextAreaElement>("Ask").value).toBe("  alpha original 🧭\n");
  expect(sent).toEqual([]);
});

for (const outcome of ["acknowledged", "failed", "unknown"] as const) {
  it(`u2773b_orders_settlement_preserves_other_revisions_${outcome}`, async () => {
    const reply = gate<object>();
    const sent: object[] = [];
    await openDrawer(full, { handlers: { "agent.setOrder": (params) => { sent.push(params);

 return reply.promise; } } });
    fireEvent.click(screen.getByRole("button", { name: "Edit order" }));
    const ask = screen.getByLabelText<HTMLTextAreaElement>("Ask");
    fireEvent.input(ask, { target: { value: "  older A 👋\n" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.input(ask, { target: { value: "  newer B é\n" } });

    if (outcome === "acknowledged") reply.resolve({});
    else reply.reject(outcome === "failed" ? new RpcError(-32003, "refused") : new RpcError(-32603, "disconnected"));

    if (outcome === "acknowledged") await new Promise((done) => setTimeout(done));

    if (outcome !== "acknowledged") await screen.findByRole("alert");
    expect(screen.getByLabelText<HTMLTextAreaElement>("Ask").value).toBe("  newer B é\n");
    expect(sent).toEqual([{ id: "a", order: { kind: "work", title: full.title, ask: "older A 👋", done: full.done, limits }, captured: { order: full } }]);
    cleanup();
    await openDrawer(full, { handlers: { "agent.setOrder": (params) => { sent.push(params);

 return {}; } } });
    fireEvent.click(screen.getByRole("button", { name: "Edit order" }));
    expect(screen.getByLabelText<HTMLTextAreaElement>("Ask").value).toBe("  newer B é\n");

    if (outcome === "acknowledged") expect(screen.queryByRole("button", { name: "Recover unfinished work" })).toBeNull();
    else {
      fireEvent.click(screen.getByRole("button", { name: "Recover unfinished work" }));
      const recovery = await screen.findByLabelText("Unfinished work");

      expect(recovery.querySelectorAll("li[data-revision]")).toHaveLength(1);
      expect(recovery.textContent).toContain(outcome === "failed" ? "failed to save" : "may not have saved");
      fireEvent.click(screen.getByRole("button", { name: "Discard" }));
      expect(recovery.querySelectorAll("li[data-revision]")).toHaveLength(0);
    }

    expect(sent).toHaveLength(1);
  });
}

it("u2773b_orders_out_of_order_acknowledgement_keeps_late_failure", async () => {
  const older = gate<object>();
  const newer = gate<object>();
  let calls = 0;
  await openDrawer(full, { handlers: { "agent.setOrder": () => (++calls === 1 ? older.promise : newer.promise) } });
  fireEvent.click(screen.getByRole("button", { name: "Edit order" }));
  fireEvent.input(screen.getByLabelText("Ask"), { target: { value: "old failed revision" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  fireEvent.input(screen.getByLabelText("Ask"), { target: { value: "new acknowledged revision" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  newer.resolve({});
  await waitFor(() => expect(document.querySelector(".order-edit")).toBeNull());
  older.reject(new RpcError(-32003, "older refused"));
  fireEvent.click(await screen.findByRole("button", { name: "Recover unfinished work" }));
  const recovery = await screen.findByLabelText("Unfinished work");
  await waitFor(() => expect(recovery.textContent).toContain("failed to save"));
  expect(recovery.querySelectorAll("li[data-revision]")).toHaveLength(1);
  expect(calls).toBe(2);
});

it("u2773e_recovery_actions_keep_surface_draft_orders", async () => {
  const sends: object[] = [];
  await openDrawer(full, { handlers: { "agent.setOrder": (params) => { sends.push(params);

 return {}; } } });
  fireEvent.click(screen.getByRole("button", { name: "Edit order" }));
  const storage = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("disk full"); });
  fireEvent.input(screen.getByLabelText("Title"), { target: { value: "  unsaved title 👋  " } });
  fireEvent.input(screen.getByLabelText("Ask"), { target: { value: "  unsaved ask\n" } });
  fireEvent.input(screen.getByLabelText("Done when"), { target: { value: "  unsaved done é  " } });
  expect(screen.getByRole("alert").textContent).toContain("reload");
  const clipboard = vi.fn(async (_text: string) => {});
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: clipboard } });

  for (const name of ["Copy title", "Copy ask", "Copy done"]) fireEvent.click(screen.getByRole("button", { name }));
  await waitFor(() => expect(clipboard.mock.calls).toEqual([["  unsaved title 👋  "], ["  unsaved ask\n"], ["  unsaved done é  "]]));
  storage.mockRestore();
  fireEvent.click(screen.getByRole("button", { name: "Retry storage only" }));
  expect(screen.queryByRole("alert")).toBeNull();
  fireEvent.keyDown(screen.getByLabelText("Ask"), { key: "Escape" });
  fireEvent.click(screen.getByRole("button", { name: "Edit order" }));
  expect(["Title", "Ask", "Done when"].map((label) => screen.getByLabelText<HTMLTextAreaElement>(label).value))
    .toEqual(["  unsaved title 👋  ", "  unsaved ask\n", "  unsaved done é  "]);
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("disk full"); });
  fireEvent.input(screen.getByLabelText("Ask"), { target: { value: "discard me" } });
  vi.restoreAllMocks();
  fireEvent.click(screen.getByRole("button", { name: "Discard this revision" }));
  expect(document.querySelector(".order-edit")).toBeNull();
  expect(screen.queryByRole("button", { name: "Recover unfinished work" })).toBeNull();
  expect(sends).toEqual([]);
});

it("u2773c_orders_untouched_editor_follows_external_change", async () => {
  let latest = full;

  const { app } = await mountApp([], (app) => {
    app.handlers["rail.tree"] = () => [
      agent("a", "working", "editing", { name: "alpha", order: 0, work: latest }),
      agent("b", "working", "editing", { name: "beta", order: 1 }),
      door("r", "working", "editing", { name: "harbor", order: 2 }),
    ];
    app.handlers["agent.spawnPrompt"] = () => ({ prompt: null });
  });

  select("alpha");
  fireEvent.click(await screen.findByRole("button", { name: "Order of alpha" }));
  fireEvent.click(await screen.findByRole("button", { name: "Edit order" }));
  latest = { kind: "work", title: "Updated title", ask: "Updated ask", done: "Updated done", limits: ["Updated limit"] };
  app.emit({ actor: { kind: "user", id: "you", parent: null }, name: "rail.changed" });
  await waitFor(() => expect(screen.getByLabelText<HTMLTextAreaElement>("Ask").value).toBe("Updated ask"));
  expect(["Title", "Done when"].map((label) => screen.getByLabelText<HTMLTextAreaElement>(label).value))
    .toEqual(["Updated title", "Updated done"]);
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByRole("button", { name: "Copy ask" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Recover unfinished work" })).toBeNull();
  fireEvent.input(screen.getByLabelText("Ask"), { target: { value: "My edit after update" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.calls.filter((call) => call.method === "agent.setOrder").map((call) => call.params))
    .toEqual([{ id: "a", order: { ...latest, ask: "My edit after update" }, captured: { order: latest } }]));
});

const selectedOrder = async (outcome: "failed" | "unknown" = "failed") => {
  const app = createFakeApp();

  let nodes = [
    agent("a", "working", "editing", { name: "same name", work: full }),
    agent("other", "working", "editing", { name: "same name", work: full }),
  ];

  app.handlers["rail.tree"] = () => nodes;
  const connected = await connectProject(app, { name: "same name", path: "/original" }, () => true, () => 0);
  const destination = { surface: "orders", object: "a", recipient: "a" };

  const value = { title: "  title 👋  ", ask: "  é 🧪\n次の行  ", done: "  done ✓  ", field: "ask",
    baseTitle: full.title!, baseAsk: full.ask, baseDone: full.done!, limits };

  const selection = { start: 2, end: 7, direction: "backward" as const };
  const a = connected.drafts.edit(destination, value, selection, "ordinary").draft;
  connected.drafts.submit(a.revision);
  connected.drafts.settle(a.revision, outcome);

  const b = connected.drafts.edit(destination, { ...value, ask: "newer B\n👋", field: "done" },
    { start: 1, end: 4, direction: "forward" }, "ordinary").draft;

  render(() => <ConnectedProjectContext.Provider value={connected}>
    <DrawerHost drawer={connected.drawer} reducedMotion={() => true} />
  </ConnectedProjectContext.Provider>);

  const open = (revision: string, project = connected.project.path, id = "a") => connected.drawer.open(
    () => <OrderDrawer id={id} recovery={{ project, revision }} />, "key");

  return { app, connected, a, b, value, open, setNodes: (next: typeof nodes) => { nodes = next; } };
};

it.each(["failed", "unknown"] as const)("u3021c_open_restores_exact_revision_without_rpc_orders_%s", async outcome => {
  const { app, connected, a, b, value, open } = await selectedOrder(outcome);
  const before = connected.drafts.list();
  const calls = [...app.calls];
  open(a.revision);
  const ask = await screen.findByLabelText<HTMLTextAreaElement>("Ask");
  await waitFor(() => expect(document.activeElement).toBe(ask));
  expect(["Title", "Ask", "Done when"].map(label => screen.getByLabelText<HTMLTextAreaElement>(label).value))
    .toEqual([value.title, value.ask, value.done]);
  expect([ask.selectionStart, ask.selectionEnd, ask.selectionDirection]).toEqual([2, 7, "backward"]);
  ask.focus(); fireEvent.blur(ask);
  connected.drawer.close("key");
  expect(connected.drafts.list()).toEqual(before);
  expect(app.calls).toEqual(calls);
  open(b.revision);
  const done = await screen.findByLabelText<HTMLTextAreaElement>("Done when");
  await waitFor(() => expect(document.activeElement).toBe(done));
  expect(screen.getByLabelText("Ask")).toHaveProperty("value", "newer B\n👋");
  expect([done.selectionStart, done.selectionEnd, done.selectionDirection]).toEqual([1, 4, "forward"]);
  expect(connected.drafts.list()).toEqual(before);
  expect(app.calls).toEqual(calls);
});

it("u3021c_orders_editing_selected_failure_preserves_newer_current_work", async () => {
  const { app, connected, a, b, open } = await selectedOrder();
  const calls = [...app.calls];
  open(a.revision);
  const ask = await screen.findByLabelText<HTMLTextAreaElement>("Ask");
  await waitFor(() => expect(document.activeElement).toBe(ask));
  fireEvent.input(ask, { target: { value: "edited A\n🧭" } });
  ask.setSelectionRange(1, 5, "backward");
  fireEvent.select(ask);
  expect(connected.drafts.list()).toContainEqual(b);
  expect(connected.drafts.list()).toContainEqual({ ...a, status: "failed" });
  const edited = connected.drafts.list().find(draft => draft.value.ask === "edited A\n🧭")!;
  connected.drawer.close("key");
  open(b.revision);
  const done = await screen.findByLabelText<HTMLTextAreaElement>("Done when");
  await waitFor(() => expect(document.activeElement).toBe(done));
  expect(screen.getByLabelText("Ask")).toHaveProperty("value", "newer B\n👋");
  expect([done.selectionStart, done.selectionEnd, done.selectionDirection]).toEqual([1, 4, "forward"]);
  connected.drawer.close("key");
  open(edited.revision);
  const restored = await screen.findByLabelText<HTMLTextAreaElement>("Ask");
  await waitFor(() => expect(document.activeElement).toBe(restored));
  expect([restored.value, restored.selectionStart, restored.selectionEnd, restored.selectionDirection]).toEqual(["edited A\n🧭", 1, 5, "backward"]);
  expect(app.calls).toEqual(calls);
});

it.each(["acknowledged", "failed", "unknown"] as const)("u3021c_orders_explicit_save_settles_only_selected_revision_%s", async outcome => {
  const { app, connected, a, b, open } = await selectedOrder();
  app.handlers["agent.setOrder"] = () => {
    if (outcome !== "acknowledged") throw outcome === "failed" ? new RpcError(-32003, "refused") : new Error("unknown acceptance");

    return agent("a", "working", "editing", { work: full });
  };

  const calls = [...app.calls];
  open(a.revision);
  const ask = await screen.findByLabelText<HTMLTextAreaElement>("Ask");
  await waitFor(() => expect(document.activeElement).toBe(ask));
  expect(app.calls).toEqual(calls);
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(connected.drafts.list().find(draft => draft.revision === a.revision)?.status)
    .toBe(outcome === "acknowledged" ? undefined : outcome));
  expect(app.calls.slice(calls.length)).toEqual([{ method: "agent.setOrder", params: {
    id: "a", order: { kind: "work", title: "title 👋", ask: "é 🧪\n次の行", done: "done ✓", limits }, captured: { order: full },
  } }]);
  expect(connected.drafts.list()).toContainEqual(b);
  connected.drawer.close("key");
  open(b.revision);
  expect(await screen.findByLabelText("Ask")).toHaveProperty("value", "newer B\n👋");
});

it("u3021c_orders_unknown_acceptance_cannot_be_retried_or_edited", async () => {
  const { app, connected, a, open } = await selectedOrder("unknown");
  const before = connected.drafts.list();
  const calls = [...app.calls];
  open(a.revision);
  const ask = await screen.findByLabelText<HTMLTextAreaElement>("Ask");
  expect(ask.readOnly).toBe(true);
  fireEvent.input(ask, { target: { value: "must not create a retry" } });
  fireEvent.submit(ask.closest("form")!);
  expect(connected.drafts.list()).toEqual(before);
  expect(app.calls).toEqual(calls);
});

it("u3021c_orders_selected_discard_preserves_other_revisions_durably", async () => {
  const { app, connected, a, b, open } = await selectedOrder();
  const calls = [...app.calls];
  open(a.revision);
  fireEvent.click(await screen.findByRole("button", { name: "Discard this revision" }));
  expect(connected.drafts.list()).toEqual([b]);
  expect(app.calls).toEqual(calls);
  const reloaded = await connectProject(app, connected.project, () => true, () => 0);
  expect(reloaded.drafts.list()).toEqual([b]);
});

it.each(["project", "object", "recipient", "removed", "revision"] as const)("u3021c_orders_refuses_wrong_original_%s", async mismatch => {
  const { app, connected, a, open, setNodes } = await selectedOrder();

  if (mismatch === "removed") {
    setNodes([agent("replacement", "working", "editing", { name: "same name", work: full })]);
    await connected.rail.refresh();
  }

  const revision = mismatch === "recipient" ? connected.drafts.edit({ ...a.destination, recipient: "other" }, a.value, a.selection, "ordinary").draft.revision : a.revision;
  const before = connected.drafts.list();
  const calls = [...app.calls];
  open(mismatch === "revision" ? "missing" : revision, mismatch === "project" ? "/other" : connected.project.path, mismatch === "object" ? "other" : "a");
  expect(screen.queryByLabelText("Ask")).toBeNull();
  expect(screen.queryByRole("button", { name: "Edit order" })).toBeNull();
  expect(connected.drafts.list()).toEqual(before);
  expect(app.calls).toEqual(calls);
});

it("u3021c_orders_selected_save_keeps_captured_base_conflict_guard", async () => {
  const { app, connected, a, open, setNodes } = await selectedOrder();
  setNodes([agent("a", "working", "editing", { name: "same name", work: { ...full, ask: "external edit" } })]);
  await connected.rail.refresh();
  const calls = [...app.calls];
  const before = connected.drafts.list();
  open(a.revision);
  const ask = await screen.findByLabelText<HTMLTextAreaElement>("Ask");
  expect(screen.getByRole("alert").textContent).toContain("changed");
  fireEvent.submit(ask.closest("form")!);
  expect(connected.drafts.list()).toEqual(before);
  expect(app.calls).toEqual(calls);
});
