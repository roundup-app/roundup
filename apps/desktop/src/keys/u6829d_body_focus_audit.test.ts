import { expect, it } from "vitest";
import { CHORD_ROWS } from "./chords";

/** U6829a, U6829b: the rows a stranded click is tested for, in `shelf/u6829a_stranded_row_keys.test.tsx` and `rail/u6829b_stranded_rail_keys.test.tsx`. */
const COVERED = ["todo.delete", "todo.export", "rail.rename", "rail.move", "agent.restart-mode"];

/** One line each: why a row bound to the Rail or Shelf needs no body-focus case. */
const EXEMPT = {
  "rail.collapse-expand": "Ark's tree walks ← → from a focused item; a Rail row is a focusable div, so a click focuses it",
  "settings.forward": "an App-wide chord, not bound to a row",
  "shelf.close": "bound at the App scope",
  "shelf.maximise": "needs the Shelf, not a row",
  "todo.add": "needs the Todos section, not a row",
  "todo.assign": "acts on the selection through the Owner command, which already reads the sole selected row",
  "todo.assign-slot": "acts on the selection through the Owner command, which already reads the sole selected row",
  "todo.open-draft": "Enter on a focused row button is the button's own activation",
} satisfies Record<string, string>;

it("u6829d_every_row_bound_key_is_in_the_body_focus_table", () => {
  const bound = CHORD_ROWS.filter(row => row.inRail || row.inShelf).map(row => row.name);
  // todo.triage-*: bound only while triage mode is on, and entering it (todo.triage-enter) needs the Shelf focused.
  const missing = bound.filter(name => !COVERED.includes(name) && !Object.hasOwn(EXEMPT, name) && !name.startsWith("todo.triage-"));

  expect(missing).toEqual([]);
  expect(COVERED.filter(name => !bound.includes(name))).toEqual([]);
});
