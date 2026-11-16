import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { Machine } from "@contracts/machine/Machine";
import { RpcError } from "../app/seam";
import { createFakeApp } from "../testing/fakeApp";
import { useBrowserStorage } from "../state/storage";
import { AppSettings } from "./AppSettings";
import { copy } from "./copy";

beforeEach(() => {
  window.localStorage.clear();
  useBrowserStorage(window.localStorage);
});

afterEach(cleanup);

const box: Machine = { name: "box", details: {}, reachable: true };

const dead: Machine = { name: "roundup-ci-control", details: {}, reachable: false };

const rows = () => document.querySelectorAll(".settings-machine:not(:first-child) .settings-machine-state");

const open = async (app: ReturnType<typeof createFakeApp>, machines: Machine[], version = "0.1.21", hosts: string[] = [], failing = false) => {
  let list = machines;

  if (!failing) app.handlers["machine.list"] = () => ({ machines: list, version });
  app.handlers["machine.sshHosts"] = () => hosts;
  app.handlers["machine.remove"] = ({ name }) => (list = list.filter(m => m.name !== name));
  app.handlers["machine.add"] = ({ name }) => (list = [...list, { name, details: {}, reachable: true }]);
  render(() => <AppSettings app={app} project={() => "/p"} />);
  await Promise.resolve();
  window.dispatchEvent(new Event("open-app-settings"));
  await screen.findByLabelText("Settings", { selector: "section" });
  fireEvent.click(screen.getByText("Machines", { selector: '[role="tab"]' }));

  return await screen.findByRole("list", { name: "Machines" });
};

it("mc70_machines_page_lists_this_computer_first_then_the_others", async () => {
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

const openDialog = async () => within(await screen.findByRole("dialog"));

it("mc70_no_other_machines_reads_the_empty_line", async () => {
  await open(createFakeApp(), []);

  await screen.findByText("No other machines yet.");
});

it("mc70_the_page_has_no_add_field_and_the_button_opens_the_dialog", async () => {
  const app = createFakeApp();
  await open(app, []);
  const button = await screen.findByRole("button", { name: "Add a machine" });

  expect(within(button.closest<HTMLElement>(".settings-machines-page") ?? document.body).queryByRole("textbox")).toBeNull();
  button.focus();
  fireEvent.click(button);
  await openDialog();
  await waitFor(() => expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true));
  await new Promise(done => setTimeout(done, 50));
  fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(button));
});

