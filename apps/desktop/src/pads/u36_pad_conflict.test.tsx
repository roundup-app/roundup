import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AGENT,
  RpcError,
  deferred,
  openPad,
  openShelf,
  padOf,
  waitForReload,
  writeAdopted,
} from "./padsFixture";
import { DrawerHost } from "../drawer/DrawerHost";
import { PadDrawer } from "./PadDrawer";
import { ConnectedProjectContext } from "../state/connectedProject";
import { USER } from "../testing/nodes";
import type { Pad } from "@contracts/pad/Pad";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

/** The user owns `release-checklist`, edits it to a dirty draft, then another Actor's `pad.changed` arrives. */
const openConflict = async () => {
  const { app, state, calls } = await openShelf([
    padOf("release-checklist", USER, "mine"),
  ]);

  const field = await openPad("release-checklist");
  fireEvent.focus(field);
  fireEvent.input(field, { target: { value: "mine, edited" } });
  state.pads = [padOf("release-checklist", USER, "mine\nagent line")];
  app.emit({
    actor: AGENT,
    name: "pad.changed",
    data: { name: "release-checklist" },
  });
  await waitForReload(app);

  return { app, state, calls, field };
};

describe("u36 a pad edit never overwrites another actor's change", () => {
  // The first test pays the cold import and first render of the Shelf and Drawer (about 0.7 s warm, 5 s on a loaded runner); the rest take about 0.1 s.
  vi.setConfig({ testTimeout: 30_000 });

  // Rule 10: u36_typing_more_while_the_line_shows_keeps_the_line_and_blur_sends_no_write
  // also proves the initial notice; the appearance-only test remains retired to the rendered observer.
  // Rule 10: u36_typing_more_while_the_line_shows_keeps_the_line_and_blur_sends_no_write also proves dirty blur preserves work without a write.
  it("u36_typing_more_while_the_line_shows_keeps_the_line_and_blur_sends_no_write", async () => {
    const { calls, field, state } = await openConflict();

    fireEvent.input(field, { target: { value: "mine, edited more" } });
    fireEvent.focusOut(field);

    expect(screen.getByText("Changed by auth-refactor")).toBeTruthy();
    expect(calls()).not.toContain("pad.write");
    expect(field.value).toBe("mine, edited more");
    expect(state.pads[0]?.text).toBe("mine\nagent line");
  });

  it("u36_a_second_agents_change_after_blur_leaves_an_unresolved_conflicts_draft_untouched", async () => {
    const { app, field, state } = await openConflict();

    fireEvent.focusOut(field);

    state.pads = [padOf("release-checklist", USER, "mine\nagent line\nmore")];
    app.emit({
      actor: AGENT,
      name: "pad.changed",
      data: { name: "release-checklist" },
    });
    await waitForReload(app, 2);

    expect(field.value).toBe("mine, edited");
    expect(screen.getByText("Changed by auth-refactor")).toBeTruthy();
  });

  it("u36_showing_the_line_reads_nothing_from_the_daemon", async () => {
    const { calls } = await openConflict();

    expect(calls().filter((method) => method === "pad.read")).toHaveLength(1);
  });

  it("u36_keep_mine_writes_the_draft_and_clears_the_line", async () => {
    const { app, field, state } = await openConflict();

    fireEvent.focusOut(field);
    fireEvent.click(screen.getByText("Keep mine"));

    await waitFor(() =>
      expect(
        app.calls.filter((call) => call.method === "pad.write"),
      ).toEqual([
        { method: "pad.write", params: { name: "release-checklist", text: "mine, edited", expectedRevision: 1, expectedIncarnation: "fixture-release-checklist" } },
      ]),
    );
    expect(state.pads[0]?.text).toBe("mine, edited");
    expect(screen.queryByText(/Changed by/)).toBeNull();
  });

  it("u36_keep_mine_clears_the_line_without_a_blur_first", async () => {
    const { app } = await openConflict();

    fireEvent.click(screen.getByText("Keep mine"));

    await waitFor(() =>
      expect(app.calls.some((call) => call.method === "pad.write")).toBe(true),
    );
    expect(screen.queryByText(/Changed by/)).toBeNull();
  });

  it.each([false, true])("p2544d_pending_keep_mine_cannot_clear_a_newer_conflict_use_theirs_%s", async (useTheirsEarly) => {
    const { app, state, field } = await openConflict();
    const reply = deferred<Pad>();
    app.handlers["pad.write"] = () => reply.promise;

    fireEvent.click(screen.getByText("Keep mine"));
    expect(screen.getByText("Changed by auth-refactor")).toBeTruthy();
    state.pads = [{ ...padOf("release-checklist", USER, "newer external text"), revision: 3 }];
    app.emit({ actor: AGENT, name: "pad.changed", data: { name: "release-checklist" } });
    await waitForReload(app, 2);

    if (useTheirsEarly) fireEvent.click(screen.getByText("Use theirs"));

    reply.resolve({ ...padOf("release-checklist", USER, "mine, edited"), revision: 2 });
    await reply.promise;
    await writeAdopted();

    if (!useTheirsEarly) {
      expect(screen.getByText("Changed by auth-refactor")).toBeTruthy();
      fireEvent.click(screen.getByText("Use theirs"));
    }

    expect(field.value).toBe("newer external text");
    app.handlers["pad.write"] = ({ text }) => ({ ...padOf("release-checklist", USER, text), revision: 4 });
    fireEvent.input(field, { target: { value: "edited after choice" } });
    fireEvent.focusOut(field);
    await waitFor(() => expect(app.calls.filter((call) => call.method === "pad.write").at(-1)?.params).toEqual({
      name: "release-checklist", text: "edited after choice", expectedRevision: 3, expectedIncarnation: "fixture-release-checklist",
    }));
  });

  it("p2544d_conflict_choices_preserve_latest_draft", async () => {
    const { app, field } = await openConflict();
    const reply = deferred<Pad>();
    app.handlers["pad.write"] = () => reply.promise;

    fireEvent.click(screen.getByText("Keep mine"));
    await waitFor(() =>
      expect(app.calls.some((call) => call.method === "pad.write")).toBe(true),
    );

    fireEvent.focus(field);
    fireEvent.input(field, { target: { value: "mine, edited more" } });
    reply.resolve({ ...padOf("release-checklist", USER, "mine, edited"), revision: 2 });
    await reply.promise;
    await new Promise((done) => setTimeout(done, 0));

    expect(field.value).toBe("mine, edited more");
    app.handlers["pad.write"] = ({ text }) => ({ ...padOf("release-checklist", USER, text), revision: 3 });
    fireEvent.focusOut(field);
    await waitFor(() => expect(app.calls.filter((call) => call.method === "pad.write").at(-1)?.params).toEqual({
      name: "release-checklist", text: "mine, edited more", expectedRevision: 2, expectedIncarnation: "fixture-release-checklist",
    }));
  });

  it("u36_a_later_agent_change_refreshes_the_field_after_keep_mine_with_no_blur", async () => {
    const { app, field, state } = await openConflict();

    fireEvent.click(screen.getByText("Keep mine"));
    await waitFor(() =>
      expect(app.calls.some((call) => call.method === "pad.write")).toBe(true),
    );

    state.pads = [padOf("release-checklist", USER, "mine, edited\nagent again")];
    app.emit({
      actor: AGENT,
      name: "pad.changed",
      data: { name: "release-checklist" },
    });

    await waitFor(() =>
      expect(field.value).toBe("mine, edited\nagent again"),
    );
    expect(screen.queryByText(/Changed by/)).toBeNull();
  });

  it("u36_leaving_the_field_after_keep_mine_with_no_blur_sends_no_second_write", async () => {
    const { app, field } = await openConflict();

    fireEvent.click(screen.getByText("Keep mine"));
    await waitFor(() =>
      expect(
        app.calls.filter((call) => call.method === "pad.write").length,
      ).toBe(1),
    );

    fireEvent.focusOut(field);
    await new Promise((done) => setTimeout(done, 0));

    expect(
      app.calls.filter((call) => call.method === "pad.write"),
    ).toHaveLength(1);
  });

  it("u36_use_theirs_loads_the_latest_text_and_calls_nothing_else", async () => {
    const { app, field, state } = await openConflict();

    fireEvent.focusOut(field);
    const before = app.calls.length;
    fireEvent.click(screen.getByText("Use theirs"));

    expect(field.value).toBe("mine\nagent line");
    expect(app.calls.length).toBe(before);
    expect(state.pads[0]?.text).toBe("mine\nagent line");
    expect(screen.queryByText(/Changed by/)).toBeNull();
  });

  it("u36_typing_back_to_the_original_text_clears_the_changed_by_line", async () => {
    const { field } = await openConflict();

    expect(screen.getByText("Changed by auth-refactor")).toBeTruthy();

    fireEvent.input(field, { target: { value: "mine" } });

    expect(screen.queryByText(/Changed by/)).toBeNull();
    expect(field.value).toBe("mine\nagent line");
  });

  it("u36_a_clean_draft_refreshes_immediately_even_while_focused", async () => {
    const { app, state } = await openShelf([
      padOf("release-checklist", USER, "mine"),
    ]);

    const field = await openPad("release-checklist");
    fireEvent.focus(field);
    fireEvent.input(field, { target: { value: "mine" } });
    state.pads = [padOf("release-checklist", USER, "mine plus agent")];

    app.emit({
      actor: AGENT,
      name: "pad.changed",
      data: { name: "release-checklist" },
    });

    await waitFor(() => expect(field.value).toBe("mine plus agent"));
    expect(screen.queryByText(/Changed by/)).toBeNull();
  });

  it("u36_the_users_own_write_echo_never_shows_the_line", async () => {
    const { app, state } = await openShelf([padOf("release-checklist", USER, "mine")]);
    const reply = deferred<Pad>();
    app.handlers["pad.write"] = () => reply.promise;
    const field = await openPad("release-checklist");
    fireEvent.input(field, { target: { value: "submitted" } });
    fireEvent.focusOut(field);
    fireEvent.input(field, { target: { value: "mine, typing" } });
    state.pads = [{ ...padOf("release-checklist", USER, "submitted"), revision: 2 }];
    app.emit({ actor: USER, name: "pad.changed", data: { name: "release-checklist" } });
    await waitForReload(app);
    expect(screen.queryByText(/Changed by/)).toBeNull();
    expect(field.value).toBe("mine, typing");
    reply.resolve(state.pads[0]!);
    await reply.promise;
    await writeAdopted();
  });

  it("u36_a_pad_changed_for_another_pad_never_attributes_a_conflict_actor", async () => {
    const { app, state } = await openShelf([
      padOf("release-checklist", USER, "mine"),
    ]);

    const field = await openPad("release-checklist");
    fireEvent.focus(field);
    fireEvent.input(field, { target: { value: "mine, edited" } });
    state.pads = [padOf("release-checklist", USER, "mine\nagent line")];

    app.emit({
      actor: AGENT,
      name: "pad.changed",
      data: { name: "other-pad" },
    });
    await waitForReload(app);

    expect(screen.queryByText(/Changed by/)).toBeNull();
    expect(field.value).toBe("mine, edited");
  });

  it("u36_a_conflict_line_clears_when_the_pad_is_deleted", async () => {
    const { app, state } = await openConflict();

    state.pads = [];
    app.emit({
      actor: AGENT,
      name: "pad.changed",
      data: { name: "release-checklist" },
    });

    await screen.findByText(/was deleted/);
    expect(screen.queryByText(/Changed by/)).toBeNull();
  });

  it("u36_a_pad_changed_with_no_content_change_does_not_show_the_line", async () => {
    const { app } = await openShelf([
      padOf("release-checklist", USER, "mine"),
    ]);

    const field = await openPad("release-checklist");
    fireEvent.focus(field);
    fireEvent.input(field, { target: { value: "mine, edited" } });

    app.emit({
      actor: AGENT,
      name: "pad.changed",
      data: { name: "release-checklist" },
    });
    await waitForReload(app);

    expect(screen.queryByText(/Changed by/)).toBeNull();
    expect(field.value).toBe("mine, edited");
  });

  it("u36_a_stale_conflict_actor_is_not_reused_for_a_later_unrelated_reload", async () => {
    const { app, state } = await openShelf([
      padOf("release-checklist", USER, "mine"),
    ]);

    const field = await openPad("release-checklist");
    fireEvent.focus(field);
    fireEvent.input(field, { target: { value: "mine, edited" } });

    app.emit({
      actor: AGENT,
      name: "pad.changed",
      data: { name: "release-checklist" },
    });
    await waitForReload(app);
    expect(screen.queryByText(/Changed by/)).toBeNull();

    state.pads = [padOf("release-checklist", USER, "mine\nagent line")];
    app.emit({
      actor: AGENT,
      name: "pad.changed",
      data: { name: "other-pad" },
    });
    await waitForReload(app, 2);

    expect(screen.queryByText(/Changed by/)).toBeNull();
    expect(field.value).toBe("mine, edited");
  });

  it("u36_a_reload_with_no_tracked_actor_does_not_clear_a_showing_conflict_line", async () => {
    const { app, state } = await openConflict();

    state.pads = [padOf("release-checklist", USER, "mine\nagent line\nmore")];
    app.emit({
      actor: AGENT,
      name: "pad.changed",
      data: { name: "other-pad" },
    });
    await waitForReload(app, 2);

    expect(screen.getByText("Changed by auth-refactor")).toBeTruthy();
  });

  it("u36_a_save_that_settles_while_editing_moves_the_starting_text_forward_without_disturbing_the_draft", async () => {
    const { app } = await openShelf([
      padOf("release-checklist", USER, "old"),
    ]);

    const reply = deferred<Pad>();
    app.handlers["pad.write"] = () => reply.promise;

    const field = await openPad("release-checklist");
    fireEvent.focus(field);
    fireEvent.input(field, { target: { value: "new" } });
    fireEvent.focusOut(field);
    fireEvent.focus(field);
    fireEvent.input(field, { target: { value: "newer" } });
    reply.resolve(padOf("release-checklist", USER, "new"));
    await reply.promise;
    await writeAdopted();

    fireEvent.input(field, { target: { value: "old" } });

    expect(field.value).toBe("old");
    expect(screen.queryByText(/Changed by/)).toBeNull();
  });

  it("u36_a_save_that_settles_while_editing_lets_typing_back_to_the_saved_text_refresh_on_another_actors_change", async () => {
    const { app, state } = await openShelf([
      padOf("release-checklist", USER, "old"),
    ]);

    const reply = deferred<Pad>();
    app.handlers["pad.write"] = () => reply.promise;

    const field = await openPad("release-checklist");
    fireEvent.focus(field);
    fireEvent.input(field, { target: { value: "new" } });
    fireEvent.focusOut(field);
    fireEvent.focus(field);
    fireEvent.input(field, { target: { value: "newer" } });
    reply.resolve(padOf("release-checklist", USER, "new"));
    await reply.promise;
    await writeAdopted();

    fireEvent.input(field, { target: { value: "new" } });
    state.pads = [padOf("release-checklist", USER, "new plus agent")];
    app.emit({
      actor: AGENT,
      name: "pad.changed",
      data: { name: "release-checklist" },
    });

    await waitFor(() => expect(field.value).toBe("new plus agent"));
    expect(screen.queryByText(/Changed by/)).toBeNull();
  });

  it("u36_use_theirs_redraws_the_field_when_the_latest_text_matches_a_stale_draft_baseline", async () => {
    const { app, state } = await openShelf([
      padOf("release-checklist", USER, "mine"),
    ]);

    const field = await openPad("release-checklist");
    fireEvent.focus(field);
    fireEvent.input(field, { target: { value: "mine, edited" } });
    state.pads = [padOf("release-checklist", USER, "x")];
    app.emit({
      actor: AGENT,
      name: "pad.changed",
      data: { name: "release-checklist" },
    });
    await waitForReload(app);
    state.pads = [padOf("release-checklist", USER, "mine")];
    app.emit({
      actor: AGENT,
      name: "pad.changed",
      data: { name: "release-checklist" },
    });
    await waitForReload(app, 2);

    fireEvent.click(screen.getByText("Use theirs"));

    expect(field.value).toBe("mine");
    expect(screen.queryByText(/Changed by/)).toBeNull();

    fireEvent.focusOut(field);

    expect(app.calls.some((call) => call.method === "pad.write")).toBe(false);
    expect(state.pads[0]?.text).toBe("mine");
  });

  it("u36_a_change_that_lands_while_a_save_from_an_earlier_edit_is_still_in_flight_redraws_the_field_even_when_it_matches_the_stale_draft", async () => {
    const { app, state } = await openShelf([
      padOf("release-checklist", USER, "mine"),
    ]);

    const reply = deferred<Pad>();
    app.handlers["pad.write"] = () => reply.promise;

    const field = await openPad("release-checklist");
    fireEvent.focus(field);
    fireEvent.input(field, { target: { value: "mine, edited" } });
    fireEvent.focusOut(field);
    fireEvent.focus(field);
    fireEvent.input(field, { target: { value: "mine, edited" } });
    reply.resolve(padOf("release-checklist", USER, "mine, edited"));
    await reply.promise;
    await writeAdopted();

    state.pads = [padOf("release-checklist", USER, "mine")];
    app.emit({
      actor: AGENT,
      name: "pad.changed",
      data: { name: "release-checklist" },
    });
    await waitForReload(app);

    expect(field.value).toBe("mine");

    fireEvent.focusOut(field);

    expect(app.calls.filter((call) => call.method === "pad.write")).toHaveLength(1);
    expect(state.pads[0]?.text).toBe("mine");
  });

  it("u36_an_unrelated_event_sharing_the_pads_name_is_never_mistaken_for_a_pad_changed", async () => {
    const { app, state } = await openShelf([
      padOf("release-checklist", USER, "mine"),
    ]);

    const field = await openPad("release-checklist");
    fireEvent.focus(field);
    fireEvent.input(field, { target: { value: "mine, edited" } });
    state.pads = [padOf("release-checklist", USER, "mine\nagent line")];
    app.emit({
      actor: AGENT,
      name: "pad.changed",
      data: { name: "release-checklist" },
    });
    // SAFETY: no real Event member carries `data.name`, except pad.changed itself, so this
    // shape is built the way a boundary value would arrive (round-tripped through JSON, as
    // the Daemon's own notifications do) rather than asserted straight from an object literal.
    // Fired in the same tick, before pad.list's reply resolves and the effect reads
    // pendingActor: it proves the subscribe filter at PadDrawer.tsx:58 keys on event.name,
    // not just the coincidence that data.name matches the Pad's name.

    // JSON.parse returns `any`, so `impostor` carries no asserted type here; the contract's
    // `rail.changed` variant has no `data`, and a cast would force a shape the type checker
    // has already proven wrong.
    const impostor = JSON.parse(
      JSON.stringify({
        actor: USER,
        name: "rail.changed",
        data: { name: "release-checklist" },
      }),
    );

    app.emit(impostor);
    await waitForReload(app);

    expect(screen.getByText("Changed by auth-refactor")).toBeTruthy();
    expect(field.value).toBe("mine, edited");
  });
});

