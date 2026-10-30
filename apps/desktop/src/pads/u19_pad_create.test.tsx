import { copy as recoveryCopy } from "../sharedCopy";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AGENT, CONFLICT, openShelf, padOf, RpcError } from "./padsFixture";
import { DrawerHost } from "../drawer/DrawerHost";
import { Pads } from "./Pads";
import { ConnectedProjectContext } from "../state/connectedProject";
import { agent, terminal, USER, workstream } from "../testing/nodes";

afterEach(cleanup);

const typeName = async (name: string) => {
  fireEvent.click(await screen.findByRole("button", { name: "Add Pad" }));
  const field = await screen.findByLabelText<HTMLInputElement>("Pad name");
  fireEvent.input(field, { target: { value: name } });
  fireEvent.keyDown(field, { key: "Enter" });

  return field;
};

describe("u19 create", () => {
  // Rule 10: row positioning is retired to the design critic; u19_escape_closes_the_name_field_and_calls_nothing proves Add opens the form.
  it("u19_escape_closes_the_name_field_and_calls_nothing", async () => {
    const { calls } = await openShelf([]);
    fireEvent.click(await screen.findByRole("button", { name: "Add Pad" }));

    fireEvent.keyDown(await screen.findByLabelText("Pad name"), {
      key: "Escape",
    });

    expect([
      screen.queryByLabelText("Pad name"),
      calls().includes("pad.create"),
    ]).toEqual([null, false]);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Add Pad" }));
  });

  it.each([null, AGENT.id, "maker", "terminal"])("u3735_create_uses_home_only_%s", async selected => {
    const { app, connected } = await openShelf([]);
    app.handlers["rail.tree"] = () => [workstream(AGENT.id), agent("maker", "working", "editing", { parent: AGENT.id }), terminal("terminal", { parent: AGENT.id })];
    await connected.rail.refresh();
    connected.rail.select(selected);

    const field = await typeName("notes");

    await waitFor(() => expect(app.calls.filter((call) => call.method === "pad.create")).toEqual([
      { method: "pad.create", params: { name: "notes", text: null } },
    ]));
    await waitFor(() => expect(app.calls.filter(call => call.method === "pad.move").map(call => call.params)).toEqual(selected === null ? [] : [{ name: "notes", home: AGENT.id }]));
    await waitFor(() => expect(document.querySelectorAll('[data-pad="notes"]')).toHaveLength(1));
    expect(field).toHaveProperty("value", "");
    expect(document.activeElement).toBe(field);
  });

  // U3735 refusal observer below replaces u19_a_conflict_shows_the_message_and_keeps_the_field.
  // Rule 10: U3735 below proves refusal retention; the duplicate invalid-params example is retired.
  it("u19_clicking_plus_again_replaces_the_message_with_a_fresh_field", async () => {
    const { app } = await openShelf([]);
    app.handlers["pad.create"] = () => {
      throw new RpcError(CONFLICT, "pad notes exists");
    };

    await typeName("notes");
    await screen.findByText(/exists/);

    fireEvent.click(screen.getByRole("button", { name: "Add Pad" }));

    expect(
      [
        await screen.findByLabelText("Pad name"),
        screen.queryByText(/exists/),
      ].map(Boolean),
    ).toEqual([true, false]);
  });
});

