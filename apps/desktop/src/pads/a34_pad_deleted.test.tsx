import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import type { Pad } from "@contracts/pad/Pad";
import { AGENT, deferred, openPad, openShelf, padOf, RpcError } from "./padsFixture";

import { answerQuestion, questionDialog } from "../shelf/bulkQuestionHarness";
import { USER } from "../testing/nodes";

afterEach(cleanup);

it("a34_pad_deleted_refreshes_the_pad_list_through_the_fake_app_seam", async () => {
  const { app, state, calls } = await openShelf([padOf("plan", AGENT)]);
  await screen.findByText("plan");
  state.pads = [padOf("kept", AGENT)];

  app.emit({ actor: AGENT, name: "pad.deleted", data: { name: "plan" } });
  await screen.findByText("kept");

  expect(screen.queryByText("plan")).toBeNull();
  expect(calls().filter((method) => method === "pad.list")).toHaveLength(2);
});

it("a34_pad_deleted_cannot_leave_the_pad_cached_when_refresh_fails", async () => {
  const { app } = await openShelf([padOf("plan", AGENT)]);
  await screen.findByText("plan");
  app.handlers["pad.list"] = () => {
    throw new RpcError(-32001, "cannot list Pads");
  };

  app.emit({ actor: AGENT, name: "pad.deleted", data: { name: "plan" } });
  await screen.findByText("cannot list Pads");

  await waitFor(() => expect(screen.queryByText("plan")).toBeNull());
});

it("a34_pad_deleted_marks_an_open_drawer_as_deleted", async () => {
  const { app, state } = await openShelf([padOf("plan", AGENT, "saved text")]);
  await openPad("plan");
  state.pads = [];

  app.emit({ actor: AGENT, name: "pad.deleted", data: { name: "plan" } });

  expect((await screen.findByText("Pad plan was deleted")).textContent).toBe("Pad plan was deleted");
});

it("a34_an_older_pad_list_reply_cannot_restore_a_deleted_pad", async () => {
  const { app } = await openShelf([padOf("plan", AGENT)]);
  await screen.findByText("plan");
  const older = deferred<Pad[]>();
  let reads = 0;
  app.handlers["pad.list"] = () => (++reads === 1 ? older.promise : []);
  app.emit({ actor: AGENT, name: "pad.changed", data: { name: "plan" } });
  await waitFor(() => expect(reads).toBe(1));

  app.emit({ actor: AGENT, name: "pad.deleted", data: { name: "plan" } });
  await screen.findByText("No Pads yet");
  older.resolve([padOf("plan", AGENT)]);
  // fakeApp.rpc unwraps the deferred reply before reload resumes, in two microtasks.
  await Promise.resolve();
  await Promise.resolve();

  expect(screen.queryByText("plan")).toBeNull();
});

it("a34_pad_deleted_refreshes_the_open_drawers_touch_history", async () => {
  const { app, state } = await openShelf([padOf("plan", AGENT)]);
  await openPad("plan");
  state.pads = [];
  state.history = [{ actor: AGENT, verb: "wrote", item: "pad:plan", at: 123 }];

  app.emit({ actor: AGENT, name: "pad.deleted", data: { name: "plan" } });

  expect((await screen.findByText(/auth-refactor wrote this Pad at/)).textContent)
    .toContain("auth-refactor wrote this Pad at");
});

const failedSave = async (close = true) => {
  const shelf = await openShelf([padOf("failed", USER, "old"), padOf("other", USER, "kept")]);
  const reply = deferred<Pad>();
  shelf.app.handlers["pad.write"] = () => reply.promise;
  const field = await openPad("failed");
  fireEvent.input(field, { target: { value: "recoverable" } });

  if (close) shelf.connected.drawer.close("key");
  else fireEvent.focusOut(field);

  reply.reject(new RpcError(-32002, "cannot save failed"));
  await screen.findByText("cannot save failed");

  return { ...shelf, field };
};

const answerDelete = async (accepted: boolean) => {
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  await questionDialog();
  await answerQuestion(accepted);
};