it("p2544d_external_change_pauses_autosave", async () => {
  const { app, state } = await openShelf([{ ...padOf("notes", USER, "mine"), revision: 3 }]);
  const field = await openPad("notes");
  fireEvent.input(field, { target: { value: "draft" } });
  state.pads = [{ ...padOf("notes", USER, "remote"), revision: 4 }];
  app.emit({ actor: AGENT, name: "pad.changed", data: { name: "notes" } });
  await waitForReload(app);
  await new Promise((done) => setTimeout(done, 550));
  fireEvent.focusOut(field);
  expect(app.calls.filter((call) => call.method === "pad.write")).toEqual([]);
  fireEvent.click(screen.getByText("Keep mine"));
  await waitFor(() => expect(app.calls.filter((call) => call.method === "pad.write")).toEqual([
    { method: "pad.write", params: { name: "notes", text: "draft", expectedRevision: 4, expectedIncarnation: "fixture-notes" } },
  ]));
});


it("p2544d_failed_conflict_reload_surfaces_reload_failure", async () => {
  const { app, state } = await openShelf([padOf("notes", USER, "original")]);
  const field = await openPad("notes");

  app.handlers["pad.write"] = () => {
    state.pads = [{ ...padOf("notes", USER, "external"), revision: 2 }];

    app.handlers["pad.list"] = () => { throw new Error("reload unavailable"); };

    throw new RpcError(-32003, "stale revision");
  };

  fireEvent.input(field, { target: { value: "draft" } });
  fireEvent.focusOut(field);
  await screen.findByText("Use theirs");
  await waitForReload(app);

  await within(screen.getByLabelText("Drawer")).findByText(/reload unavailable/);

  expect(screen.queryByText(/stale revision/)).toBeNull();
  expect(field.value).toBe("draft");

});

