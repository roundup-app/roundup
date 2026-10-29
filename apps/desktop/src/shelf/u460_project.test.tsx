import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { fakeEmulators } from "../terminal/paneHarness";
import { RequestedApp as App } from "../testing/requestedApp";
import { seedApp } from "../testing/seeds";
import { showEverythingInApp } from "../testing/showEverything";
import { deferred } from "../pads/padsFixture";
import { RpcError } from "../app/seam";
import { askToDelete, stubDialogLayout } from "./bulkQuestionHarness";

afterEach(() => { cleanup(); localStorage.clear(); });

stubDialogLayout();

it("u460_pending_delete_stays_with_its_project", async () => {
  const { app } = seedApp("tree-40", 0);
  app.handlers["rail.tree"] = () => [];
  app.of("/Users/you/harness");
  app.add("/other", "other");
  const other = app.of("/other");
  render(() => <App app={app} reducedMotion={() => true} clock={() => 0} createEmulator={fakeEmulators().factory} />);
  fireEvent.click(await screen.findByRole("tab", { name: "harness" }));
  await showEverythingInApp();
  fireEvent.click(await waitFor(() => document.querySelector<HTMLElement>('[data-shelf-group="unassigned"] [data-part="branch-control"]') ?? Promise.reject(new Error("no group"))));
  const list = screen.getByRole("region", { name: "Todos" });
  const rows = within(list).getAllByRole("button").filter((row) => row.classList.contains("todo-row-button") && row.hasAttribute("aria-pressed"));
  fireEvent.click(rows[0]!, { metaKey: true });
  fireEvent.click(rows[1]!, { metaKey: true });
  const kept = deferred<null>();
  app.handlers["todo.delete"] = async () => { await kept.promise; throw new RpcError(-32001, "old Project error"); };

  await askToDelete(2);

  fireEvent.click(screen.getByRole("tab", { name: "other" }));
  kept.resolve(null);
  await waitFor(() => expect(app.calls.filter((call) => call.method === "todo.delete")).toHaveLength(1));
  expect(other.calls.filter((call) => call.method === "todo.delete")).toEqual([]);
  expect(screen.queryByText(/old Project error/)).toBeNull();
  expect(document.querySelector('.todo-row-button[aria-pressed="true"]')).toBeNull();
}, 20_000);

it("u460_escape_from_a_shelf_tab_clears_selection_before_closing_the_shelf", async () => {
  const { app } = seedApp("tree-40", 0);
  app.handlers["rail.tree"] = () => [];
  render(() => <App app={app} reducedMotion={() => true} clock={() => 0} createEmulator={fakeEmulators().factory} />);
  await showEverythingInApp();
  const row = document.querySelector<HTMLButtonElement>(".todo-row-button[aria-pressed]")!;
  fireEvent.click(row, { metaKey: true });
  const tab = within(screen.getByRole("tablist", { name: "Work items" })).getByRole("tab", { name: /Todos/ });
  tab.focus();
  fireEvent.keyDown(tab, { key: "Escape" });
  expect(document.querySelector('.todo-row-button[aria-pressed="true"]')).toBeNull();
  expect(document.querySelector<HTMLElement>(".shelf")!.hidden).toBe(false);
  expect(document.activeElement).toBe(row);
}, 20_000);