it("mc73_the_dialog_lists_the_hosts_and_a_row_add_calls_machine_add", async () => {
  const app = createFakeApp();
  const list = await open(app, [], "0.1.21", ["nas", "gpu"]);
  fireEvent.click(await screen.findByRole("button", { name: "Add a machine" }));
  const dialog = await openDialog();

  expect(dialog.getAllByRole("listitem")).toHaveLength(2);
  fireEvent.click(dialog.getByRole("button", { name: "Add gpu" }));
  await within(list).findByText("gpu");
  expect(app.calls.find(call => call.method === "machine.add")?.params).toEqual({ name: "gpu" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

it("mc73_the_typed_add_calls_machine_add_closes_the_dialog_and_shows_the_row", async () => {
  const app = createFakeApp();
  const list = await open(app, []);
  fireEvent.click(await screen.findByRole("button", { name: "Add a machine" }));
  const dialog = await openDialog();
  fireEvent.input(dialog.getByRole("textbox"), { target: { value: " me@build-box " } });
  fireEvent.click(dialog.getByRole("button", { name: "Add" }));
  await within(list).findByText("me@build-box");
  expect(app.calls.find(call => call.method === "machine.add")?.params).toEqual({ name: "me@build-box" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

it("mc73_empty_entry_submits_nothing", async () => {
  const app = createFakeApp();
  await open(app, []);
  fireEvent.click(await screen.findByRole("button", { name: "Add a machine" }));
  const dialog = await openDialog();
  fireEvent.input(dialog.getByRole("textbox"), { target: { value: "   " } });
  fireEvent.click(dialog.getByRole("button", { name: "Add" }));
  expect(app.calls.some(call => call.method === "machine.add")).toBe(false);
});

it("mc73_no_ssh_config_shows_the_typed_field_alone", async () => {
  await open(createFakeApp(), []);
  fireEvent.click(await screen.findByRole("button", { name: "Add a machine" }));
  const dialog = await openDialog();

  expect(dialog.getAllByRole("textbox")).toHaveLength(1);
  expect(dialog.queryAllByRole("listitem")).toHaveLength(0);
});

it("mc73_a_failing_add_keeps_the_dialog_the_text_and_shows_the_sentence", async () => {
  const app = createFakeApp();
  await open(app, []);
  app.handlers["machine.add"] = () => {
    throw new RpcError(-32603, "unreachable: ssh: connect to host nowhere port 22: No route (-32000, unreachable)");
  };

  fireEvent.click(await screen.findByRole("button", { name: "Add a machine" }));
  const dialog = await openDialog();
  const field = dialog.getByRole("textbox");
  fireEvent.input(field, { target: { value: "nowhere" } });
  fireEvent.click(dialog.getByRole("button", { name: "Add" }));
  await dialog.findByText(/Couldn't reach nowhere over ssh/);
  // SAFETY: the field is an input element.
  expect((field as HTMLInputElement).value).toBe("nowhere");
  expect(dialog.queryByText(/No route|-32000/)).toBeNull();
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(rows()).toHaveLength(0);
});

const kinds = ["name_taken", "already_added", "unreachable", "hc_missing", "incompatible", "machine_unknown", "needs_update", "unavailable", "invalid_params", "core_missing", "core_too_old", "core_closed", "core_silent", "update_failed", "this_mac"];

it("mc71_a_failed_action_shows_the_mapped_sentence_and_no_core_text", async () => {
  const app = createFakeApp();
  const list = await open(app, [box]);

  for (const kind of kinds) {
    app.handlers["machine.remove"] = () => {
      throw new RpcError(-32603, `${kind}: missing field \`machine\` (-32602, invalid_params): see hc schema {"error":1}`);
    };

    fireEvent.click(await within(list).findByRole("button", { name: "Remove box" }));
    await waitFor(() => expect(app.questions).toHaveLength(1));
    app.answerQuestion?.(true);
    const alert = await screen.findByRole("alert");
    const text = document.body.textContent ?? "";

    expect(alert.textContent).toMatch(/\.$/);
    expect(text).not.toMatch(/-32602|invalid_params|see hc schema|\{|missing field/);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    app.questions.length = 0;
  }
});

it("mc71_an_unmapped_kind_reads_the_fallback_sentence", async () => {
  const app = createFakeApp();
  const list = await open(app, [box]);
  app.handlers["machine.remove"] = () => {
    throw new RpcError(-32603, "strange_thing: whatever the core said");
  };

  fireEvent.click(await within(list).findByRole("button", { name: "Remove box" }));
  await waitFor(() => expect(app.questions).toHaveLength(1));
  app.answerQuestion?.(true);
  await screen.findByText("Couldn't remove box. Try again.");
  expect(screen.queryByText(/whatever/)).toBeNull();
});

it("mc71_a_failing_list_shows_a_sentence_not_an_empty_page", async () => {
  const app = createFakeApp();
  app.handlers["machine.list"] = () => {
    throw new RpcError(-32603, "core_missing: herdr-core is missing");
  };

  const list = await open(app, [], "0.1.21", [], true);
  await within(list).findByText(/herdr isn't installed on this computer/);
  expect(screen.queryByText(copy.noOtherMachines)).toBeNull();
});

it("mc71_this_computer_cannot_be_removed", async () => {
  const list = await open(createFakeApp(), [box]);
  await within(list).findByRole("button", { name: "Remove box" });
  const [first] = within(list).getAllByRole("listitem");

  expect(first && within(first).queryByRole("button")).toBeNull();
});

it("mc74_this_computer_shows_connected_with_the_core_version", async () => {
  const list = await open(createFakeApp(), [], "0.1.21");
  const [first] = within(list).getAllByRole("listitem");

  await waitFor(() => expect(first?.textContent).toContain(copy.machineConnected("0.1.21")));
});

it("mc74_this_computer_without_a_core_reads_not_connected_and_why", async () => {
  for (const [kind, words] of [["core_missing", /isn't installed/], ["core_too_old", /too old/]] as const) {
    cleanup();
    const app = createFakeApp();
    app.handlers["machine.list"] = () => {
      throw new RpcError(-32603, `${kind}: x`);
    };

    const list = await open(app, [], "0.1.21", [], true);
    const [first] = within(list).getAllByRole("listitem");

    await waitFor(() => expect(first?.textContent).toContain(copy.machineNotConnected));
    expect(first?.textContent).toMatch(words);
  }
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

it("mc75_a_failed_update_shows_the_sentence_not_the_json_and_offers_it_again", async () => {
  const app = createFakeApp();
  const list = await open(app, [old]);
  app.handlers["machine.update"] = () => {
    throw new RpcError(-32603, 'machine_unknown: {"error":{"kind":"machine_unknown"}}');
  };

  fireEvent.click(await within(list).findByRole("button", { name: "Update old" }));
  await screen.findByText(/old isn't in your machine list/);
  expect(within(list).getByRole("button", { name: "Update old" }).hasAttribute("disabled")).toBe(false);
  const text = list.textContent ?? "";

  expect(text).not.toMatch(/[{}]/);
  expect(screen.queryByRole("alertdialog")).toBeNull();
});
