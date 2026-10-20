import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AGENT,
  deferred,
  openPad,
  openShelf,
  padOf,
  RpcError,
  waitForReload,
  writeAdopted,
} from "./padsFixture";
import { DrawerHost } from "../drawer/DrawerHost";
import { ConnectedProjectContext } from "../state/connectedProject";
import { PadDrawer } from "./PadDrawer";
import { USER } from "../testing/nodes";
import type { Pad } from "@contracts/pad/Pad";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const edit = (field: HTMLTextAreaElement, value: string) => {
  fireEvent.focus(field);
  fireEvent.input(field, { target: { value } });
  fireEvent.focusOut(field);
};

describe("u20 open and edit", () => {
  it("u20_a_pad_the_user_owns_has_editable_text", async () => {
    await openShelf([padOf("release-checklist", USER, "x")]);

    const field = await openPad("release-checklist");

    expect([field.readOnly, screen.queryByLabelText("append")]).toEqual([
      false,
      null,
    ]);
  });

  // Rule 10: the title/owner appearance belongs to the paired rendered Pad observer.
  it("u20_opening_calls_provenance_history_then_pad_read_once_without_a_Shelf", async () => {
    const original = padOf("auth-notes", AGENT);
    const { app, connected } = await openShelf([original]);
    cleanup();
    render(() => <ConnectedProjectContext.Provider value={connected}><DrawerHost drawer={connected.drawer} reducedMotion={() => true} /></ConnectedProjectContext.Provider>);
    const before = app.calls.length;
    connected.drawer.open(() => <PadDrawer name={original.name} pads={() => [original]} onLateFailure={() => {}} />, "key");
    await screen.findByRole("textbox", { name: "Pad body" });

    expect(app.calls.slice(before).map(call => call.method)).toEqual([
      "provenance.history",
      "pad.read",
      "pad.list",
    ]);
  });

  it("u20_the_drawer_asks_for_the_history_of_the_pad_item", async () => {
    const { app } = await openShelf([padOf("auth-notes", AGENT)]);

    await openPad("auth-notes");

    expect(
      app.calls.find((call) => call.method === "provenance.history")?.params,
    ).toEqual({ item: "pad:auth-notes" });
  });

  it("u20_pad_changed_for_the_open_pad_calls_pad_list_not_pad_read_and_refreshes_its_text", async () => {
    const { app, state, calls } = await openShelf([
      padOf("auth-notes", AGENT, "v1"),
    ]);

    await openPad("auth-notes");
    const before = calls().length;
    state.pads = [padOf("auth-notes", AGENT, "v2")];

    app.emit({
      actor: AGENT,
      name: "pad.changed",
      data: { name: "auth-notes" },
    });
    await waitFor(() => expect(screen.getByLabelText("Pad body").textContent).toContain("v2"));

    expect(calls().slice(before)).toEqual(["pad.list", "provenance.history"]);
  });

  it("u20_focusing_an_agents_read_only_text_does_not_stop_it_refreshing", async () => {
    const { app, state } = await openShelf([padOf("auth-notes", AGENT, "v1")]);
    const field = await openPad("auth-notes");
    fireEvent.focus(field);
    state.pads = [padOf("auth-notes", AGENT, "v2")];

    app.emit({
      actor: AGENT,
      name: "pad.changed",
      data: { name: "auth-notes" },
    });

    await waitFor(() => expect(field.value).toBe("v2"));
  });

  it("u20_pad_changed_while_the_user_is_editing_leaves_the_text_alone", async () => {
    const { app, state, calls } = await openShelf([
      padOf("release-checklist", USER, "mine"),
    ]);

    const field = await openPad("release-checklist");
    fireEvent.focus(field);
    fireEvent.input(field, { target: { value: "mine, typing" } });
    state.pads = [padOf("release-checklist", USER, "theirs")];
    const before = calls().length;

    app.emit({
      actor: AGENT,
      name: "pad.changed",
      data: { name: "release-checklist" },
    });
    await waitFor(() => expect(calls().length).toBeGreaterThan(before));

    expect(field.value).toBe("mine, typing");
  });

  it("u20_pad_changed_for_another_pad_does_not_touch_the_open_pad", async () => {
    const { app, calls } = await openShelf([padOf("auth-notes", AGENT, "v1")]);
    await openPad("auth-notes");
    const before = calls().length;

    app.emit({ actor: AGENT, name: "pad.changed", data: { name: "other" } });
    await waitFor(() => expect(calls().length).toBeGreaterThan(before));

    expect(calls().slice(before)).toEqual(["pad.list"]);
  });

  // Rule 10: p2544b_inflight_edits_are_not_lost proves the retained draft, selection and subsequent write.
  it("u20_clicking_back_in_while_a_save_is_in_flight_never_loses_an_agents_append", async () => {
    const { app, state } = await openShelf([padOf("release-checklist", USER, "old")]);
    const reply = deferred<Pad>();
    const writes: string[] = [];
    app.handlers["pad.write"] = ({ text }) => {
      writes.push(text);

      return reply.promise;
    };

    const field = await openPad("release-checklist");
    edit(field, "new");
    fireEvent.focus(field);
    reply.resolve(padOf("release-checklist", USER, "new"));
    await reply.promise;
    await new Promise((done) => setTimeout(done, 0));
    state.pads = [padOf("release-checklist", USER, "new plus agent")];
    app.emit({ actor: AGENT, name: "pad.changed", data: { name: "release-checklist" } });
    await waitFor(() => expect(field.value).toBe("new plus agent"));

    fireEvent.focusOut(field);
    await new Promise((done) => setTimeout(done, 0));

    expect([writes, state.pads[0]?.text]).toEqual([["new"], "new plus agent"]);
  });

  it("u20_typing_back_to_the_original_text_never_sends_it_over_an_agents_append", async () => {
    const { app, state } = await openShelf([padOf("release-checklist", USER, "mine")]);
    const field = await openPad("release-checklist");
    fireEvent.input(field, { target: { value: "mine, typing" } });
    state.pads = [padOf("release-checklist", USER, "mine plus agent")];
    app.emit({ actor: AGENT, name: "pad.changed", data: { name: "release-checklist" } });
    await waitForReload(app);

    fireEvent.input(field, { target: { value: "mine" } });
    fireEvent.focusOut(field);

    await waitFor(() => expect(field.value).toBe("mine plus agent"));
    expect([app.calls.some((call) => call.method === "pad.write"), state.pads[0]?.text]).toEqual([false, "mine plus agent"]);
  });

  it("u20_a_pad_handed_over_while_the_reader_is_focused_can_save_what_is_typed", async () => {
    const { app, state } = await openShelf([padOf("auth-notes", AGENT, "v1")]);
    const field = await openPad("auth-notes");
    fireEvent.focus(field);
    state.pads = [padOf("auth-notes", USER, "v1")];
    app.emit({ actor: AGENT, name: "pad.changed", data: { name: "auth-notes" } });
    await waitFor(() => expect(field.readOnly).toBe(false));

    fireEvent.input(field, { target: { value: "typed" } });
    fireEvent.focusOut(field);

    await waitFor(() => expect(state.pads[0]?.text).toBe("typed"));
    expect(app.calls.filter((call) => call.method === "pad.write")).toEqual([
      { method: "pad.write", params: { name: "auth-notes", text: "typed", expectedRevision: 1, expectedIncarnation: "fixture-auth-notes" } },
    ]);
  });

  it("u20_clicking_in_and_out_without_typing_never_sends_the_text_the_user_was_shown", async () => {
    const { app, state } = await openShelf([
      padOf("release-checklist", USER, "mine"),
    ]);

    const field = await openPad("release-checklist");
    fireEvent.focus(field);
    state.pads = [padOf("release-checklist", USER, "mine plus agent")];
    app.emit({
      actor: AGENT,
      name: "pad.changed",
      data: { name: "release-checklist" },
    });
    await waitForReload(app);

    fireEvent.focusOut(field);

    await waitFor(() => expect(field.value).toBe("mine plus agent"));
    expect(app.calls.some((call) => call.method === "pad.write")).toBe(false);
  });

  it("u20_a_background_refresh_does_not_clear_a_visible_error", async () => {
    const { app, calls } = await openShelf([padOf("auth-notes", AGENT, "v1")]);
    app.chooser.savePath = "/gone/auth-notes.md";
    app.handlers["pad.export"] = () => {
      throw new RpcError(-32602, "directory /gone does not exist");
    };

    await openPad("auth-notes");
    fireEvent.click(screen.getByRole("button", { name: "Export .md" }));
    await screen.findByText(/does not exist/);
    const before = calls().length;

    app.emit({
      actor: AGENT,
      name: "pad.changed",
      data: { name: "auth-notes" },
    });
    await waitFor(() => expect(calls().length).toBeGreaterThan(before));

    expect(screen.queryByText(/does not exist/)).not.toBeNull();
  });

  it("u20_an_older_pad_list_reply_that_arrives_late_never_wins", async () => {
    const { app } = await openShelf([padOf("auth-notes", AGENT, "v0")]);
    const field = await openPad("auth-notes");
    const replies: ReturnType<typeof deferred<Pad[]>>[] = [];
    app.handlers["pad.list"] = () => {
      const reply = deferred<Pad[]>();
      replies.push(reply);

      return reply.promise;
    };

    app.emit({
      actor: AGENT,
      name: "pad.changed",
      data: { name: "auth-notes" },
    });
    await waitFor(() => expect(replies.length).toBe(1));
    app.emit({
      actor: AGENT,
      name: "pad.changed",
      data: { name: "auth-notes" },
    });
    await waitFor(() => expect(replies.length).toBe(2));
    const newest = replies.length - 1;

    replies.at(-1)?.resolve([padOf("auth-notes", AGENT, "newest")]);
    await waitFor(() => expect(screen.getByLabelText("Pad body").textContent).toContain("newest"));
    replies
      .slice(0, newest)
      .forEach((older) => older.resolve([padOf("auth-notes", AGENT, "older")]));
    await Promise.resolve();
    await Promise.resolve();

    expect(field.textContent).toContain("newest");
  });

  it("u20_a_pad_deleted_while_its_drawer_is_open_says_so", async () => {
    const { app, state } = await openShelf([padOf("auth-notes", AGENT, "a")]);
    await openPad("auth-notes");
    state.pads = [];

    app.emit({
      actor: AGENT,
      name: "pad.changed",
      data: { name: "auth-notes" },
    });

    expect((await screen.findByText(/was deleted/)).textContent).toBe(
      "Pad auth-notes was deleted",
    );
  });

  it("u20_a_write_that_fails_after_the_drawer_closed_shows_its_message_on_the_shelf", async () => {
    const { app, connected } = await openShelf([
      padOf("release-checklist", USER, "old"),
    ]);

    const reply = deferred<Pad>();
    app.handlers["pad.write"] = () => reply.promise;
    const field = await openPad("release-checklist");
    edit(field, "new");
    await waitFor(() =>
      expect(app.calls.some((call) => call.method === "pad.write")).toBe(true),
    );

    connected.drawer.close();
    reply.reject(new RpcError(-32001, "only the owner may write"));

    expect(
      (await screen.findByText(/only the owner may write/)).textContent,
    ).toBe("only the owner may write");
    expect(screen.queryByLabelText("Drawer")?.textContent).not.toContain(
      "only the owner",
    );
  });
});

