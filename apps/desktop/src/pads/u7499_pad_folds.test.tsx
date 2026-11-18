import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import type { Pad } from "@contracts/pad/Pad";
import { afterEach, describe, expect, it } from "vitest";
import { AGENT, openShelf, padOf } from "./padsFixture";
import { padReadStorage } from "./padRead";

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
    fireEvent.dblClick(nameOf("a"));
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

  it("u7499b_a_pad_opened_from_a_closed_fold_lists_above_the_folds", async () => {
    const { connected } = await open();
    fireEvent.click(fold("internal"));
    await waitFor(() => nameOf("hidden-by-agent"));
    fireEvent.dblClick(nameOf("hidden-by-agent"));
    await waitFor(() => expect(connected.drawer.content()).not.toBeNull());
    await waitFor(() => expect(rows()).toContain("hidden-by-agent"));
    expect(foldOrNull("internal")).toBeNull();
    connected.drawer.close();
    await waitFor(() => expect(count(fold("internal"))).toBe(1));
  });

  it("u7499b_each_way_of_opening_records_the_revision", async () => {
    await open();
    fireEvent.dblClick(nameOf("fresh-unread"));
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
    fireEvent.dblClick(nameOf("already-read"));
    await waitFor(() => expect(connected.drawer.content()).not.toBeNull());
    connected.drawer.close();
    await waitFor(() => expect(count(fold("idle"))).toBe(2));
  });
});