it("u2773a_pads_restores_exact_work", async () => {
  const { connected, app } = await openShelf([padOf("retained", USER, "  original\n\n")]);
  app.handlers["pad.write"] = () => deferred<Pad>().promise;
  const field = await openPad("retained");
  fireEvent.input(field, { target: { value: "unfinished 🌱 é\nsecond" } });
  field.setSelectionRange(2, 9, "backward");
  const record = connected.drafts.list().find(draft => draft.destination.surface === "pads" && draft.destination.object === "fixture-retained");
  expect(record?.value).toMatchObject({ originalName: "retained", source: "  unfinished 🌱 é\nsecond\n\n", base: "  original\n\n" });
  connected.drawer.close("key");
  await waitFor(() => expect(screen.queryByRole("textbox", { name: "Pad body" })).toBeNull());
  const before = app.calls.filter(call => call.method === "pad.write").length;
  const reopened = await openPad("retained");
  expect(reopened.value).toBe("unfinished 🌱 é\nsecond");
  expect([reopened.selectionStart, reopened.selectionEnd, reopened.selectionDirection]).toEqual([2, 9, "backward"]);
  fireEvent.focusOut(reopened);
  expect(app.calls.filter(call => call.method === "pad.write")).toHaveLength(before);
  expect(screen.getByRole("button", { name: "Resume" })).toBeTruthy();
});

