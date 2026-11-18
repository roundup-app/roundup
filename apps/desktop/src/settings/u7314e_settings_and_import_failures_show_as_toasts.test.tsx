import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@solidjs/testing-library";
import { flush } from "solid-js";
import { afterEach, expect, it } from "vitest";
import { RpcError } from "../app/seam";
import { ImportPanel } from "../importer/ImportPanel";
import { ConnectedProjectContext } from "../state/connectedProject";
import { connectFakeProject } from "../terminal/paneHarness";
import { createFakeApp } from "../testing/fakeApp";
import { notice, notices } from "../testing/notices";
import { ToastHost } from "../testing/toastHost";
import { AppSettings } from "./AppSettings";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const toasts = () => screen.getByRole("region", { name: "Updates" });

/** The reserved lines the screen itself holds, empty or not: a failure has no place in it. */
const reservedLines = () =>
  [...document.querySelectorAll(".reserved-line")].filter(
    (line) => !line.closest(".app-toasts"),
  );

const elements = (root: Element) => [...root.querySelectorAll("*")];

it("u7314e_settings_and_import_failures_show_as_toasts: Settings", async () => {
  const app = createFakeApp();
  app.handlers["daemon.getNaming"] = () => ({
    automaticRenaming: true,
    namingGuide: "role-verb-object",
  });
  app.handlers["daemon.setNaming"] = () => {
    throw new RpcError(-32603, "Disk full; free space and retry.");
  };

  render(() => (
    <ToastHost>
      <AppSettings app={app} project={() => null} />
    </ToastHost>
  ));
  await Promise.resolve();
  window.dispatchEvent(new Event("open-app-settings"));
  await screen.findByRole("textbox", { name: "Naming guide" });
  const content = screen.getByRole("tabpanel");
  const before = elements(content);
  expect(reservedLines()).toEqual([]);

  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  const shown = await waitFor(() => notice("alert"));
  expect(notices("alert")).toEqual([shown]);
  expect(toasts().contains(shown)).toBe(true);
  expect(reservedLines()).toEqual([]);
  expect(elements(content)).toEqual(before);

  fireEvent.click(within(toasts()).getByRole("button", { name: "Dismiss" }));
  await waitFor(() => expect(notices("alert")).toEqual([]));
  expect(reservedLines()).toEqual([]);
  expect(elements(content)).toEqual(before);
});

it("u7314e_settings_and_import_failures_show_as_toasts: Importer", async () => {
  const { app, connected } = await connectFakeProject([]);
  app.handlers["agent.spawn"] = () => {
    throw new RpcError(-32003, "Launch unavailable.");
  };

  render(() => (
    <ToastHost>
      <ConnectedProjectContext value={connected}>
        <ImportPanel onClose={() => {}} />
      </ConnectedProjectContext>
    </ToastHost>
  ));

  const panel = await screen.findByRole("region", {
    name: "Import Claude Code",
  });

  const before = elements(panel);
  fireEvent.input(
    screen.getByRole("textbox", { name: "Import instructions" }),
    { target: { value: "List yesterday's work" } },
  );
  flush();
  expect(reservedLines()).toEqual([]);

  fireEvent.click(screen.getByRole("button", { name: "Start import Agent" }));
  const shown = await waitFor(() => notice("alert"));
  expect(notices("alert")).toEqual([shown]);
  expect(toasts().contains(shown)).toBe(true);
  expect(reservedLines()).toEqual([]);
  expect(elements(panel)).toEqual(before);

  fireEvent.click(within(toasts()).getByRole("button", { name: "Dismiss" }));
  await waitFor(() => expect(notices("alert")).toEqual([]));
  expect(reservedLines()).toEqual([]);
  expect(elements(panel)).toEqual(before);

  app.handlers["project.importDiscover"] = () => {
    throw new RpcError(-32003, "Cannot read sessions.");
  };

  void connected.importing.refresh();
  await within(await waitFor(() => toasts())).findByText(
    /Cannot read sessions/,
  );

  const reads = () =>
    app.calls.filter((call) => call.method === "project.importDiscover").length;

  const readsBefore = reads();
  app.handlers["project.importDiscover"] = () => ({
    candidates: [],
    excluded: [],
  });
  fireEvent.click(within(toasts()).getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(notices("alert")).toEqual([]));
  expect(reads()).toBe(readsBefore + 1);
});