it("p2544b_pause_coalesces_latest_draft", async () => {
  const { app } = await openShelf([padOf("notes", USER, "original")]);
  const field = await openPad("notes");
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  fireEvent.input(field, { target: { value: "first" } });
  // PadBody's 500 ms pause is the behavior under test.
  await vi.advanceTimersByTimeAsync(499);
  expect(app.calls.filter((call) => call.method === "pad.write")).toEqual([]);
  fireEvent.input(field, { target: { value: "latest" } });
  await vi.advanceTimersByTimeAsync(499);
  expect(app.calls.filter((call) => call.method === "pad.write")).toEqual([]);
  await vi.advanceTimersByTimeAsync(1);
  expect(app.calls.filter((call) => call.method === "pad.write")).toEqual([
    { method: "pad.write", params: { name: "notes", text: "latest", expectedRevision: 1, expectedIncarnation: "fixture-notes" } },
  ]);
});

it("p2544b_unchanged_or_undone_draft_does_not_autosave", async () => {
  const { app } = await openShelf([padOf("notes", USER, "original")]);
  const field = await openPad("notes");
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  fireEvent.input(field, { target: { value: "edited" } });
  fireEvent.input(field, { target: { value: "original" } });
  // Observation window: neither an undone draft nor a later idle pause may write.
  await vi.advanceTimersByTimeAsync(1000);
  expect(app.calls.filter((call) => call.method === "pad.write")).toEqual([]);
});

