import { expect, it } from "vitest";
import { CHORD_ROWS, SWITCHER_KEYS } from "./chords";

/** U6829a, U6829b: the rows a stranded click is tested for, in `shelf/u6829a_stranded_row_keys.test.tsx` and `rail/u6829b_stranded_rail_keys.test.tsx`. */
const COVERED = ["todo.delete", "todo.export", "rail.rename", "rail.move", "agent.restart-mode", "rail.collapse-expand"];

/** One line each: why a row bound to the Rail or Shelf needs no body-focus case. */
const EXEMPT = {
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

/** U6829c: the Switcher's keys (`SWITCHER_KEYS`) and the Project tabs' arrows, with the case in `switcher/u6829c_switcher_keys.test.tsx` and `header/u494_keyboard.test.ts` that proves each. */
const SWITCHER_AND_TABS = {
  move: "covered: switcher/u6829c_switcher_keys.test.tsx",
  choose: "covered: the same layer binding as move",
  close: "exempt: Escape is the modal layer's own chord, which runs whatever holds focus (U5240a)",
  record: "exempt: acts on the highlighted command inside the open field, which holds focus while recording (U5240d)",
} satisfies Record<string, string>;

it("u6829d_every_row_bound_key_is_in_the_body_focus_table (switcher and tabs)", () => {
  expect(Object.keys(SWITCHER_KEYS).filter(name => !Object.hasOwn(SWITCHER_AND_TABS, name))).toEqual([]);
});
