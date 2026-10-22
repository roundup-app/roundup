import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { RpcError } from "../app/seam";
import { agent, workstream } from "../testing/nodes";
import { mountTodos, todo, todoCallsTo as callsTo } from "./testHarness";

afterEach(cleanup);

const pick = async (radio: HTMLElement) => {
  fireEvent.click(radio);
  await waitFor(() => expect(radio.closest("label")?.getAttribute("data-state")).toBe("checked"));
};

const mount = () => mountTodos([todo(1, { title: "Ship the login fix", owner: { kind: "user", id: "you", parent: null } }), todo(2, { title: "Write docs" }), todo(3, { title: "Done thing", done: true })], true, [agent("a", "idle", "A", { name: "alpha" })]);

const openPicker = async () => {
  const row = await screen.findByRole("button", { name: /#1 Ship the login fix/ });

  row.focus();
  fireEvent.keyDown(row, { key: "o", code: "KeyO" });

  return within(await screen.findByRole("menu", { name: "Owners for #1" }));
};

const openDialog = async () => {
  fireEvent.click((await openPicker()).getByText("New Workstream…"));

  return screen.findByRole("dialog", { name: "New Workstream" });
};

it("u3743_the_picker_offers_new_workstream_between_agents_and_unassigned", async () => {
  await mount();
  const picker = await openPicker();

  expect(picker.getAllByRole("menuitem").map(item => item.textContent)).toEqual(["alpha", "New Workstream…", "Unassigned"]);
});

it("u3743_create_calls_start_workstream_once_with_the_chosen_start", async () => {
  const { app } = await mount();

  app.handlers["todo.startWorkstream"] = () => workstream("w9", { name: "Ship the login fix" });

  const dialog = within(await openDialog());

  expect(dialog.getByLabelText<HTMLTextAreaElement>("Workstream name").value).toBe("Ship the login fix");
  expect(dialog.getAllByRole("radio").map(radio => radio.closest("label")?.textContent)).toEqual(["Start now", "Start when a slot frees", "Start after another Todo"]);
  expect(dialog.getByRole<HTMLInputElement>("radio", { name: "Start when a slot frees" }).checked).toBe(true);
  await pick(dialog.getByRole("radio", { name: "Start now" }));
  fireEvent.input(dialog.getByLabelText("Workstream name"), { target: { value: "Login" } });
  fireEvent.click(dialog.getByRole("button", { name: "Create" }));

  await waitFor(() => expect(screen.queryByRole("dialog", { name: "New Workstream" })).toBeNull());
  expect(callsTo(app, "todo.startWorkstream")).toHaveLength(1);
  expect(callsTo(app, "todo.startWorkstream")[0]?.params).toEqual({ id: 1, name: "Login", start: { kind: "now" } });
  expect(callsTo(app, "todo.assign")).toHaveLength(0);
  expect(callsTo(app, "todo.move")).toHaveLength(0);
});

it("u3743_after_todo_needs_a_picked_todo_and_a_name_is_required", async () => {
  const { app } = await mount();

  app.handlers["todo.startWorkstream"] = () => workstream("w9");

  const dialog = within(await openDialog());
  const create = () => dialog.getByRole<HTMLButtonElement>("button", { name: "Create" });

  fireEvent.input(dialog.getByLabelText("Workstream name"), { target: { value: "  " } });
  expect(create().getAttribute("aria-disabled")).toBe("true");
  fireEvent.input(dialog.getByLabelText("Workstream name"), { target: { value: "Docs" } });
  expect(create().getAttribute("aria-disabled")).toBe("false");
  await pick(dialog.getByRole("radio", { name: "Start after another Todo" }));
  expect(create().getAttribute("aria-disabled")).toBe("true");

  fireEvent.click(await dialog.findByRole("button", { name: "Choose a Todo" }));
  const options = within(await screen.findByRole("listbox")).getAllByRole("option");

  expect(options.map(option => option.textContent)).toEqual(expect.arrayContaining(["Write docs#2"]));
  expect(options.map(option => option.textContent).join()).not.toContain("Ship the login fix");
  expect(options.map(option => option.textContent).join()).not.toContain("Done thing");
  fireEvent.click(options.find(option => option.textContent?.includes("#2"))!);
  await waitFor(() => expect(create().getAttribute("aria-disabled")).toBe("false"));
  fireEvent.click(create());

  await waitFor(() => expect(callsTo(app, "todo.startWorkstream")).toHaveLength(1));
  expect(callsTo(app, "todo.startWorkstream")[0]?.params).toEqual({ id: 1, name: "Docs", start: { kind: "afterTodo", todo: 2 } });
});

it("u3743_esc_cancels_with_no_call_and_a_refusal_keeps_the_values", async () => {
  const { app } = await mount();

  app.handlers["todo.startWorkstream"] = () => { throw new RpcError(-32602, "todo 1 is done"); };

  const dialog = within(await openDialog());

  fireEvent.input(dialog.getByLabelText("Workstream name"), { target: { value: "Keep me" } });
  fireEvent.click(dialog.getByRole("button", { name: "Create" }));

  expect(await dialog.findByText("todo 1 is done")).toBeTruthy();
  expect(dialog.getByLabelText<HTMLTextAreaElement>("Workstream name").value).toBe("Keep me");
  expect(screen.getByRole("dialog", { name: "New Workstream" })).toBeTruthy();

  fireEvent.keyDown(dialog.getByLabelText("Workstream name"), { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "New Workstream" })).toBeNull());
  expect(callsTo(app, "todo.startWorkstream")).toHaveLength(1);
});
