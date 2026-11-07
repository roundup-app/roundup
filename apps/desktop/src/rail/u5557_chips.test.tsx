import { KeyChip } from "../keys/KeyChip";
import { cleanup, render, screen } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { EmptyRail, ChooseProject } from "../app/FirstRun";
import { ariaChord, CHORDS, leaderKeys, LEADER, SHELF_KEYS, LEADER_ROWS } from "../keys/chords";
import { createFakeApp } from "../testing/fakeApp";
import { appSettings, saveAppSettings } from "../settings/preferences";

afterEach(cleanup);

it("u5557a_empty_rail_chips_match_the_actions_they_start", () => {
  render(() => <EmptyRail onNew={() => {}} onWorkstream={() => {}} />);

  for (const [label, name] of [["New Agent", "agent.new"], ["New Workstream", "workstream.new"]] as const) {
    const button = screen.getByRole("button", { name: label });
    expect(button.querySelector("kbd")?.textContent).toBe(CHORDS[name].keys);
    expect(button.getAttribute("aria-keyshortcuts")).toBe(ariaChord(CHORDS[name]));
  }
});

it("u5557a_choose_folder_chip_matches_its_action", () => {
  render(() => <ChooseProject app={createFakeApp()} failure={null} onOpen={() => {}} onChoose={() => {}} />);
  const button = screen.getByRole("button", { name: CHORDS["project.choose-folder"].what });
  expect(button.querySelector("kbd")?.textContent).toBe(CHORDS["project.choose-folder"].keys);
  expect(button.getAttribute("aria-keyshortcuts")).toBe(ariaChord(CHORDS["project.choose-folder"]));
});

it("u5557a_rebinding_updates_the_chip_and_shortcut", async () => {
  const before = appSettings().shortcuts;
  render(() => <EmptyRail onNew={() => {}} onWorkstream={() => {}} />);

  try {
    await saveAppSettings({ shortcuts: { ...before, "workstream.new": "ctrl+meta+KeyW" } });
    const button = screen.getByRole("button", { name: "New Workstream" });
    expect(button.querySelector("kbd")?.textContent).toBe(CHORDS["workstream.new"].keys);
    expect(button.getAttribute("aria-keyshortcuts")).toBe(ariaChord(CHORDS["workstream.new"]));
  } finally {
    await saveAppSettings({ shortcuts: before });
  }
});

it("u2541d_sequences_and_alternatives_keep_one_chip_per_press", () => {
  const view = render(() => <><KeyChip keys={leaderKeys(LEADER_ROWS[0]!)} /><KeyChip keys={SHELF_KEYS.adjacent} /></>);
  expect([...view.container.querySelectorAll("kbd")].map(chip => chip.textContent)).toEqual(["⌘K", "A", "↑", "↓"]);
});
