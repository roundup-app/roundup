import { expect, it } from "vitest";
import { ACTION_ROWS, CHORD_ROWS, LEADER_ROWS } from "./chords";

it("u54_help_lists_chords_in_the_same_order", () => {
  const head = ["agent.new", "agent.new-with-prompt", "workstream.new", "mode.new"];
  const tail = CHORD_ROWS.map(row => row.name).filter(name => !head.includes(name));

  expect(ACTION_ROWS.map(row => row.name)).toEqual([...head, ...LEADER_ROWS.map(row => row.name), ...tail]);
});
