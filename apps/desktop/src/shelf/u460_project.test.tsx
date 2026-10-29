import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { fakeEmulators } from "../terminal/paneHarness";
import { RequestedApp as App } from "../testing/requestedApp";
import { seedApp } from "../testing/seeds";
import { showEverythingInApp } from "../testing/showEverything";
import { deferred } from "../pads/padsFixture";
import { RpcError } from "../app/seam";
import { askToDelete } from "./bulkQuestionHarness";
import { todo } from "../todos/testHarness";

afterEach(() => { cleanup(); localStorage.clear(); });

it("u460_pending_delete_stays_with_its_project", async () => {
  const { app } = seedApp("empty-project", 0);
  app.handlers["todo.list"] = () => [todo(1), todo(2)];
  app.of("/Users/you/harness");
  app.add("/other", "other");
  const other = app.of("/other");
  render(() => <App app={app} reducedMotion={() => true} clock={() => 0} createEmulator={fakeEmulators().factory} />);
  fireEvent.click(await screen.findByRole("tab", { name: "harness" }));
  await showEverythingInApp();
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
  expect([screen.queryByText("2 selected")]).toEqual([null]);
}, 20_000);

it("u460_escape_from_a_shelf_tab_clears_selection_before_closing_the_shelf", async () => {
  const { app } = seedApp("empty-project", 0);
  app.handlers["todo.list"] = () => [todo(1), todo(2)];
  render(() => <App app={app} reducedMotion={() => true} clock={() => 0} createEmulator={fakeEmulators().factory} />);
  await showEverythingInApp();
  const row = await screen.findByRole("button", { name: /^(?:Idle|Blocked|Done) #1 / });
  fireEvent.click(row, { metaKey: true });
  fireEvent.click(screen.getByRole("button", { name: /^(?:Idle|Blocked|Done) #2 / }), { metaKey: true });
  const cancel = screen.getByRole("button", { name: "Cancel" });
  const tab = within(screen.getByRole("tablist", { name: "Work items" })).getByRole("tab", { name: /Todos/ });
  tab.focus();
  const calls = app.calls.length;
  fireEvent.keyDown(tab, { key: "Escape" });
  expect(cancel.isConnected).toBe(false);
  expect(within(screen.getByRole("region", { name: "Todos" })).queryAllByRole("button", { pressed: true })).toEqual([]);
  expect(within(screen.getByRole("tablist", { name: "Work items" })).getByRole("tab", { name: /Todos/ })).toBe(tab);
  expect(document.activeElement).toBe(row);
  expect(app.calls.slice(calls)).toEqual([]);
});