it("p2544b_blur_close_and_menu_focus", async () => {
  const { app, connected } = await openShelf([padOf("notes", USER, "old")]);
  const field = await openPad("notes");
  const reply = deferred<Pad>();
  app.handlers["pad.write"] = () => reply.promise;
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  fireEvent.input(field, { target: { value: "draft" } });
  const menu = document.createElement("button");
  menu.className = "pad-rich-editor";
  document.body.append(menu);
  fireEvent.focusOut(field, { relatedTarget: menu });
  expect(app.calls.filter((call) => call.method === "pad.write")).toEqual([]);
  fireEvent.focusOut(field);
  connected.drawer.close();
  await vi.advanceTimersByTimeAsync(1000);
  expect(app.calls.filter((call) => call.method === "pad.write")).toEqual([
    { method: "pad.write", params: { name: "notes", text: "draft", expectedRevision: 1, expectedIncarnation: "fixture-notes" } },
  ]);
  menu.remove();
  reply.resolve(padOf("notes", USER, "draft"));
});

it("p2544b_inflight_edits_are_not_lost", async () => {
  const { app, connected } = await openShelf([padOf("notes", USER, "old")]);
  const field = await openPad("notes");
  const reply = deferred<Pad>();
  const later = deferred<Pad>();
  let writes = 0;
  app.handlers["pad.write"] = () => ++writes === 1 ? reply.promise : later.promise;
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  fireEvent.input(field, { target: { value: "first" } });
  await vi.advanceTimersByTimeAsync(500);
  fireEvent.input(field, { target: { value: "newest" } });
  await vi.advanceTimersByTimeAsync(500);
  expect(writes).toBe(1);
  const caret = field.querySelector(".ProseMirror p")?.firstChild;

  if (!caret) throw new Error("Edited paragraph is missing");

  document.getSelection()?.collapse(caret, 3);
  reply.resolve({ ...padOf("notes", USER, "first"), revision: 2 });
  await vi.advanceTimersByTimeAsync(0);
  expect(field.value).toBe("newest");
  expect(document.getSelection()?.anchorNode).toBe(caret);
  expect(document.getSelection()?.anchorOffset).toBe(3);
  expect(app.calls.filter((call) => call.method === "pad.write")).toEqual([
    { method: "pad.write", params: { name: "notes", text: "first", expectedRevision: 1, expectedIncarnation: "fixture-notes" } },
    { method: "pad.write", params: { name: "notes", text: "newest", expectedRevision: 2, expectedIncarnation: "fixture-notes" } },
  ]);
  connected.drawer.close();
  later.resolve(padOf("notes", USER, "newest"));
  await vi.advanceTimersByTimeAsync(0);
});

