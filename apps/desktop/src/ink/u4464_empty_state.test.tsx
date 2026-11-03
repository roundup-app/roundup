import { chordNamed } from "../keys/chords";
import { cleanup, fireEvent, render, screen, within } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { EmptyState } from "./EmptyState";

afterEach(cleanup);

it("u4464_empty_state_parts_are_optional", () => {
  render(() => <EmptyState art="strolling" {...{ title: "Open Project" }} line="Choose where to work." />);
  const empty = screen.getByRole("group");
  expect(within(empty).queryByRole("button")).toBeNull();
  expect(screen.getByRole("group", { name: "Open Project" })).toBe(empty);
});

it("u4464_single_action_runs_once", () => {
  const choose = vi.fn();
  render(() => <EmptyState art="strolling" {...{ title: "Open Project" }} line="Choose where to work." actions={[{ label: "Choose", chord: chordNamed("project.choose-folder")!, run: choose }]} />);
  fireEvent.click(screen.getByRole("button", { name: "Choose" }));
  expect(choose).toHaveBeenCalledOnce();
});
