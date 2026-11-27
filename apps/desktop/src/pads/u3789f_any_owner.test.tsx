// @vitest-environment jsdom
import { flush } from "solid-js";
import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { AGENT, openPad, openShelf, padOf, padShown } from "./padsFixture";
import { RpcError } from "../app/seam";

afterEach(cleanup);

const padRow = async () => (await screen.findByText("notes")).closest<HTMLElement>("[data-shelf-row]")!;

it("u7641a_a_double_click_beside_a_pad_name_opens_the_pad", async () => {
  const { app } = await openShelf([padOf("notes", AGENT, "a")]);

  fireEvent.dblClick(await padRow());

  expect((await padShown()).matches("[data-walk]")).toBe(true);
  expect(app.calls.filter(call => call.method === "pad.rename")).toEqual([]);
  expect(screen.queryByText(/failed/i)).toBeNull();
});

it("u7641a_double_click_on_the_open_pads_title_renames_it_in_place", async () => {
  const { app } = await openShelf([padOf("notes", AGENT, "a")]);
  await openPad("notes");
  const title = () => screen.getByText("notes", { selector: ".pad-head-name" });

  fireEvent.dblClick(title());
  const field = await screen.findByRole<HTMLInputElement>("textbox", { name: "Name" });
  fireEvent.keyDown(field, { key: "Escape" });
  await waitFor(() => expect(field.isConnected).toBe(false));
  expect(app.calls.filter(call => call.method === "pad.rename")).toEqual([]);
  expect(title().isConnected).toBe(true);

  fireEvent.dblClick(title());
  const again = await screen.findByRole<HTMLInputElement>("textbox", { name: "Name" });
  flush();
  fireEvent.input(again, { target: { value: "plan" } });
  fireEvent.keyDown(again, { key: "Enter" });

  await waitFor(() => expect(app.calls.filter(call => call.method === "pad.rename")).toHaveLength(1));
  expect(app.calls.find(call => call.method === "pad.rename")!.params).toMatchObject({ name: "notes", newName: "plan" });
  await screen.findByText("plan", { selector: ".pad-head-name" });
});

it("u3789f_f2_and_menu_rename_any_owners_item", async () => {
  const { app } = await openShelf([padOf("notes", AGENT, "a")]);

  const row = await screen.findByRole("button", { name: "notes" });
  row.focus();
  fireEvent.keyDown(row, { key: "F2", code: "F2" });
  const field = await screen.findByRole<HTMLInputElement>("textbox");
  // The field's pending update must land before the typing: left pending, it writes the field's value back.
  flush();
  fireEvent.input(field, { target: { value: "plan" } });
  fireEvent.keyDown(field, { key: "Enter" });

  await waitFor(() => expect(app.calls.filter(call => call.method === "pad.rename")).toHaveLength(1));
  expect(app.calls.find(call => call.method === "pad.rename")!.params).toMatchObject({ name: "notes", newName: "plan" });
  expect(screen.queryByText(/failed/i)).toBeNull();
});

it("u3789f_a_failure_line_names_its_action", async () => {
  const { app } = await openShelf([padOf("notes", AGENT, "a")]);
  app.handlers["pad.rename"] = () => { throw new RpcError(-32003, "name taken"); };

  const row = await screen.findByRole("button", { name: "notes" });
  row.focus();
  fireEvent.keyDown(row, { key: "F2", code: "F2" });
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

  const row = await screen.findByRole("button", { name: "notes" });
  row.focus();
  fireEvent.keyDown(row, { key: "Enter", code: "Enter" });

  expect((await padShown()).matches("[data-walk]")).toBe(true);
  expect(screen.queryByText(/failed/i)).toBeNull();
});
