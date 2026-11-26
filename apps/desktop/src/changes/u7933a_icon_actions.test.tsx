import { cleanup, render, screen, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { copy } from "./copy";
import type { RemoteChip as Chip } from "./remote";
import { RemoteChip } from "./RemoteChip";
import { openBatch, openDiff, saveNote } from "./noteHarness";

afterEach(cleanup);

const chip = (kind: "moved" | "failed"): Chip => kind === "moved" ? { kind } : { kind, cause: "x" };

it("u7933a_no_action_button_shows_text", () => {
  for (const [kind, name] of [["moved", copy.fetch], ["failed", copy.retry]] as const) {
    render(() => <RemoteChip chip={chip(kind)} fetch={() => {}} retry={() => {}} />);

    const button = screen.getByRole("button", { name });

    expect(button.textContent).toBe("");
    expect(button.querySelector("svg.icon")).not.toBeNull();
    cleanup();
  }
});

it("u7933a_each_icon_button_keeps_its_name", async () => {
  await openDiff();
  await saveNote("tidy");
  await openBatch();
  const bar = screen.getByLabelText(copy.notesRegion, { selector: "section" });

  for (const name of [copy.editNote(1), copy.removeNote(1), copy.sendNotesTo("a")]) {
    const button = within(bar).getByRole("button", { name });

    expect(button.textContent).toBe("");
    expect(button.querySelector("svg.icon")).not.toBeNull();
  }
});
