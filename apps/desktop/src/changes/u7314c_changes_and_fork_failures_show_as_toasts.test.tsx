import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { ForkSheet } from "../fork/ForkSheet";
import { createFakeApp } from "../testing/fakeApp";
import { notice, notices } from "../testing/notices";

afterEach(cleanup);

/** What the screen itself holds: the Toast region and what it shows are not the screen. */
const ownElements = (scope: ParentNode) => [...scope.querySelectorAll("*")].filter(element => !element.closest(".app-toasts"));

/** The reserved lines the screen itself holds, empty or not: a failure has no place in it. */
const reservedLines = () => ownElements(document).filter(line => line.matches(".message-body"));

/** The elements of a screen, as nodes: the same ones in the same order whether or not a message shows. */
const same = (now: readonly Element[], before: readonly Element[]) => expect(now.map(element => before.indexOf(element))).toEqual(before.map((_, index) => index));

// The Worktree control's Changes read is now the Changes view's own blocked failure with Retry (U7314e), not a toast:
// `u7186c_a_failed_read_shows_retry_and_no_count` proves that clause.

it("u7314c_changes_and_fork_failures_show_as_toasts: Fork sheet", async () => {
  const forkMake = vi.fn().mockRejectedValue(new Error("no space left"));
  const app = createFakeApp();

  app.forkMake = forkMake;
  render(() => <ForkSheet app={app} open sources={() => [{ path: "/p", name: "p", nodes: [] }]} onClose={() => {}} />);
  const dialog = await screen.findByRole("dialog");
  const field = await within(dialog).findByLabelText("Name");

  await waitFor(() => expect(field).toHaveProperty("value", "fork"));
  const actions = dialog.querySelector(".app-dialog-actions");
  const form = field.closest("form");

  if (!actions || !form) throw new Error("the sheet holds no form and actions");

  const ownOfForm = () => ownElements(form).filter(element => !element.closest(".mounted-line"));
  const before = ownOfForm();

  fireEvent.submit(form);
  // A dialog's top layer covers the Toast region, so its failure reads in the dialog, once, beside its form.
  const shown = await waitFor(() => notice("alert"));
  expect(notices("alert")).toEqual([shown]);
  expect(dialog.contains(shown)).toBe(true);
  expect(actions.contains(shown)).toBe(false);
  expect(reservedLines()).toEqual([]);
  same(ownOfForm(), before);

  fireEvent.click(within(dialog).getByRole("button", { name: "Dismiss" }));
  await waitFor(() => expect(notices("alert")).toEqual([]));
  expect(forkMake).toHaveBeenCalledTimes(1);
  same(ownOfForm(), before);
});