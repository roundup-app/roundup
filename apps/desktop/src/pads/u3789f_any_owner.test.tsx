// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { AGENT, openPad, openShelf, padOf } from "./padsFixture";

afterEach(cleanup);

const padRow = async () => (await screen.findByText("notes")).closest<HTMLElement>("[data-shelf-row]")!;

it("u3789f_double_click_opens_and_never_renames", async () => {
  const { app } = await openShelf([padOf("notes", AGENT, "a")]);

  fireEvent.dblClick(await padRow());

  await screen.findByRole("textbox", { name: "Pad body" }, { timeout: 5000 });
  expect(app.calls.filter(call => call.method === "pad.rename")).toEqual([]);
  expect(screen.queryByText(/failed/i)).toBeNull();
});

it("u3789f_f2_and_menu_rename_any_owners_item", async () => {
  const { app } = await openShelf([padOf("notes", AGENT, "a")]);

  fireEvent.keyDown(await screen.findByRole("button", { name: "notes" }), { key: "F2" });
  const field = await screen.findByRole<HTMLInputElement>("textbox");
  fireEvent.input(field, { target: { value: "plan" } });
  fireEvent.keyDown(field, { key: "Enter" });

  await waitFor(() => expect(app.calls.filter(call => call.method === "pad.rename")).toHaveLength(1));
  expect(app.calls.find(call => call.method === "pad.rename")!.params).toMatchObject({ name: "notes", newName: "plan" });
  expect(screen.queryByText(/failed/i)).toBeNull();
});

it("u3789f_a_failure_line_names_its_action", async () => {
  const { app } = await openShelf([padOf("notes", AGENT, "a")]);
  app.handlers["pad.rename"] = () => { throw new Error("name taken"); };

  fireEvent.keyDown(await screen.findByRole("button", { name: "notes" }), { key: "F2" });
  const field = await screen.findByRole<HTMLInputElement>("textbox");
  fireEvent.input(field, { target: { value: "plan" } });
  fireEvent.keyDown(field, { key: "Enter" });

  expect(await screen.findByText(/Rename failed:/)).toBeDefined();
  expect(screen.queryByText(/Open failed:/)).toBeNull();
});

it("u3736_pad_actions_need_no_transfer", async () => {
  const { app } = await openShelf([padOf("notes", AGENT, "a")]);
  const row = await padRow();
  fireEvent.contextMenu(row, { clientX: 10, clientY: 10 });
  expect(app.shownMenus.at(-1)!.items.map(item => item.id)).toEqual(["open", "copy-link", "rename", "delete"]);
  const field = await openPad("notes");

  expect(screen.queryByRole("button", { name: /Assign|Make yours|Open owner/ })).toBeNull();
  expect(field.readOnly).toBe(false);
  fireEvent.input(field, { target: { value: "edited" } });
  fireEvent.blur(field);

  await waitFor(() => expect(app.calls.filter(call => call.method === "pad.write")).toHaveLength(1));
});

it("u3789f_the_user_opens_any_owners_item_every_way", async () => {
  await openShelf([padOf("notes", AGENT, "a")]);

  fireEvent.keyDown(await screen.findByRole("button", { name: "notes" }), { key: "Enter" });

  await screen.findByRole("textbox", { name: "Pad body" }, { timeout: 5000 });
  expect(screen.queryByText(/failed/i)).toBeNull();
});