it("p2544b_saved_means_current_draft_acknowledged", async () => {
  const { app } = await openShelf([padOf("notes", USER, "old")]);
  const field = await openPad("notes");
  const reply = deferred<Pad>();
  const later = deferred<Pad>();
  let writes = 0;
  app.handlers["pad.write"] = () => ++writes === 1 ? reply.promise : later.promise;
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  fireEvent.input(field, { target: { value: "first" } });
  await vi.advanceTimersByTimeAsync(500);
  expect(screen.queryByRole("status")).toBeNull();
  fireEvent.input(field, { target: { value: "latest" } });
  reply.resolve(padOf("notes", USER, "first"));
  await vi.advanceTimersByTimeAsync(0);
  expect(screen.queryByRole("status")).toBeNull();
  await vi.advanceTimersByTimeAsync(500);
  later.resolve(padOf("notes", USER, "latest"));
  await vi.advanceTimersByTimeAsync(0);
  const status = screen.getByRole("status");
  expect(status.getAttribute("data-state")).toBe("saved");
  expect(status.hasAttribute("tabindex")).toBe(false);
  fireEvent.input(field, { target: { value: "another" } });
  expect(screen.queryByRole("status")).toBeNull();
});

it("p2544b_failure_preserves_draft_and_retry", async () => {
  const { app } = await openShelf([padOf("notes", USER, "old")]);
  const field = await openPad("notes");
  const reply = deferred<Pad>();
  app.handlers["pad.write"] = () => reply.promise;
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  fireEvent.input(field, { target: { value: "draft" } });
  await vi.advanceTimersByTimeAsync(500);
  reply.reject(new RpcError(-32000, "save refused"));
  await vi.advanceTimersByTimeAsync(0);
  expect(field.value).toBe("draft");
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.getByRole("alert").textContent).toContain("save refused");
  app.handlers["pad.write"] = ({ text }) => padOf("notes", USER, text);
  fireEvent.focusOut(field);
  await vi.advanceTimersByTimeAsync(0);
  expect(app.calls.filter((call) => call.method === "pad.write")).toHaveLength(2);
  expect(screen.getByRole("status").getAttribute("data-state")).toBe("saved");
});