it.each(["acknowledged", "failed", "unknown"])("u2773b_pads_settlement_preserves_other_revisions_%s", async (outcome) => {
  const { app, connected } = await openShelf([padOf("settlement", USER, "base")]);
  const reply = deferred<Pad>();
  app.handlers["pad.write"] = () => reply.promise;
  const field = await openPad("settlement");
  fireEvent.input(field, { target: { value: "revision A 🌱" } });
  fireEvent.focusOut(field);
  fireEvent.input(field, { target: { value: "revision B é" } });

  if (outcome === "acknowledged") reply.resolve({ ...padOf("settlement", USER, "revision A 🌱"), revision: 2 });
  else reply.reject(outcome === "failed" ? new RpcError(-32602, "refused") : new Error("disconnected"));
  await waitFor(() => expect(connected.drafts.list().some(draft => draft.status === "pending")).toBe(false));
  expect(field.value).toBe("revision B é");
  field.setSelectionRange(2, 3, "forward");
  expect(connected.drafts.list().at(-1)?.value).toMatchObject({ base: "base", baseRevision: 1 });
  expect(connected.drafts.list().map(draft => [draft.value.source, draft.status])).toEqual(outcome === "acknowledged" ? [["revision B é", "draft"]] : [["revision A 🌱", outcome], ["revision B é", "draft"]]);
  const older = connected.drafts.list().find(draft => draft.status === outcome);

  if (older) connected.drafts.discard(older.revision);
  expect(connected.drafts.list().at(-1)?.value.source).toBe("revision B é");
  expect(app.calls.filter(call => call.method === "pad.write")).toHaveLength(1);
});