it.each(["acknowledged", "failed", "unknown"])("u2773b_pads_creation_settlement_preserves_other_revisions_%s", async (outcome) => {
  const { app, connected } = await openShelf([]);
  const { deferred } = await import("./padsFixture");
  const reply = deferred<ReturnType<typeof padOf>>();
  app.handlers["pad.create"] = () => reply.promise;
  const field = await typeName("  earlier é 🪁  ");
  fireEvent.input(field, { target: { value: "  newer 🌱  " } });

  if (outcome === "acknowledged") reply.resolve(padOf("earlier", USER));
  else reply.reject(outcome === "failed" ? new RpcError(-32602, "refused") : new Error("disconnected"));
  await waitFor(() => expect(connected.drafts.list().some(draft => draft.status === "pending")).toBe(false));
  const records = connected.drafts.list();
  expect(records.at(-1)?.value.name).toBe("  newer 🌱  ");
  expect(field.value).toBe("  newer 🌱  ");

  if (outcome === "acknowledged") expect(records).toHaveLength(1);
  else expect(records.map(draft => [draft.value.name, draft.status])).toEqual([["  earlier é 🪁  ", outcome], ["  newer 🌱  ", "draft"]]);
  fireEvent.keyDown(field, { key: "Escape" });
  fireEvent.click(screen.getByRole("button", { name: "Add Pad" }));
  expect(screen.getByLabelText<HTMLInputElement>("Pad name").value).toBe("  newer 🌱  ");
  expect(app.calls.filter(call => call.method === "pad.create")).toHaveLength(1);
});

it("u2773a_pads_creation_restores_exact_work", async () => {
  const { app, connected } = await openShelf([]);
  connected.rail.select(AGENT.id);
  fireEvent.click(screen.getByRole("button", { name: "Add Pad" }));
  const field = screen.getByLabelText<HTMLInputElement>("Pad name");
  fireEvent.input(field, { target: { value: "  exact é 🪁  " } });
  field.setSelectionRange(2, 7, "backward");
  fireEvent.select(field);
  expect(connected.drafts.list().at(-1)?.value).toEqual({ name: "  exact é 🪁  ", home: AGENT.id });
  fireEvent.keyDown(field, { key: "Escape" });
  await waitFor(() => expect(JSON.parse(localStorage.getItem("roundup:drafts:/p")!).drafts.at(-1).selection).toMatchObject({ start: 2, end: 7, direction: "backward" }));
  cleanup();
  const restored = await openShelf([], false, true);
  fireEvent.click(screen.getByRole("button", { name: "Add Pad" }));
  const reopened = screen.getByLabelText<HTMLInputElement>("Pad name");
  await waitFor(() => expect(document.activeElement).toBe(reopened));
  expect([reopened.value, reopened.selectionStart, reopened.selectionEnd, reopened.selectionDirection]).toEqual(["  exact é 🪁  ", 2, 7, "backward"]);
  expect(restored.connected.drafts.list().at(-1)?.value.home).toBe(AGENT.id);
  expect([...app.calls, ...restored.app.calls].filter(call => call.method === "pad.create")).toEqual([]);
});


it("u2773e_recovery_actions_keep_surface_draft", async () => {
  const { app, connected } = await openShelf([]);
  app.handlers["pad.create"] = () => { throw new RpcError(-32602, "refused"); };

  const field = await typeName("earlier");
  await waitFor(() => expect(connected.drafts.list()[0]?.status).toBe("failed"));
  const older = connected.drafts.list()[0]!;
  const raw = localStorage.getItem("roundup:drafts:/p");
  const writes = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("disk full"); });

  try {
    fireEvent.input(field, { target: { value: "  recoverable é 🪁  " } });
    const clipboard = vi.fn(async () => {});
    vi.spyOn(app, "clipboardWrite").mockImplementation(clipboard);
    fireEvent.click(await screen.findByRole("button", { name: "Copy name" }));
    expect(clipboard).toHaveBeenCalledWith("  recoverable é 🪁  ");
    expect(localStorage.getItem("roundup:drafts:/p")).toBe(raw);
    fireEvent.click(screen.getByRole("button", { name: recoveryCopy.discardRevision }));
    expect(connected.drafts.list()).toEqual([older]);
    expect(field.value).toBe("");
    writes.mockRestore();
    fireEvent.click(screen.getByRole("button", { name: "Retry storage only" }));
    await waitFor(() => expect(connected.drafts.problem()).toBeNull());
    expect(JSON.parse(localStorage.getItem("roundup:drafts:/p")!).drafts).toEqual([older]);
    expect(app.calls.filter(call => call.method === "pad.create")).toHaveLength(1);
  } finally {
    writes.mockRestore();
  }
});