it("p2544b_save_lifetime_is_pad_scoped", async () => {
  const { app, connected } = await openShelf([padOf("notes", USER, "old"), padOf("other", USER, "untouched")]);
  const field = await openPad("notes");
  fireEvent.input(field, { target: { value: "draft" } });
  connected.drawer.close();
  await openPad("other");
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  // Observation window after the old Drawer unmounts.
  await vi.advanceTimersByTimeAsync(1000);
  expect(app.calls.filter((call) => call.method === "pad.write")).toEqual([
    { method: "pad.write", params: { name: "notes", text: "draft", expectedRevision: 1, expectedIncarnation: "fixture-notes" } },
  ]);
});

it("p2544b_deletion_cancels_a_queued_save", async () => {
  const { app, state } = await openShelf([padOf("notes", USER, "old")]);
  const field = await openPad("notes");
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  fireEvent.input(field, { target: { value: "draft" } });
  state.pads = [];
  app.emit({ actor: USER, name: "pad.deleted", data: { name: "notes" } });
  await screen.findByText(/was deleted/);
  fireEvent.focusOut(field);
  await vi.advanceTimersByTimeAsync(1000);
  expect(app.calls.filter((call) => call.method === "pad.write")).toEqual([]);
});

it("p2544b_close_retains_the_latest_draft_behind_an_inflight_write", async () => {
  const { app, connected } = await openShelf([padOf("notes", USER, "old")]);
  const field = await openPad("notes");
  const reply = deferred<Pad>();
  let writes = 0;
  app.handlers["pad.write"] = ({ text }) => ++writes === 1 ? reply.promise : padOf("notes", USER, text);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  fireEvent.input(field, { target: { value: "first" } });
  await vi.advanceTimersByTimeAsync(500);
  fireEvent.input(field, { target: { value: "last before close" } });
  connected.drawer.close();
  expect(writes).toBe(1);
  reply.resolve(padOf("notes", USER, "first"));
  await vi.advanceTimersByTimeAsync(0);
  expect(app.calls.filter((call) => call.method === "pad.write")).toEqual([
    { method: "pad.write", params: { name: "notes", text: "first", expectedRevision: 1, expectedIncarnation: "fixture-notes" } },
    { method: "pad.write", params: { name: "notes", text: "last before close", expectedRevision: 1, expectedIncarnation: "fixture-notes" } },
  ]);
});

