import { batch } from "solid-js";
import { cleanup, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { mountNavigation } from "../testing/navigationFixture";
import { openProjectPage, projectMenu } from "../testing/menuProbe";
import { CHORDS, LEADER } from "./chords";
import { copy } from "./copy";

afterEach(() => { batch(cleanup); localStorage.clear(); });

// Rows whose keys stay native unless something binds them (U3787b): the leader, history, Settings, plain list and text keys, Triage.
const native = new Set([copy.leaderChord, "⌘Z", "⇧⌘Z", "⌘,", "?", "⏎", "Esc", "Tab", "⇧Tab", "J K", "T", "W", "X", "C", "A"]);

const focusAt = async (place: "terminal" | "rail row") => {
  const { connected } = await mountNavigation(false, 0);

  if (place === "terminal") {
    connected().rail.select("a1");
    await waitFor(() => expect(document.activeElement?.getAttribute("data-terminal")).toBe("t-a1"));
  } else document.querySelector<HTMLElement>('[data-part="item"]')!.focus();

  await waitFor(() => expect(projectMenu.items.length).toBeGreaterThan(5));
};

it.each(["terminal", "rail row"] as const)("u5244a_every_inventory_row_has_one_item: %s focus", async place => {
  await focusAt(place);
  const ids = projectMenu.items.map(item => item.id);

  for (const row of [...CHORDS.filter(row => !native.has(row.keys)), ...LEADER.filter(row => row.keys !== "T")]) {
    const id = `action:${"press" in row ? "leader" : "chord"}:${row.keys}`;
    expect(ids.filter(other => other === id || other.startsWith(`${id}:`)).length, id).toBe(1);
  }
});

it("u5244b_unavailable_commands_stay_listed_disabled: Rename is the same item at the same place on a Rail row and in the Terminal", async () => {
  await focusAt("rail row");
  const id = `action:chord:${copy.renameChord}`;
  const enabled = projectMenu.items.find(item => item.id === id)!;
  const at = projectMenu.items.findIndex(item => item.id === id);
  expect(enabled.enabled).toBe(true);
  cleanup();
  await focusAt("terminal");
  const disabled = projectMenu.items.find(item => item.id === id)!;
  expect(disabled).toEqual({ ...enabled, enabled: false });
  expect(projectMenu.items.findIndex(item => item.id === id)).toBe(at);
});

it("u5244b_choosing_a_disabled_item_runs_nothing", async () => {
  await focusAt("terminal");
  const id = `action:chord:${copy.renameChord}`;
  expect(projectMenu.items.find(item => item.id === id)?.enabled).toBe(false);
  const focus = document.activeElement;
  openProjectPage(id, "/p");
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(document.activeElement).toBe(focus);
});