it.each([true, false])("u3021c_open_restores_exact_revision_without_rpc_pad_creation_captured_caret_%s", async (capturedCaret) => {
  const { app, connected } = await openShelf([]);
  const destination = { surface: "pads", object: "creation", recipient: null };
  const a = connected.drafts.edit(destination, { name: "  earlier é 🪁  ", home: AGENT.id }, capturedCaret ? { start: 2, end: 7, direction: "backward" } : null, "ordinary").draft;
  connected.drafts.submit(a.revision);
  connected.drafts.edit(destination, { name: "newer 🌱", home: null }, null, "ordinary");
  connected.drafts.settle(a.revision, "failed");
  const retained = structuredClone(connected.drafts.list());
  cleanup();
  render(() => <ConnectedProjectContext.Provider value={connected}><DrawerHost drawer={connected.drawer} reducedMotion={() => true} /></ConnectedProjectContext.Provider>);
  const calls = [...app.calls];
  connected.drawer.open(() => <ConnectedProjectContext.Provider value={connected}><Pads recovery={{ project: connected.project.path, revision: a.revision, list: { pads: () => [], loaded: () => true, failure: () => null, reload: async () => {}, settled: async () => {} } }} /></ConnectedProjectContext.Provider>, "key");
  const field = await within(screen.getByLabelText("Drawer")).findByLabelText<HTMLInputElement>("Pad name");
  await waitFor(() => expect(document.activeElement).toBe(field));
  expect(field.value).toBe("  earlier é 🪁  ");

  if (capturedCaret) expect([field.selectionStart, field.selectionEnd, field.selectionDirection]).toEqual([2, 7, "backward"]);

  fireEvent.select(field);
  fireEvent.blur(field);
  connected.drawer.close("key");
  expect(connected.drafts.list()).toEqual(retained);
  expect(app.calls).toEqual(calls);
  connected.drawer.open(() => <ConnectedProjectContext.Provider value={connected}><Pads recovery={{ project: connected.project.path, revision: a.revision, list: { pads: () => [], loaded: () => true, failure: () => null, reload: async () => {}, settled: async () => {} } }} /></ConnectedProjectContext.Provider>, "key");
  const editing = await within(screen.getByLabelText("Drawer")).findByLabelText<HTMLInputElement>("Pad name");
  await waitFor(() => expect(document.activeElement).toBe(editing));
  const b = retained.at(-1)!;
  editing.setSelectionRange(3, 5, "forward");
  fireEvent.select(editing);
  expect(connected.drafts.list()).toContainEqual(b);
  fireEvent.input(editing, { target: { value: "edited A 🌱" } });
  connected.drawer.close("key");
  const { draftStorage } = await import("../state/storage");
  await waitFor(() => expect(draftStorage(connected.project.path).list().some(draft => draft.value.name === editing.value)).toBe(true));
  const durable = draftStorage(connected.project.path).list();
  expect(durable).toContainEqual(b);
  expect(durable.some(draft => draft.value.name === "edited A 🌱")).toBe(true);
  expect(app.calls).toEqual(calls);
});

// U3735 replaces the mixed owner/creation observer: Home, refusal and focus remain.
it.each(["create", "move"])("u3735_failed_create_or_move_preserves_name_%s", async step => {
  const { app, connected } = await openShelf([]);
  connected.rail.select(AGENT.id);
  app.handlers[step === "create" ? "pad.create" : "pad.move"] = () => { throw new RpcError(-32602, `${step} refused`); };

  const field = await typeName("  exact name  ");
  await screen.findByText(new RegExp(`${step} refused`));
  expect(field.value).toBe("  exact name  ");
  expect(document.activeElement).toBe(field);
  expect(app.calls.filter(call => call.method === "pad.create")).toHaveLength(1);

  if (step === "move") {
    await screen.findByRole("button", { name: "exact name" });
    await connected.app.rpc("pad.list", null).then(pads => expect(pads).toMatchObject([{ name: "exact name", home: null }]));
  }
});
