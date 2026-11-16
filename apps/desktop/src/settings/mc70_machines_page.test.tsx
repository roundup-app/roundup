import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { Machine } from "@contracts/machine/Machine";
import { RpcError } from "../app/seam";
import { createFakeApp } from "../testing/fakeApp";
import { useBrowserStorage } from "../state/storage";
import { AppSettings } from "./AppSettings";

beforeEach(() => {
  window.localStorage.clear();
  useBrowserStorage(window.localStorage);
});

afterEach(cleanup);

const box: Machine = { name: "box", details: {}, reachable: true };

const dead: Machine = { name: "roundup-ci-control", details: {}, reachable: false };

const rows = () => document.querySelectorAll(".settings-machine-state");

const open = async (app: ReturnType<typeof createFakeApp>, machines: Machine[]) => {
  let list = machines;

  app.handlers["machine.list"] = () => list;
  app.handlers["machine.remove"] = ({ name }) => (list = list.filter(m => m.name !== name));
  app.handlers["machine.add"] = ({ name }) => (list = [...list, { name, details: {}, reachable: true }]);
  render(() => <AppSettings app={app} project={() => "/p"} />);
  await Promise.resolve();
  window.dispatchEvent(new Event("open-app-settings"));
  await screen.findByLabelText("Settings", { selector: "section" });
  fireEvent.click(screen.getByText("Machines", { selector: '[role="tab"]' }));

  return await screen.findByRole("list", { name: "Machines" });
};

it("mc70_machines_page_lists_this_mac_first_then_the_others", async () => {
  const list = await open(createFakeApp(), [box, dead]);
  await waitFor(() => expect(within(list).getAllByRole("listitem")).toHaveLength(3));
  const [first, ...others] = within(list).getAllByRole("listitem");

  expect(within(list).getAllByRole("listitem")).toHaveLength(3);
  expect(first && within(first).queryByRole("button")).toBeNull();
  expect(others.map(row => within(row).getByRole("button").getAttribute("aria-label"))).toEqual(["Remove box", "Remove roundup-ci-control"]);
});

it("mc70_no_machine_sidebar_rail_level_or_dialog", async () => {
  await open(createFakeApp(), [box]);

  for (const role of ["complementary", "dialog", "tree"] as const) expect(screen.queryAllByRole(role, { name: /box/ })).toHaveLength(0);
});

it("mc74_unreachable_machine_is_offline_and_removable", async () => {
  const list = await open(createFakeApp(), [box, dead]);
  await within(list).findByRole("button", { name: "Remove roundup-ci-control" });
  await waitFor(() => expect([...rows()].map(state => state.getAttribute("data-state"))).toEqual(["online", "offline"]));
});

it("mc71_remove_calls_machine_remove_after_confirm_and_drops_the_row", async () => {
  const app = createFakeApp();
  const list = await open(app, [box]);
  fireEvent.click(await within(list).findByRole("button", { name: "Remove box" }));
  await waitFor(() => expect(app.questions).toHaveLength(1));
  app.answerQuestion?.(true);
  await waitFor(() => expect(rows()).toHaveLength(0));
  expect(app.calls.filter(call => call.method === "machine.remove")).toHaveLength(1);
});

it("mc71_cancel_removes_nothing", async () => {
  const app = createFakeApp();
  const list = await open(app, [box]);
  fireEvent.click(await within(list).findByRole("button", { name: "Remove box" }));
  await waitFor(() => expect(app.questions).toHaveLength(1));
  app.answerQuestion?.(false);
  await Promise.resolve();
  expect(app.calls.some(call => call.method === "machine.remove")).toBe(false);
  expect(rows()).toHaveLength(1);
});

it("mc73_add_calls_machine_add_and_shows_the_row", async () => {
  const app = createFakeApp();
  const list = await open(app, []);
  const field = screen.getByRole("textbox", { name: "Add machine" });
  fireEvent.input(field, { target: { value: " build-box " } });
  fireEvent.keyDown(field, { key: "Enter" });
  await within(list).findByText("build-box");
  expect(app.calls.find(call => call.method === "machine.add")?.params).toEqual({ name: "build-box" });
  // SAFETY: the Add machine field is an input element.
  expect((field as HTMLInputElement).value).toBe("");
});