it("u2773c_pads_external_change_keeps_original", async () => {
  const { app, state, connected } = await openShelf([padOf("original", USER, "base")]);
  const field = await openPad("original");
  fireEvent.input(field, { target: { value: "dirty é 🪁" } });
  state.pads = [{ ...padOf("original", USER, "replacement"), incarnation: "replacement" }];
  app.emit({ name: "pad.changed", actor: USER, data: { name: "original" } });
  await screen.findByRole("alert");
  fireEvent.focusOut(field);
  expect(field.value).toBe("dirty é 🪁");
  expect(connected.drafts.list().at(-1)).toMatchObject({ destination: { object: "fixture-original" }, value: { base: "base", baseRevision: 1, originalName: "original", source: "dirty é 🪁" } });
  expect(app.calls.filter(call => call.method === "pad.write")).toEqual([]);
});

it("u2773e_recovery_actions_keep_surface_draft", async () => {
  const { app, connected } = await openShelf([padOf("retention", USER, "base")]);
  const field = await openPad("retention");
  const write = Storage.prototype.setItem;
  const stored = localStorage.getItem("roundup:drafts:/p");

  const writes = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
    if (key === "roundup:drafts:/p") throw new Error("disk full");
    write.call(this, key, value);
  });

  fireEvent.input(field, { target: { value: "recoverable é 🪁" } });
  const body = within(document.querySelector<HTMLElement>(".pad-body")!);
  expect(body.getByRole("alert")).toBeTruthy();
  expect(localStorage.getItem("roundup:drafts:/p")).toBe(stored);
  const clipboard = vi.fn(async () => {});
  vi.spyOn(app, "clipboardWrite").mockImplementation(clipboard);
  fireEvent.click(body.getByRole("button", { name: "Copy source" }));
  expect(clipboard).toHaveBeenCalledWith("recoverable é 🪁");
  writes.mockRestore();
  const before = app.calls.filter(call => call.method === "pad.write").length;
  fireEvent.click(body.getByRole("button", { name: "Retry storage only" }));
  expect(connected.drafts.problem()).toBeNull();
  expect(JSON.parse(localStorage.getItem("roundup:drafts:/p")!).drafts.at(-1).value.source).toBe("recoverable é 🪁");
  expect(app.calls.filter(call => call.method === "pad.write")).toHaveLength(before);

  // A later retention failure exposes selected discard at the owning editor.
  const failedAgain = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
    if (key === "roundup:drafts:/p") throw new Error("disk full");
    write.call(this, key, value);
  });

  fireEvent.input(field, { target: { value: "selected" } });
  fireEvent.click(body.getByRole("button", { name: "Discard this revision" }));
  expect(connected.drafts.list()).toEqual([]);
  expect(field.value).toBe("base");
  failedAgain.mockRestore();
});