it("p2544b_a_conflict_removes_saved_and_stops_the_pause", async () => {
  const { app, state } = await openShelf([padOf("notes", USER, "old")]);
  const field = await openPad("notes");
  fireEvent.input(field, { target: { value: "first" } });
  fireEvent.focusOut(field);
  await screen.findByRole("status");
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  fireEvent.input(field, { target: { value: "dirty" } });
  state.pads = [padOf("notes", USER, "agent append")];
  app.emit({ actor: AGENT, name: "pad.changed", data: { name: "notes" } });
  await screen.findByText(/Changed by/);
  await vi.advanceTimersByTimeAsync(1000);
  expect(screen.queryByRole("status")).toBeNull();
  expect(app.calls.filter((call) => call.method === "pad.write")).toHaveLength(1);
  expect(field.value).toBe("dirty");
});

it("p2544b_an_external_change_during_save_still_requires_a_choice", async () => {
  const { app, state } = await openShelf([padOf("notes", USER, "old")]);
  const field = await openPad("notes");
  const reply = deferred<Pad>();
  app.handlers["pad.write"] = () => reply.promise;
  fireEvent.input(field, { target: { value: "draft" } });
  fireEvent.focusOut(field);
  state.pads = [padOf("notes", USER, "agent append")];
  app.emit({ actor: AGENT, name: "pad.changed", data: { name: "notes" } });
  await screen.findByText(/Changed by/);
  reply.resolve(padOf("notes", USER, "draft"));
  // The visible response is the app's acknowledgement; its conflict must remain unresolved.
  await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  await reply.promise;
  // rpc's async unwrap, then PadBody's acknowledgement (padsFixture.writeAdopted).
  await writeAdopted();
  expect(screen.queryByText(/Changed by/)).not.toBeNull();
  expect(field.value).toBe("draft");
  app.handlers["pad.write"] = ({ text }) => padOf("notes", USER, text);
  fireEvent.click(screen.getByText("Keep mine"));
  await waitFor(() => expect(app.calls.filter((call) => call.method === "pad.write")).toHaveLength(2));
});

it("p2544b_project_switch_cannot_write_into_the_new_connection", async () => {
  const previous = await openShelf([padOf("notes", USER, "old project")]);
  const field = await openPad("notes");
  fireEvent.input(field, { target: { value: "previous project draft" } });
  cleanup();
  const next = await openShelf([padOf("notes", USER, "new project")]);
  const newField = await openPad("notes");
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  // Observation window after disposing the old Project's Drawer.
  await vi.advanceTimersByTimeAsync(1000);
  expect(previous.app.calls.filter((call) => call.method === "pad.write")).toEqual([
    { method: "pad.write", params: { name: "notes", text: "previous project draft", expectedRevision: 1, expectedIncarnation: "fixture-notes" } },
  ]);
  expect(next.calls()).not.toContain("pad.write");
  expect(newField.value).toBe("new project");
});

it("p2544b_keep_mine_waits_for_the_active_save", async () => {
  const { app, state } = await openShelf([padOf("notes", USER, "old")]);
  const field = await openPad("notes");
  const reply = deferred<Pad>();
  let writes = 0;
  app.handlers["pad.write"] = ({ text }) => ++writes === 1 ? reply.promise : padOf("notes", USER, text);
  fireEvent.input(field, { target: { value: "draft" } });
  fireEvent.focusOut(field);
  state.pads = [padOf("notes", USER, "agent append")];
  app.emit({ actor: AGENT, name: "pad.changed", data: { name: "notes" } });
  await screen.findByText(/Changed by/);
  fireEvent.click(screen.getByText("Keep mine"));
  expect(writes).toBe(1);
  reply.resolve(padOf("notes", USER, "draft"));
  await waitFor(() => expect(writes).toBe(2));
  expect(screen.queryByText(/Changed by/)).toBeNull();
});

