import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { createFakeApp } from "../testing/fakeApp";
import { notice, notices } from "../testing/notices";
import { ToastHost } from "../testing/toastHost";
import { Deferred } from "../ui/Deferred";
import { ChooseProject } from "./FirstRun";

afterEach(cleanup);

const toasts = () => screen.getByRole("region", { name: "Updates" });

/** The reserved lines the screen itself holds, empty or not: a failure has no place in it. */
const reservedLines = () => [...document.querySelectorAll(".reserved-line")].filter(line => !line.closest(".app-toasts"));

const elements = (root: Element) => [...root.querySelectorAll("*")];

/** The first-run screen reading its recent folders; the Claude binary read stays pending, so it shows nothing. */
const mountFirstRun = (recentProjects: () => Promise<string[]>) => {
  const app = createFakeApp();
  app.recentProjects = recentProjects;
  app.claudeBinary = () => new Promise(() => {});
  render(() => <ToastHost><ChooseProject app={app} failure={null} onOpen={() => {}} onChoose={() => {}} /></ToastHost>);

  const screenRoot = document.querySelector(".choose-project");

  if (!screenRoot) throw new Error("no first-run screen");

  return { root: screenRoot, before: elements(screenRoot) };
};

it("u7314g_window_failures_show_as_toasts", async () => {
  let reads = 0;

  const { root, before } = mountFirstRun(async () => {
    reads += 1;

    if (reads === 1) throw new Error("Recent folders unreadable");

    return [];
  });

  expect(reservedLines()).toEqual([]);

  const shown = await waitFor(() => notice("alert"));
  expect(notices("alert")).toEqual([shown]);
  expect(toasts().contains(shown)).toBe(true);
  expect(reservedLines()).toEqual([]);
  expect(elements(root)).toEqual(before);

  fireEvent.click(within(toasts()).getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(notices("alert")).toEqual([]));
  expect(reads).toBe(2);
  expect(reservedLines()).toEqual([]);
  expect(elements(root)).toEqual(before);

  cleanup();
  const failing = mountFirstRun(() => Promise.reject(new Error("Recent folders unreadable")));
  await waitFor(() => notice("alert"));
  fireEvent.click(within(toasts()).getByRole("button", { name: "Dismiss" }));
  await waitFor(() => expect(notices("alert")).toEqual([]));
  expect(reservedLines()).toEqual([]);
  expect(elements(failing.root)).toEqual(failing.before);
});

it("u7314g_a_blocked_failure_is_its_own_view_not_a_toast", async () => {
  render(() => <ToastHost><Deferred label="Pads" load={() => Promise.reject(new Error("Pads could not load"))}>{() => null}</Deferred></ToastHost>);

  const shown = await waitFor(() => notice("alert"));
  expect(notices("alert")).toEqual([shown]);
  expect(shown.closest(".app-toasts")).toBeNull();
  expect(reservedLines()).toEqual([]);
});