it("u2773b_pads_late_failure_keeps_original_Project", async () => {
  const first = await openShelf([padOf("same-name", USER, "base")], false, false, "/first");
  const reply = deferred<Pad>();
  first.app.handlers["pad.write"] = () => reply.promise;
  const field = await openPad("same-name");
  fireEvent.input(field, { target: { value: "A é" } });
  fireEvent.focusOut(field);
  fireEvent.input(field, { target: { value: "B 🪁" } });
  cleanup();
  const other = await openShelf([padOf("same-name", USER, "other base")], false, false, "/second");
  const otherField = await openPad("same-name");
  fireEvent.input(otherField, { target: { value: "other current" } });
  reply.reject(new RpcError(-32602, "refused"));
  await waitFor(() => expect(first.connected.drafts.list()[0]?.status).toBe("failed"));
  expect(first.connected.drafts.list().map(draft => [draft.value.source, draft.status])).toEqual([["A é", "failed"], ["B 🪁", "draft"]]);
  expect(other.connected.drafts.list().at(-1)?.value).toMatchObject({ source: "other current", base: "other base" });
  expect(otherField.value).toBe("other current");
  expect(first.app.calls.filter(call => call.method === "pad.write")).toHaveLength(1);
  expect(other.app.calls.filter(call => call.method === "pad.write")).toHaveLength(0);
  first.connected.drafts.discard(first.connected.drafts.list()[0]!.revision);
  expect(first.connected.drafts.list().at(-1)?.value.source).toBe("B 🪁");
  expect(other.connected.drafts.list().at(-1)?.value.source).toBe("other current");
});