it("p2544b_a_save_echo_cannot_replace_an_inflight_undo", async () => {
  const { app, state } = await openShelf([padOf("notes", USER, "old")]);
  const field = await openPad("notes");
  const reply = deferred<Pad>();
  let writes = 0;
  app.handlers["pad.write"] = ({ text }) => ++writes === 1 ? reply.promise : padOf("notes", USER, text);
  fireEvent.input(field, { target: { value: "first" } });
  fireEvent.focusOut(field);
  fireEvent.input(field, { target: { value: "old" } });
  state.pads = [padOf("notes", USER, "first")];
  app.emit({ actor: USER, name: "pad.changed", data: { name: "notes" } });
  await waitForReload(app);
  expect(field.value).toBe("old");
  reply.resolve(padOf("notes", USER, "first"));
  await reply.promise;
  await writeAdopted();
  fireEvent.focusOut(field);
  await waitFor(() => expect(app.calls.filter((call) => call.method === "pad.write")).toEqual([
    { method: "pad.write", params: { name: "notes", text: "first", expectedRevision: 1, expectedIncarnation: "fixture-notes" } },
    { method: "pad.write", params: { name: "notes", text: "old", expectedRevision: 1, expectedIncarnation: "fixture-notes" } },
  ]));
});

it("p2544c_ambiguous_mapping_never_writes_or_acknowledges_the_draft", async () => {
  const { app, state, connected } = await openShelf([padOf("notes", USER, "[ref]: https://example.com\n")]);
  const field = await openPad("notes");

  vi.useFakeTimers();
  fireEvent.input(field, { target: { value: "draft retained" } });
  await vi.advanceTimersByTimeAsync(500);
  fireEvent.focusOut(field);

  expect(app.calls.filter((call) => call.method === "pad.write")).toEqual([]);
  expect(state.pads[0]?.text).toBe("[ref]: https://example.com\n");
  expect(field.value).toBe("draft retained");
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
  vi.useRealTimers();
  connected.drawer.close("key");
  await waitFor(() => expect(screen.queryByRole("textbox", { name: "Pad body" })).toBeNull());
  cleanup();
  const restored = await openShelf([padOf("notes", USER, "[ref]: https://example.com\n")], false, true);
  const reopened = await openPad("notes");
  expect(reopened.value).toBe("draft retained");
  expect(connected.drafts.list().at(-1)?.value.base).toBe("[ref]: https://example.com\n");
  fireEvent.focusOut(reopened);
  expect([...app.calls, ...restored.app.calls].filter(call => call.method === "pad.write")).toEqual([]);
});

it.each([
  ["native root", '{"type":"paragraph","content":[{"type":"text","text":"draft retained"}]}'],
  ["invalid JSON", ""],
])("u2773e_invalid_editor_snapshot_preserves_stored_revision_%s", async (_kind, document) => {
  const { app } = await openShelf([padOf("notes", USER, "[ref]: https://example.com\n")]);
  const field = await openPad("notes");
  fireEvent.input(field, { target: { value: "draft retained" } });
  cleanup();
  const stored = JSON.parse(localStorage.getItem("roundup:drafts:/p")!);
  stored.drafts[0].value.document = document;
  const raw = JSON.stringify(stored);
  localStorage.setItem("roundup:drafts:/p", raw);
  const restored = await openShelf([padOf("notes", USER, "[ref]: https://example.com\n")], false, true);
  const reopened = await openPad("notes");
  await screen.findAllByRole("alert");
  expect(reopened.readOnly).toBe(true);
  expect(localStorage.getItem("roundup:drafts:/p")).toBe(raw);
  expect(restored.connected.drafts.list()[0]?.value.source).toBe("draft retained\n");
  expect([...app.calls, ...restored.app.calls].filter(call => call.method === "pad.write")).toEqual([]);
});
