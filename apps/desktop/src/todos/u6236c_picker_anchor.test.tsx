import { cleanup, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { HomePicker } from "./HomePicker";
import { OwnerPicker } from "./OwnerPicker";

afterEach(() => { Reflect.deleteProperty(HTMLElement.prototype, "checkVisibility"); cleanup(); vi.restoreAllMocks(); });

/** U6236c: a row the browser gives no box (replaced, or hidden) leaves its picker the box of the element it was opened from, not the window's top-left. */
it.each(["owner", "home"])("u6236c_a_picker_whose_row_has_no_box_sits_against_its_own_anchor: %s", async kind => {
  // jsdom has no layout; a browser reports an element that renders no box as invisible.
  Object.defineProperty(HTMLElement.prototype, "checkVisibility", { configurable: true, value: () => false });
  const anchor = document.body.appendChild(document.createElement("button"));
  const measured = vi.spyOn(anchor, "getBoundingClientRect").mockReturnValue(new DOMRect(100, 100, 40, 40));
  const target = () => ({ id: 1, anchor });

  render(() => kind === "owner"
    ? <OwnerPicker target={target} offers={() => [{ id: "unassigned", name: "Unassigned", actor: null }]} label={id => `Owners for #${id}`} choose={() => {}} close={() => {}} />
    : <HomePicker target={target} offers={() => [{ home: null, name: "Project root" }]} choose={() => {}} close={() => {}} />);

  expect(await screen.findByRole("menu")).toBeTruthy();
  await waitFor(() => expect(measured).toHaveBeenCalled());
});
