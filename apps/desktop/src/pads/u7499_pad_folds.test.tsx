import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import type { Pad } from "@contracts/pad/Pad";
import { afterEach, describe, expect, it } from "vitest";
import { AGENT, openPad, openShelf, padOf } from "./padsFixture";
import { padReadStorage } from "./padRead";
import { agent, workstream } from "../testing/nodes";
import { mountRail, settled } from "../rail/railFixture";

afterEach(cleanup);

const DAY = 86_400_000;

const NOW = 20 * DAY;

const pad = (name: string, changes: Partial<Pad> = {}): Pad => ({ ...padOf(name, AGENT), updated_at: NOW - DAY, ...changes });


const rows = () => [...document.querySelectorAll<HTMLElement>("[data-shelf-row]")].map(row => row.getAttribute("data-pad"));

const foldOrNull = (kind: "internal" | "idle") => document.querySelector<HTMLButtonElement>(`.pad-fold[data-fold="${kind}"]`);

const fold = (kind: "internal" | "idle") => {
  const found = foldOrNull(kind);

  if (!found) throw new Error(`no ${kind} fold`);

  return found;
};

/** The name button of the Pad's row. */
// A double-click on a name renames it (U7641a); the rest of the row opens the Pad.
const rowOf = (name: string) => {
  const found = document.querySelector<HTMLElement>(`[data-pad="${name}"]`);

  if (!found) throw new Error(`no row for ${name}`);

  return found;
};

const nameOf = (name: string) => {
  const found = document.querySelector<HTMLElement>(`[data-pad="${name}"] .pad-name`);

  if (!found) throw new Error(`no row for ${name}`);

  return found;
};

/** The number a fold row or a group header shows. */
const count = (element: Element | null) => Number(element?.textContent?.match(/\d+/)?.[0]);

const mark = (kind: "new" | "changed") => document.querySelectorAll(`.pad-mark[data-mark="${kind}"]`).length;

/** Four Pads: internal, read, eight days old, and fresh-unread. */
const mixed = () => [
  pad("hidden-by-agent", { visibility: "internal" }),
  pad("already-read"),
  pad("eight-days-old", { updated_at: NOW - 8 * DAY }),
  pad("fresh-unread"),
];

const open = () => openShelf(mixed(), false, false, "/p", { now: NOW, read: { "fixture-already-read": "1" } });

