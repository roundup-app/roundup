import { cleanup, render, screen } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { EmptyRail, ChooseProject } from "../app/FirstRun";
import { ariaChord, chordNamed } from "../keys/chords";
import { createFakeApp } from "../testing/fakeApp";
import { appSettings, saveAppSettings } from "../settings/preferences";

afterEach(cleanup);

it("u5557a_empty_rail_chips_match_the_actions_they_start", () => {
  render(() => <EmptyRail onNew={() => {}} onWorkstream={() => {}} />);

  for (const [label, name] of [["New Agent", "agent.new"], ["New Workstream", "workstream.new"]]) {
    const button = screen.getByRole("button", { name: label });
    expect(button.querySelector("kbd")?.textContent).toBe(chordNamed(name)!.keys);
    expect(button.getAttribute("aria-keyshortcuts")).toBe(ariaChord(chordNamed(name)));
  }
});