it("u2773b_pads_matching_source_does_not_acknowledge_an_unknown_write", async () => {
  const { app, connected, state } = await openShelf([padOf("unknown", USER, "base")]);
  app.handlers["pad.write"] = ({ text }) => {
    state.pads = [{ ...state.pads[0]!, text, revision: 2 }];
    throw new Error("reply lost");
  };

  const field = await openPad("unknown");
  fireEvent.input(field, { target: { value: "submitted é" } });
  fireEvent.focusOut(field);
  await waitFor(() => expect(connected.drafts.list()[0]?.status).toBe("unknown"));
  const snapshot = connected.drafts.list()[0]!;
  connected.drawer.close("key");
  await waitFor(() => expect(screen.queryByRole("textbox", { name: "Pad body" })).toBeNull());
  await openPad("unknown");
  fireEvent.click(screen.getByRole("button", { name: "Resume" }));
  await within(screen.getByLabelText("Drawer")).findByRole("alert");
  expect(connected.drafts.list()).toEqual([snapshot]);
  expect(app.calls.filter(call => call.method === "pad.write")).toHaveLength(1);
  expect(state.pads[0]?.text).toBe("submitted é");
});


it.each(["failed", "unknown"] as const)("u3021c_open_restores_exact_revision_without_rpc_pads_%s", async (outcome) => {
  const original = padOf("selected", USER, "  base\n\n");
  const { app, connected } = await openShelf([original]);
  const destination = { surface: "pads", object: original.incarnation, recipient: null };
  const value = { originalName: original.name, source: "  A 🌱 é\nsecond\n\n", base: original.text, baseRevision: 1 };
  const a = connected.drafts.edit(destination, value, { start: 2, end: 9, direction: "backward" }, "ordinary").draft;
  connected.drafts.submit(a.revision);
  connected.drafts.edit(destination, { ...value, source: "B 🪁" }, { start: 1, end: 2, direction: "forward" }, "ordinary");
  connected.drafts.settle(a.revision, outcome);
  const retained = structuredClone(connected.drafts.list());
  // Recovery can mount with loaded facts after the ordinary Shelf has gone away.
  cleanup();
  render(() => <ConnectedProjectContext.Provider value={connected}><DrawerHost drawer={connected.drawer} reducedMotion={() => true} /></ConnectedProjectContext.Provider>);
  const calls = [...app.calls];
  const field = await openPad(original.name, { connected, pads: [original], revision: a.revision });
  expect(field.value).toBe("A 🌱 é\nsecond");
  expect([field.selectionStart, field.selectionEnd, field.selectionDirection]).toEqual([2, 9, "backward"]);
  fireEvent.focusOut(field);
  connected.drawer.close("key");
  await waitFor(() => expect(screen.queryByRole("textbox", { name: "Pad body" })).toBeNull());
  expect(app.calls).toEqual(calls);
  expect(connected.drafts.list()).toEqual(retained);
  const b = retained.at(-1)!;
  const editing = await openPad(original.name, { connected, pads: [original], revision: a.revision });
  editing.setSelectionRange(3, 5, "forward");
  expect(connected.drafts.list()).toContainEqual(b);
  fireEvent.input(editing, { target: { value: "edited A 🌱" } });
  connected.drawer.close("key");
  await waitFor(() => expect(screen.queryByRole("textbox", { name: "Pad body" })).toBeNull());
  const { draftStorage } = await import("../state/storage");
  const durable = draftStorage(connected.project.path).list();
  expect(durable).toContainEqual(b);
  expect(durable.some(draft => draft.value.source === "  edited A 🌱\n\n")).toBe(true);
  const afterEditing = connected.drafts.list();
  const reopened = await openPad(original.name, { connected, pads: [original], revision: b.revision });
  expect(reopened.value).toBe("B 🪁");
  expect(connected.drafts.list()).toEqual(afterEditing);
  expect(app.calls).toEqual(calls);
});