describe("u7499 Pad folds", () => {
  it("u7499a_a_pad_sits_in_the_fold_its_visibility_and_age_choose", async () => {
    await open();
    expect(rows()).toEqual(["fresh-unread"]);
    fireEvent.click(fold("internal"));
    fireEvent.click(fold("idle"));
    await waitFor(() => expect(rows().sort()).toEqual(["already-read", "eight-days-old", "fresh-unread", "hidden-by-agent"]));
  });

  it("u7499a_folds_start_closed_and_counts_match", async () => {
    await open();
    expect(count(fold("internal"))).toBe(1);
    expect(count(fold("idle"))).toBe(2);
    expect(fold("idle").getAttribute("aria-expanded")).toBe("false");
    expect(count(document.querySelector(".shelf-group-count"))).toBe(4);
    fireEvent.click(fold("idle"));
    await waitFor(() => expect(fold("idle").getAttribute("aria-expanded")).toBe("true"));
    fireEvent.keyDown(fold("idle"), { key: "ArrowLeft" });
    await waitFor(() => expect(fold("idle").getAttribute("aria-expanded")).toBe("false"));
  });

  it("u7499a_a_never_read_pad_has_the_new_dot", async () => {
    await open();
    expect(mark("new")).toBe(1);
    expect(document.querySelectorAll("[data-shelf-row] .pad-mark-slot")).toHaveLength(1);
  });

  it("u7499a_a_pad_changed_since_the_read_has_the_changed_dot", async () => {
    await openShelf([pad("seen-before", { revision: 2 })], false, false, "/p", { now: NOW, read: { "fixture-seen-before": "1" } });
    expect(mark("changed")).toBe(1);
  });

  it("u7499b_the_read_record_survives_a_reload_per_project", async () => {
    await openShelf([pad("a")], false, false, "/one", { now: NOW, read: {} });
    fireEvent.dblClick(rowOf("a"));
    await waitFor(() => expect(padReadStorage("/one").read()).toEqual({ "fixture-a": "1" }));
    expect(padReadStorage("/two").read()).toBeNull();
  });

  it("u7499b_selecting_a_row_never_counts_as_reading", async () => {
    await open();
    const name = nameOf("fresh-unread");
    fireEvent.click(name);
    fireEvent.keyDown(name, { key: "ArrowDown" });
    expect(padReadStorage("/p").read()).toEqual({ "fixture-already-read": "1" });
    expect(mark("new")).toBe(1);
  });

  it("u7499b_a_pad_opened_from_an_open_fold_keeps_its_row_and_fold", async () => {
    const { connected } = await open();
    fireEvent.click(fold("internal"));
    await waitFor(() => nameOf("hidden-by-agent"));
    fireEvent.dblClick(rowOf("hidden-by-agent"));
    await waitFor(() => expect(connected.drawer.content()).not.toBeNull());
    expect(count(fold("internal"))).toBe(1);
    expect(nameOf("hidden-by-agent")).not.toBeNull();
    connected.drawer.close();
    await waitFor(() => expect(count(fold("internal"))).toBe(1));
  });

  it("u7499b_a_pad_opened_from_an_open_fold_is_lifted_out_when_the_fold_closes", async () => {
    const { connected } = await open();
    fireEvent.click(fold("idle"));
    await waitFor(() => nameOf("eight-days-old"));
    fireEvent.dblClick(rowOf("eight-days-old"));
    await waitFor(() => expect(connected.drawer.content()).not.toBeNull());
    fireEvent.click(fold("idle"));
    await waitFor(() => expect(fold("idle").getAttribute("aria-expanded")).toBe("false"));
    expect(rows()).toContain("eight-days-old");
    expect(count(fold("idle"))).toBe(1);
  });

  it("u7499b_each_way_of_opening_records_the_revision", async () => {
    await open();
    fireEvent.dblClick(rowOf("fresh-unread"));
    await waitFor(() => expect(padReadStorage("/p").read()).toMatchObject({ "fixture-fresh-unread": "1" }));
  });
  it("u7499a_the_first_load_lists_no_pad_above_the_folds", async () => {
    // No saved record for this Project: the first answered list counts every Pad as read.
    await openShelf([pad("a"), pad("b")], false, false, "/fresh", { now: NOW, read: null });
    await waitFor(() => expect(count(fold("idle"))).toBe(2));
    expect(rows()).toEqual([]);
  });

  it("u7499a_an_agent_write_after_the_read_lists_the_pad_above_the_folds", async () => {
    const { app, state } = await open();
    state.pads = state.pads.map(each => each.name === "already-read" ? { ...each, revision: 2, updated_at: NOW } : each);
    app.emit({ actor: AGENT, name: "pad.changed", data: { name: "already-read" } });
    await waitFor(() => expect(rows()).toContain("already-read"));
    expect(mark("changed")).toBe(1);
  });

  it("u7499b_leaving_a_pad_returns_it_to_its_fold", async () => {
    const { connected } = await open();
    fireEvent.click(fold("idle"));
    await waitFor(() => nameOf("already-read"));
    fireEvent.dblClick(rowOf("already-read"));
    await waitFor(() => expect(connected.drawer.content()).not.toBeNull());
    connected.drawer.close();
    await waitFor(() => expect(count(fold("idle"))).toBe(2));
  });

  it("u7499a_the_pads_fold_row_is_the_rails_fold_row", async () => {
    // What a user perceives of a fold row: its accessible name and `aria-expanded`, after a click and after Right and Left.
    const walk = async (find: () => HTMLElement) => {
      const seen = () => [find().getAttribute("aria-expanded"), find().textContent?.replace(/\s+/g, "")];
      const trail = [seen()];

      fireEvent.click(find());
      await waitFor(() => expect(find().getAttribute("aria-expanded")).toBe("true"));
      trail.push(seen());
      fireEvent.keyDown(find(), { key: "ArrowLeft" });
      await waitFor(() => expect(find().getAttribute("aria-expanded")).toBe("false"));
      trail.push(seen());
      fireEvent.keyDown(find(), { key: "ArrowRight" });
      await waitFor(() => expect(find().getAttribute("aria-expanded")).toBe("true"));
      trail.push(seen());

      return trail;
    };

    await openShelf([pad("read-one")], false, false, "/p", { now: NOW, read: { "fixture-read-one": "1" } });
    const pads = await walk(() => fold("idle"));
    cleanup();

    await mountRail([workstream("stream"), agent("child", "done", "done", { parent: "stream", final_text: { attempt: "1", turn: "1", finished: "0", kind: "empty" } })]);
    await settled();
    const rail = await walk(() => screen.getByRole("treeitem", { name: /idle/ }));

    expect(pads).toEqual(rail);
  });

  it("u7499a_arrow_keys_skip_a_closed_fold", async () => {
    // Home order: a (above), b (folded, read), c (above).
    await openShelf([pad("a"), pad("b"), pad("c")], false, false, "/p", { now: NOW, read: { "fixture-b": "1" } });
    const selected = () => document.activeElement?.closest("[data-pad]")?.getAttribute("data-pad");

    nameOf("a").focus();
    fireEvent.keyDown(nameOf("a"), { key: "ArrowDown" });
    await waitFor(() => expect(selected()).toBe("c"));
    fireEvent.click(fold("idle"));
    await waitFor(() => nameOf("b"));
    fireEvent.keyDown(nameOf("c"), { key: "ArrowDown" });
    await waitFor(() => expect(selected()).toBe("b"));
  });

  it("u7499a_reorder_sends_before_from_the_full_home_order", async () => {
    // Home order: a (folded, read), b (above), c (folded, read), d (above).
    const read = { "fixture-a": "1", "fixture-c": "1" };
    const { app } = await openShelf([pad("a"), pad("b"), pad("c"), pad("d")], false, false, "/p", { now: NOW, read });

    expect(rows()).toEqual(["b", "d"]);
    nameOf("d").focus();
    fireEvent.keyDown(nameOf("d"), { key: "ArrowUp", code: "ArrowUp", altKey: true });
    await waitFor(() => expect(app.calls.filter(call => call.method === "pad.reorder")).toHaveLength(1));
    // `d` takes `b`'s slot in the full order a, b, c, d, so it lands before `c`, a folded Pad the tab never listed.
    expect(app.calls.filter(call => call.method === "pad.reorder")[0]?.params).toMatchObject({ name: "d", before: "c" });
  });

  it("u7499b_a_save_records_the_revision", async () => {
    const { connected } = await openShelf([pad("note", { revision: 1 })], false, false, "/p", { now: NOW, read: { "fixture-note": "0" } });

    const field = await openPad("note");

    expect(connected.drawer.content()).not.toBeNull();
    // The save bumps the Revision to 2, and the record takes it.

    fireEvent.input(field, { target: { value: "typed" } });
    await waitFor(() => expect(padReadStorage("/p").read()).toEqual({ "fixture-note": "2" }), { timeout: 5000 });
  });

  it("u7499b_a_write_seen_while_open_counts_as_read_on_leaving", async () => {
    const { app, state, connected } = await openShelf([pad("watched", { revision: 2 })], false, false, "/p", { now: NOW, read: { "fixture-watched": "1" } });

    fireEvent.dblClick(rowOf("watched"));
    await waitFor(() => expect(connected.drawer.content()).not.toBeNull());
    state.pads = state.pads.map(each => ({ ...each, revision: 3, updated_at: NOW }));
    app.emit({ actor: AGENT, name: "pad.changed", data: { name: "watched" } });
    await waitFor(() => expect(app.calls.filter(call => call.method === "pad.list").length).toBeGreaterThan(1));
    connected.drawer.close();
    await waitFor(() => expect(padReadStorage("/p").read()).toEqual({ "fixture-watched": "3" }));
    expect(mark("changed")).toBe(0);
  });

  it("u7499b_the_first_list_counts_every_pad_as_read", async () => {
    await openShelf([pad("a"), pad("b", { revision: 3 })], false, false, "/first", { now: NOW, read: null });
    await waitFor(() => expect(padReadStorage("/first").read()).toEqual({ "fixture-a": "1", "fixture-b": "3" }));
  });

  it("u7499b_a_later_pad_missing_from_the_record_is_unread", async () => {
    const { app, state } = await openShelf([pad("a")], false, false, "/later", { now: NOW, read: null });

    await waitFor(() => expect(padReadStorage("/later").read()).toEqual({ "fixture-a": "1" }));
    state.pads = [...state.pads, pad("agents-new")];
    app.emit({ actor: AGENT, name: "pad.changed", data: { name: "agents-new" } });
    await waitFor(() => expect(rows()).toEqual(["agents-new"]));
    expect(mark("new")).toBe(1);
  });

  it("u7499b_a_pad_the_user_creates_is_read", async () => {
    const { app, state } = await openShelf([pad("a")], false, false, "/mine", { now: NOW, read: { "fixture-a": "1" } });

    fireEvent.click(await screen.findByRole("button", { name: "Add Pad" }));
    const field = await screen.findByLabelText<HTMLInputElement>("Pad name");

    fireEvent.input(field, { target: { value: "mine" } });
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(state.pads.some(each => each.name === "mine")).toBe(true));
    app.emit({ actor: { kind: "user", id: "you", parent: null }, name: "pad.changed", data: { name: "mine" } });
    // Read at its creation: it folds as idle beside `a` instead of listing above the folds as new.
    await waitFor(() => expect(count(fold("idle"))).toBe(2));
    expect(rows()).toEqual([]);
    expect(mark("new")).toBe(0);
  });

  it("u7499b_a_recreated_name_is_unread", async () => {
    const { app, state } = await openShelf([pad("same")], false, false, "/again", { now: NOW, read: { "fixture-same": "1" } });

    state.pads = [{ ...pad("same"), incarnation: "second-life" }];
    app.emit({ actor: AGENT, name: "pad.changed", data: { name: "same" } });
    await waitFor(() => expect(rows()).toEqual(["same"]));
    expect(mark("new")).toBe(1);
  });

  it("u7499b_the_open_pad_never_moves_while_open", async () => {
    const { app, state, connected } = await open();

    fireEvent.click(fold("idle"));
    await waitFor(() => nameOf("already-read"));
    fireEvent.dblClick(rowOf("already-read"));
    await waitFor(() => expect(connected.drawer.content()).not.toBeNull());
    // Opened from an open fold, it keeps its row and fold while the Drawer shows it.
    state.pads = state.pads.map(each => each.name === "already-read" ? { ...each, revision: 2, updated_at: NOW - 9 * DAY } : each);
    app.emit({ actor: AGENT, name: "pad.changed", data: { name: "already-read" } });
    await waitFor(() => expect(app.calls.filter(call => call.method === "pad.list").length).toBeGreaterThan(1));
    expect(count(fold("idle"))).toBe(2);
  });

  it("u7499b_an_unread_pad_opened_above_the_folds_stays_there_with_its_fold_open", async () => {
    const { connected } = await open();

    fireEvent.click(fold("idle"));
    await waitFor(() => nameOf("already-read"));
    fireEvent.dblClick(rowOf("fresh-unread"));
    await waitFor(() => expect(connected.drawer.content()).not.toBeNull());
    expect(count(fold("idle"))).toBe(2);
    expect(document.querySelector(".shelf-list > [data-pad='fresh-unread'], .shelf-list [data-pad='fresh-unread']")).not.toBeNull();
  });
});
