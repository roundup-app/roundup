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
const fold = (kind: "internal" | "idle") => document.querySelector<HTMLButtonElement>(`.pad-fold[data-fold="${kind}"]`);

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
    fireEvent.click(fold("internal")!);
    fireEvent.click(fold("idle")!);
    await waitFor(() => expect(rows().sort()).toEqual(["already-read", "eight-days-old", "fresh-unread", "hidden-by-agent"]));
  });

  it("u7499a_folds_start_closed_and_counts_match", async () => {
    await open();
    expect(fold("internal")!.textContent).toContain("1 internal");
    expect(fold("idle")!.textContent).toContain("2 idle");
    expect(fold("idle")!.getAttribute("aria-expanded")).toBe("false");
    expect(document.querySelector(".shelf-group-count")!.textContent).toBe("4");
    fireEvent.click(fold("idle")!);
    await waitFor(() => expect(fold("idle")!.getAttribute("aria-expanded")).toBe("true"));
    fireEvent.keyDown(fold("idle")!, { key: "ArrowLeft" });
    await waitFor(() => expect(fold("idle")!.getAttribute("aria-expanded")).toBe("false"));
  });

  it("u7499a_a_never_read_pad_has_the_new_dot", async () => {
    await open();
    expect(screen.getByRole("img", { name: "New" })).toBeTruthy();
    expect(document.querySelectorAll("[data-shelf-row] .pad-mark-slot")).toHaveLength(1);
  });

  it("u7499a_a_pad_changed_since_the_read_has_the_changed_dot", async () => {
    await openShelf([pad("seen-before", { revision: 2 })], false, false, "/p", { now: NOW, read: { "fixture-seen-before": "1" } });
    expect(screen.getByRole("img", { name: "Changed since you read it" })).toBeTruthy();
  });

  it("u7499b_the_read_record_survives_a_reload_per_project", async () => {
    await openShelf([pad("a")], false, false, "/one", { now: NOW, read: {} });
    fireEvent.dblClick(document.querySelector<HTMLElement>('[data-pad="a"] .pad-name')!);
    await waitFor(() => expect(padReadStorage("/one").read()).toEqual({ "fixture-a": "1" }));
    expect(padReadStorage("/two").read()).toBeNull();
  });

  it("u7499b_selecting_a_row_never_counts_as_reading", async () => {
    await open();
    const name = document.querySelector<HTMLButtonElement>(".pad-name")!;
    fireEvent.click(name);
    fireEvent.keyDown(name, { key: "ArrowDown" });
    expect(padReadStorage("/p").read()).toEqual({ "fixture-already-read": "1" });
    expect(screen.getByRole("img", { name: "New" })).toBeTruthy();
  });

  it("u7499b_a_pad_opened_from_a_closed_fold_lists_above_the_folds", async () => {
    const { connected } = await open();
    fireEvent.click(fold("internal")!);
    const row = await waitFor(() => document.querySelector<HTMLElement>('[data-pad="hidden-by-agent"]')!);
    fireEvent.dblClick(row.querySelector(".pad-name")!);
    await waitFor(() => expect(connected.drawer.content()).not.toBeNull());
    await waitFor(() => expect(rows()).toContain("hidden-by-agent"));
    expect(fold("internal")).toBeNull();
    connected.drawer.close();
    await waitFor(() => expect(fold("internal")!.textContent).toContain("1 internal"));
  });

  it("u7499b_each_way_of_opening_records_the_revision", async () => {
    await open();
    const row = document.querySelector<HTMLElement>('[data-pad="fresh-unread"]')!;
    fireEvent.dblClick(row.querySelector(".pad-name")!);
    await waitFor(() => expect(padReadStorage("/p").read()).toMatchObject({ "fixture-fresh-unread": "1" }));
  });
});
