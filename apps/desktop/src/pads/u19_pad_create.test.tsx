import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AGENT, CONFLICT, openShelf, padOf, RpcError } from "./padsFixture";
import { USER } from "../testing/nodes";

afterEach(cleanup);

const typeName = async (name: string) => {
  fireEvent.click(await screen.findByRole("button", { name: "Add Pad" }));
  const field = await screen.findByLabelText<HTMLInputElement>("Pad name");
  fireEvent.input(field, { target: { value: name } });
  fireEvent.keyDown(field, { key: "Enter" });

  return field;
};

describe("u19 create", () => {
  // Rule 10: u19_the_name_field_is_a_row_after_the_last_pad also proves plus opens the field.
  it("u19_the_name_field_is_a_row_after_the_last_pad", async () => {
    await openShelf([padOf("notes", USER)]);

    fireEvent.click(await screen.findByRole("button", { name: "Add Pad" }));

    expect(screen.getByText("notes").compareDocumentPosition(await screen.findByLabelText("Pad name")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

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

  it("u19_enter_calls_pad_create_with_the_name_and_leaves_a_fresh_focused_field", async () => {
    const { app } = await openShelf([]);
    app.handlers["pad.create"] = ({ name }) => padOf(name, USER);

    const field = await typeName("notes");

    await waitFor(() => expect(app.calls.filter((call) => call.method === "pad.create")).toEqual([
      { method: "pad.create", params: { name: "notes", text: null } },
    ]));
    expect(field).toHaveProperty("value", "");
    expect(document.activeElement).toBe(field);
  });

  it("u19_a_conflict_shows_the_message_and_keeps_the_field", async () => {
    const { app } = await openShelf([]);
    app.handlers["pad.create"] = () => {
      throw new RpcError(CONFLICT, "pad notes exists");
    };

    await typeName("Notes");

    expect((await screen.findByText(/exists/)).textContent).toBe(
      "pad notes exists",
    );
    expect(screen.getByLabelText("Pad name")).toBeTruthy();
  });

  it("u19_invalid_params_shows_the_message_and_keeps_the_field", async () => {
    const { app } = await openShelf([]);
    app.handlers["pad.create"] = () => {
      throw new RpcError(-32602, "name must not contain /");
    };

    await typeName("a/b");

    expect((await screen.findByText(/must not contain/)).textContent).toBe(
      "name must not contain /",
    );
    expect(screen.getByLabelText("Pad name")).toBeTruthy();
  });

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
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: clipboard } });
    fireEvent.click(screen.getByRole("button", { name: "Copy name" }));
    expect(clipboard).toHaveBeenCalledWith("  recoverable é 🪁  ");
    expect(localStorage.getItem("roundup:drafts:/p")).toBe(raw);
    fireEvent.click(screen.getByRole("button", { name: "Discard this revision" }));
    expect(connected.drafts.list()).toEqual([older]);
    expect(field.value).toBe("");
    writes.mockRestore();
    fireEvent.click(screen.getByRole("button", { name: "Retry storage only" }));
    expect(connected.drafts.problem()).toBeNull();
    expect(JSON.parse(localStorage.getItem("roundup:drafts:/p")!).drafts).toEqual([older]);
    expect(app.calls.filter(call => call.method === "pad.create")).toHaveLength(1);
  } finally {
    writes.mockRestore();
  }
});
