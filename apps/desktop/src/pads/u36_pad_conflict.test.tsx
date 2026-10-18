import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AGENT,
  deferred,
  openPad,
  openShelf,
  padOf,
  waitForReload,
  writeAdopted,
} from "./padsFixture";
import { USER } from "../testing/nodes";
import type { Pad } from "@contracts/pad/Pad";

afterEach(cleanup);

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
  it("u36_a_dirty_draft_blur_sends_no_write", async () => {
    const { calls, field, state } = await openConflict();

    fireEvent.focusOut(field);

    expect(calls()).not.toContain("pad.write");
    expect(field.value).toBe("mine, edited");
    expect(state.pads[0]?.text).toBe("mine\nagent line");
  });

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
        { method: "pad.write", params: { name: "release-checklist", text: "mine, edited", expectedRevision: 1 } },
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

  it("u36_keep_mine_keeps_the_line_while_its_write_is_in_flight", async () => {
    const { app } = await openConflict();
    const reply = deferred<Pad>();
    app.handlers["pad.write"] = () => reply.promise;

    fireEvent.click(screen.getByText("Keep mine"));

    expect(screen.getByText("Changed by auth-refactor")).toBeTruthy();

    reply.resolve(padOf("release-checklist", USER, "mine, edited"));
    await waitFor(() => expect(screen.queryByText(/Changed by/)).toBeNull());
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
      name: "release-checklist", text: "mine, edited more", expectedRevision: 2,
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
    const { app, state } = await openShelf([
      padOf("release-checklist", USER, "mine"),
    ]);

    const field = await openPad("release-checklist");
    fireEvent.focus(field);
    fireEvent.input(field, { target: { value: "mine, typing" } });
    state.pads = [padOf("release-checklist", USER, "mine plus agent")];

    app.emit({
      actor: USER,
      name: "pad.changed",
      data: { name: "release-checklist" },
    });
    await waitForReload(app);

    expect(screen.queryByText(/Changed by/)).toBeNull();
    expect(field.value).toBe("mine, typing");
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
    { method: "pad.write", params: { name: "notes", text: "draft", expectedRevision: 4 } },
  ]));
});

it("p2544d_stale_write_without_event_keeps_draft", async () => {
  const { render } = await import("@solidjs/testing-library");
  const { App } = await import("../App");
  const { fakeEmulators } = await import("../terminal/paneHarness");
  const { startRealDaemon } = await import("../testing/realDaemonFixture");
  const { createServedApp } = await import("../testing/realSeam");
  const real = await startRealDaemon({});

  try {
    const served = createServedApp(real.base);
    const calls: { method: string; params: unknown }[] = [];

    // A missed Event is the fault under test; all reads and writes still reach the real Daemon.
    const app: typeof served = {
      ...served,
      subscribe: (listener) => served.subscribe((event) => { if (event.name !== "pad.changed") listener(event); }),
      rpc: (method, params) => {
        calls.push({ method, params });

        return served.rpc(method, params);
      },
      forProject: () => app,
    };

    const home = await served.rpc("rail.createWorkstream", { name: "review", parent: null });

    await served.rpc("pad.create", { name: "notes", text: "original" });
    await served.rpc("pad.move", { name: "notes", home: home.id });
    render(() => <App app={app} reducedMotion={() => false} clock={Date.now} createEmulator={fakeEmulators().factory} />);
    const { showEverythingInApp } = await import("../testing/showEverything");

    await showEverythingInApp(/review/);
    fireEvent.click(await screen.findByRole("tab", { name: "Pads" }));
    const field = await openPad("notes");

    await served.rpc("pad.append", { name: "notes", text: " remote" });
    fireEvent.input(field, { target: { value: "my draft" } });
    fireEvent.focusOut(field);
    await screen.findByText("Use theirs");
    await screen.findByText(/pad notes is at revision 2/);
    await waitFor(() => expect(calls.filter((call) => call.method === "pad.list").length).toBeGreaterThan(1));
    expect(field.value).toBe("my draft");
    expect(calls.filter((call) => call.method === "pad.write")).toEqual([
      { method: "pad.write", params: { name: "notes", text: "my draft", expectedRevision: 1 } },
    ]);
    expect(await served.rpc("pad.list", null)).toMatchObject([{ text: "original remote", revision: 2 }]);
    await served.rpc("pad.append", { name: "notes", text: " intervening" });
    fireEvent.click(screen.getByText("Keep mine"));
    await screen.findByText(/pad notes is at revision 3/);
    await waitFor(() => expect(calls.filter((call) => call.method === "pad.list")).toHaveLength(3));
    expect(calls.filter((call) => call.method === "pad.write").at(-1)?.params).toEqual({
      name: "notes", text: "my draft", expectedRevision: 2,
    });
    expect(field.value).toBe("my draft");
    await new Promise((done) => setTimeout(done, 550));
    expect(calls.filter((call) => call.method === "pad.write")).toHaveLength(2);
    fireEvent.click(screen.getByText("Use theirs"));
    await waitFor(() => expect(field.value).toBe("original remote intervening"));
    fireEvent.input(field, { target: { value: "after choice" } });
    fireEvent.focusOut(field);
    await waitFor(async () => expect(await served.rpc("pad.list", null)).toMatchObject([{ text: "after choice", revision: 4 }]));
    expect(calls.filter((call) => call.method === "pad.read")).toHaveLength(1);
  } finally {
    cleanup();
    await real.stop();
  }
}, 180_000);