it.each(["Project", "facts-Project", "incarnation", "removed", "name", "unloaded", "failed-list"])("u3021c_open_refuses_unavailable_original_pad_%s", async (mismatch) => {
  const original = padOf("identity", USER, "base");
  const first = await openShelf([original]);
  const a = first.connected.drafts.edit({ surface: "pads", object: original.incarnation, recipient: null }, { originalName: original.name, source: "retained", base: "base", baseRevision: 1 }, null, "ordinary").draft;
  let target = first;

  if (mismatch === "Project") {
    cleanup();
    target = await openShelf([original], false, false, "/other");
  }

  const pads = mismatch === "removed" ? [] : mismatch === "incarnation" ? [{ ...original, incarnation: "replacement" }] : [original];
  const calls = [...target.app.calls];
  const connected = target.connected;
  connected.drawer.open(() => <ConnectedProjectContext.Provider value={connected}><PadDrawer name={mismatch === "name" ? "different" : original.name} recovery={{ project: mismatch === "facts-Project" ? "/other" : connected.project.path, revision: a.revision, list: { pads: () => pads, loaded: () => mismatch !== "unloaded", failure: () => mismatch === "failed-list" ? "disconnected" : null, reload: async () => {} } }} pads={() => pads} onLateFailure={() => {}} /></ConnectedProjectContext.Provider>, "key");
  expect(screen.queryByRole("textbox", { name: "Pad body" })).toBeNull();
  expect(target.app.calls).toEqual(calls);
  expect(first.connected.drafts.list()).toEqual([a]);
});

it.each(["failed", "unknown"] as const)("u3021c_resume_selected_pad_keeps_authorization_%s", async (outcome) => {
  const original = padOf("resume-selected", USER, "base");
  const { app, connected } = await openShelf([original]);
  const destination = { surface: "pads", object: original.incarnation, recipient: null };
  const a = connected.drafts.edit(destination, { originalName: original.name, source: "  A 🌱 é\nsecond\n\n", base: "base", baseRevision: 1 }, null, "ordinary").draft;
  connected.drafts.submit(a.revision);
  const b = connected.drafts.edit(destination, { ...a.value, source: "B 🪁" }, null, "ordinary").draft;
  connected.drafts.settle(a.revision, outcome);
  await openPad(original.name, { connected, pads: [original], revision: a.revision });
  const before = app.calls.length;
  fireEvent.click(screen.getByRole("button", { name: "Resume" }));

  if (outcome === "unknown") {
    await screen.findByRole("alert");
    expect(app.calls.slice(before)).toEqual([{ method: "pad.read", params: { name: original.name } }]);
    expect(connected.drafts.list()[0]?.status).toBe("unknown");
  } else {
    await waitFor(() => expect(connected.drafts.list()).toEqual([b]));
    expect(app.calls.slice(before)).toEqual([{ method: "pad.write", params: { name: original.name, text: "  A 🌱 é\nsecond\n\n", expectedRevision: 1, expectedIncarnation: original.incarnation } }]);
  }

  expect(connected.drafts.list().at(-1)).toEqual(b);
});
