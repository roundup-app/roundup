import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { RpcError } from "../app/seam";
import { ForkSheet } from "../fork/ForkSheet";
import { createFakeApp } from "../testing/fakeApp";
import { notice, notices } from "../testing/notices";
import { mountControl } from "./harness";

afterEach(cleanup);

const toasts = () => screen.getByRole("region", { name: "Updates" });

/** What the screen itself holds: the Toast region and what it shows are not the screen. */
const ownElements = (scope: ParentNode) => [...scope.querySelectorAll("*")].filter(element => !element.closest(".app-toasts"));

/** The reserved lines the screen itself holds, empty or not: a failure has no place in it. */
const reservedLines = () => ownElements(document).filter(line => line.matches(".message-body"));

/** The elements of a screen, as nodes: the same ones in the same order whether or not a message shows. */
const same = (now: readonly Element[], before: readonly Element[]) => expect(now.map(element => before.indexOf(element))).toEqual(before.map((_, index) => index));

it("u7314c_changes_and_fork_failures_show_as_toasts: Worktree control", async () => {
  let failed = false;

  const { app, connected, view } = await mountControl(() => {
    if (failed) throw new RpcError(-32001, "read failed; original cause");

    return { files: [{ path: "one", status: "modified", line: 1, counts: null }] };
  });

  const elements = () => ownElements(view.container);
  const reads = () => app.calls.filter(call => call.method === "agent.changedFiles").length;
  const before = elements();

  failed = true;
  await connected.worktrees.refresh("a");
  const shown = await waitFor(() => notice("alert"));
  expect(notices("alert")).toEqual([shown]);
  expect(toasts().contains(shown)).toBe(true);
  expect(reservedLines()).toEqual([]);
  same(elements(), before);

  const readsBefore = reads();
  failed = false;
  fireEvent.click(within(toasts()).getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(notices("alert")).toEqual([]));
  expect(reads()).toBe(readsBefore + 1);
  expect(reservedLines()).toEqual([]);
  same(elements(), before);

  failed = true;
  await connected.worktrees.refresh("a");
  await waitFor(() => notice("alert"));
  const readsShown = reads();
  fireEvent.click(within(toasts()).getByRole("button", { name: "Dismiss" }));
  await waitFor(() => expect(notices("alert")).toEqual([]));
  expect(reads()).toBe(readsShown);
  expect(reservedLines()).toEqual([]);
  same(elements(), before);
});

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