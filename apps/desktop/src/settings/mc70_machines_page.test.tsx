import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { Machine } from "@contracts/machine/Machine";
import { RpcError } from "../app/seam";
import { createFakeApp } from "../testing/fakeApp";
import { useBrowserStorage } from "../state/storage";
import { AppSettings } from "./AppSettings";

beforeEach(() => { window.localStorage.clear(); useBrowserStorage(window.localStorage); });

afterEach(cleanup);

const box: Machine = { name: "box", details: {}, reachable: true };
const dead: Machine = { name: "roundup-ci-control", details: {}, reachable: false };

const open = async (machines: Machine[]) => {
  const app = createFakeApp();
  let list = machines;
  app.handlers["machine.list"] = () => list;
  app.handlers["machine.remove"] = ({ name }) => (list = list.filter(m => m.name !== name));
  app.handlers["machine.add"] = ({ name }) => (list = [...list, { name, details: {}, reachable: true }]);
  render(() => <AppSettings app={app} project={() => "/p"} />);
  await Promise.resolve();
  window.dispatchEvent(new Event("open-app-settings"));
  await screen.findByLabelText("Settings", { selector: "section" });
  fireEvent.click(screen.getByText("Machines", { selector: '[role="tab"]' }));

  return { app, list: await screen.findByRole("list", { name: "Machines" }) };
};

it("mc70_machines_page_lists_this_mac_first_then_the_others", async () => {
  const { list } = await open([box, dead]);
  await waitFor(() => expect(within(list).getAllByRole("listitem")).toHaveLength(3));
  const [first, ...others] = within(list).getAllByRole("listitem");

  expect(within(list).getAllByRole("listitem")).toHaveLength(3);
  expect(first && within(first).queryByRole("button")).toBeNull();
  expect(others.map(row => within(row).getByRole("button").getAttribute("aria-label"))).toEqual(["Remove box", "Remove roundup-ci-control"]);
});

it("mc70_no_machine_sidebar_rail_level_or_dialog", async () => {
  await open([box]);

  for (const role of ["complementary", "dialog", "tree"] as const) expect(screen.queryAllByRole(role, { name: /box/ })).toHaveLength(0);
});

it("mc74_unreachable_machine_is_offline_and_removable", async () => {
  const { list } = await open([box, dead]);
  await waitFor(() => expect(list.querySelectorAll("[data-state=online]")).toHaveLength(1));

  expect(list.querySelectorAll("[data-state=offline]")).toHaveLength(1);
  expect(within(list).getByRole("button", { name: "Remove roundup-ci-control" })).toBeTruthy();
});

it("mc71_remove_calls_machine_remove_after_confirm_and_drops_the_row", async () => {
  const { app, list } = await open([box]);
  fireEvent.click(await within(list).findByRole("button", { name: "Remove box" }));
  await waitFor(() => expect(app.questions).toHaveLength(1));
    app.answerQuestion?.(true);
  await waitFor(() => expect(within(list).queryByText("box")).toBeNull());
  expect(app.calls.filter(call => call.method === "machine.remove")).toHaveLength(1);
});

it("mc71_cancel_removes_nothing", async () => {
  const { app, list } = await open([box]);
  fireEvent.click(await within(list).findByRole("button", { name: "Remove box" }));
  await waitFor(() => expect(app.questions).toHaveLength(1));
  app.answerQuestion?.(false);
  await Promise.resolve();
  expect(app.calls.some(call => call.method === "machine.remove")).toBe(false);
  expect(within(list).getByText("box")).toBeTruthy();
});

it("mc73_add_calls_machine_add_and_shows_the_row", async () => {
  const { app, list } = await open([]);
  const field = screen.getByRole("textbox", { name: "Add machine" });
  fireEvent.input(field, { target: { value: " build-box " } });
  fireEvent.keyDown(field, { key: "Enter" });
  await within(list).findByText("build-box");
  expect(app.calls.find(call => call.method === "machine.add")?.params).toEqual({ name: "build-box" });
  expect((field as HTMLInputElement).value).toBe("");
});

it("mc73_empty_entry_submits_nothing", async () => {
  const { app } = await open([]);
  const field = screen.getByRole("textbox", { name: "Add machine" });
  fireEvent.input(field, { target: { value: "   " } });
  fireEvent.keyDown(field, { key: "Enter" });
  expect(app.calls.some(call => call.method === "machine.add")).toBe(false);
});

it("mc73_a_failing_host_shows_the_hint_inline_and_keeps_the_text", async () => {
  const { app, list } = await open([]);
  app.handlers["machine.add"] = () => { throw new RpcError(-32603, "ssh_refused: check the host name"); };
  const field = screen.getByRole("textbox", { name: "Add machine" });
  fireEvent.input(field, { target: { value: "nowhere" } });
  fireEvent.keyDown(field, { key: "Enter" });
  await screen.findByText(/check the host name/);
  expect((field as HTMLInputElement).value).toBe("nowhere");
  expect(within(list).queryByText("nowhere")).toBeNull();
  expect(screen.queryByRole("alertdialog")).toBeNull();
});