it("p3557b_delete_failed_pad_clears_its_line", async () => {
  const { app, state, connected } = await failedSave();
  await openPad("other");
  await answerDelete(true);
  await waitFor(() => expect(connected.drawer.content()).toBeNull());
  app.emit({ actor: USER, name: "pad.deleted", data: { name: "other" } });
  await waitFor(() => expect(screen.queryByText("other")).toBeNull());
  expect(screen.getByText("cannot save failed")).toBeDefined();
  await openPad("failed");
  await answerDelete(false);
  expect(screen.getByText("cannot save failed")).toBeDefined();
  app.handlers["pad.delete"] = () => { throw new RpcError(-32002, "deletion refused"); };

  await answerDelete(true);
  await screen.findByText("deletion refused");
  expect(screen.getByText("cannot save failed")).toBeDefined();
  app.handlers["pad.delete"] = () => { state.pads = [];

 return null; };

  await answerDelete(true);
  await waitFor(() => expect(connected.drawer.content()).toBeNull());
  app.emit({ actor: USER, name: "pad.deleted", data: { name: "failed" } });
  await screen.findByText("No Pads yet");
  expect(screen.queryByText("cannot save failed")).toBeNull();
});

it("p3557b_success_clears_same_pad_failure", async () => {
  const { app, state, connected } = await failedSave();
  app.handlers["pad.write"] = ({ name, text }) => {
    const pad = { ...state.pads.find(pad => pad.name === name)!, text, revision: 2 };
    state.pads = state.pads.map(current => current.name === name ? pad : current);

    return pad;
  };

  const other = await openPad("other");
  fireEvent.input(other, { target: { value: "other saved" } });
  fireEvent.focusOut(other);
  await waitFor(() => expect(state.pads.find(pad => pad.name === "other")?.text).toBe("other saved"));
  expect(screen.getByText("cannot save failed")).toBeDefined();
  connected.drawer.close("key");
  const field = await openPad("failed");
  fireEvent.input(field, { target: { value: "saved again" } });
  fireEvent.click(screen.getByRole("button", { name: "Resume" }));
  await waitFor(() => expect(state.pads.find(pad => pad.name === "failed")?.text).toBe("saved again"));
  await waitFor(() => expect(screen.queryByText("cannot save failed")).toBeNull());
});

it.each([true, false])("p3557b_dismiss_keeps_draft: closed=%s", async close => {
  const { app, connected, field } = await failedSave(close);
  const before = connected.drafts.list().map(draft => draft.value);
  const calls = app.calls.length;
  const dismiss = screen.getByRole("button", { name: "Dismiss failure" });

  if (!close) fireEvent.focusOut(field, { relatedTarget: dismiss });
  fireEvent.click(dismiss);
  expect(screen.queryByText("cannot save failed")).toBeNull();
  expect(connected.drafts.list().map(draft => draft.value)).toEqual(before);
  expect(app.calls.slice(calls)).toEqual([]);

  if (!close) expect(field.value).toBe("recoverable");
});

it("p3557b_edits_save_and_reopen", async () => {
  const { state, app, connected } = await openShelf([padOf("notes", USER, "one\n\ntwo\n\nthree")]);
  let field = await openPad("notes");
  expect(app.calls.filter(call => call.method === "pad.write")).toEqual([]);
  field.setSelectionRange(4, 4);
  fireEvent.keyDown(field.querySelector(".ProseMirror")!, { key: "Enter", keyCode: 13 });
  await waitFor(() => expect(state.pads[0]!.text).not.toBe("one\n\ntwo\n\nthree"));
  fireEvent.keyDown(field.querySelector(".ProseMirror")!, { key: "Enter", keyCode: 13 });
  fireEvent.input(field, { target: { value: "one\n\nnew\n\ntwo\n\nthree" } });
  await waitFor(() => expect(state.pads[0]!.text).toContain("new"));
  connected.drawer.close("key");
  field = await openPad("notes");
  expect(field.value).toContain("new");
  fireEvent.input(field, { target: { value: "one\n\nnewer\n\ntwo\n\nthree" } });
  await waitFor(() => expect(state.pads[0]!.text).toContain("newer"));
  expect(screen.queryByText(/edited blocks could not be matched/)).toBeNull();

  for (const call of app.calls.filter(call => call.method === "pad.write")) expect(call.params).toEqual(expect.objectContaining({ text: expect.any(String) }));
});