it("mc73_empty_entry_submits_nothing", async () => {
  const app = createFakeApp();
  await open(app, []);
  const field = screen.getByRole("textbox", { name: "Add machine" });
  fireEvent.input(field, { target: { value: "   " } });
  fireEvent.keyDown(field, { key: "Enter" });
  expect(app.calls.some(call => call.method === "machine.add")).toBe(false);
});

it("mc73_a_failing_host_shows_the_hint_inline_and_keeps_the_text", async () => {
  const app = createFakeApp();
  await open(app, []);
  app.handlers["machine.add"] = () => {
    throw new RpcError(-32603, "ssh_refused: check the host name");
  };

  const field = screen.getByRole("textbox", { name: "Add machine" });
  fireEvent.input(field, { target: { value: "nowhere" } });
  fireEvent.keyDown(field, { key: "Enter" });
  await screen.findByText(/check the host name/);
  // SAFETY: the Add machine field is an input element.
  expect((field as HTMLInputElement).value).toBe("nowhere");
  expect(rows()).toHaveLength(0);
  expect(screen.queryByRole("alertdialog")).toBeNull();
});

it("mc71_this_mac_cannot_be_removed", async () => {
  const list = await open(createFakeApp(), [box]);
  await within(list).findByRole("button", { name: "Remove box" });
  const [first] = within(list).getAllByRole("listitem");

  expect(first && within(first).queryByRole("button")).toBeNull();
});

it("mc71_a_refused_rm_keeps_the_row_with_the_hint", async () => {
  const app = createFakeApp();
  const list = await open(app, [box]);
  app.handlers["machine.remove"] = () => {
    throw new RpcError(-32603, "machine_busy: stop its agents first");
  };

  fireEvent.click(await within(list).findByRole("button", { name: "Remove box" }));
  await waitFor(() => expect(app.questions).toHaveLength(1));
  app.answerQuestion?.(true);
  await screen.findByText(/stop its agents first/);
  expect(rows()).toHaveLength(1);
  expect(screen.queryByRole("alertdialog")).toBeNull();
});

const old: Machine = { name: "old", details: {}, reachable: true, outdated: true };

it("mc75_update_shows_only_when_the_machine_is_older", async () => {
  const list = await open(createFakeApp(), [old, { ...box, outdated: false }, box, dead]);
  await within(list).findByRole("button", { name: "Remove old" });

  expect(within(list).getAllByRole("button", { name: /^Update / }).map(button => button.getAttribute("aria-label"))).toEqual(["Update old"]);
});

it("mc75_update_runs_once_and_clears_on_success", async () => {
  const app = createFakeApp();
  const { promise, resolve } = Promise.withResolvers<Machine[]>();
  const list = await open(app, [old]);
  app.handlers["machine.update"] = () => promise;

  const button = await within(list).findByRole("button", { name: "Update old" });
  fireEvent.click(button);
  fireEvent.click(button);
  await within(list).findByText("Updating…");
  expect(button.getAttribute("aria-disabled")).toBe("true");
  resolve([{ ...old, outdated: false }]);
  await waitFor(() => expect(within(list).queryByRole("button", { name: /^Update / })).toBeNull());
  expect(app.calls.filter(call => call.method === "machine.update")).toHaveLength(1);
});

it("mc75_updates_track_each_row_on_its_own", async () => {
  const app = createFakeApp();
  const first = Promise.withResolvers<Machine[]>();
  const other: Machine = { ...old, name: "other" };
  const list = await open(app, [old, other]);
  app.handlers["machine.update"] = () => first.promise;

  const a = await within(list).findByRole("button", { name: "Update old" });
  const b = within(list).getByRole("button", { name: "Update other" });
  fireEvent.click(a);
  fireEvent.click(b);
  fireEvent.click(a);
  expect(a.getAttribute("aria-disabled")).toBe("true");
  expect(b.getAttribute("aria-disabled")).toBe("true");
  expect(app.calls.filter(call => call.method === "machine.update")).toHaveLength(2);
  first.resolve([old, other]);
});

it("mc75_a_failed_update_shows_the_line_and_offers_it_again", async () => {
  const app = createFakeApp();
  const list = await open(app, [old]);
  app.handlers["machine.update"] = () => {
    throw new RpcError(-32603, "update_failed: ssh: no route");
  };

  fireEvent.click(await within(list).findByRole("button", { name: "Update old" }));
  await screen.findByText("ssh: no route");
  expect(within(list).getByRole("button", { name: "Update old" }).hasAttribute("disabled")).toBe(false);
  expect(screen.queryByRole("alertdialog")).toBeNull();
});
