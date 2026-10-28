import { cleanup, fireEvent, render, screen, within } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { EmptyState } from "./EmptyState";

afterEach(cleanup);

it("u4464_empty_state_parts_are_optional_and_the_art_is_hidden", () => {
  const view = render(() => <EmptyState art="folder" {...{ title: "Open a folder" }} line="Choose where to work." />);
  const empty = screen.getByRole("group");
  expect(within(empty).queryByRole("button")).toBeNull();
  expect(empty.querySelector('[aria-hidden="true"] svg')).not.toBeNull();
  expect(empty.querySelector("kbd")).toBeNull();
  view.unmount();
  const choose = vi.fn();
  render(() => <EmptyState art="folder" {...{ title: "Open a folder" }} line="Choose where to work." action={<button type="button" onClick={choose}>Choose</button>} chip="⌘O" />);
  fireEvent.click(screen.getByRole("button", { name: "Choose" }));
  expect(choose).toHaveBeenCalledOnce();
  expect(screen.getByRole("group").querySelectorAll("kbd")).toHaveLength(1);
});
