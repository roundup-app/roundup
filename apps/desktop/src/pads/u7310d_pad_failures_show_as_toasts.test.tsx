import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { notice, notices } from "../testing/notices";
import { USER } from "./owner";
import { openPad, openShelf, padOf, RpcError } from "./padsFixture";

afterEach(cleanup);

const panel = () => screen.getByRole("complementary", { name: "Drawer" });

const toasts = () => screen.getByRole("region", { name: "Updates" });

const messageLines = () => [...panel().querySelectorAll(".reserved-line")];

it("u7310d_pad_failures_show_as_toasts", async () => {
  const { app, state } = await openShelf([padOf("notes", USER, "one")]);
  const field = await openPad("notes");
  expect(messageLines()).toEqual([]);
  const write = app.handlers["pad.write"];

  if (!write) throw new Error("the fixture answers pad.write");

  app.handlers["pad.write"] = () => { throw new RpcError(-32002, "Write refused"); };

  fireEvent.input(field, { target: { value: "one two" } });
  fireEvent.focusOut(field);

  const shown = await waitFor(() => notice("alert"));
  expect(notices("alert")).toEqual([shown]);
  expect(toasts().contains(shown)).toBe(true);
  expect(messageLines()).toEqual([]);
  expect(field.value).toBe("one two");

  fireEvent.click(within(toasts()).getByRole("button", { name: "Dismiss" }));
  await waitFor(() => expect(shown.isConnected).toBe(false));
  expect(messageLines()).toEqual([]);

  // A refused write leaves the draft to save again: the next edit writes it.
  app.handlers["pad.write"] = write;
  fireEvent.input(field, { target: { value: "one two three" } });
  fireEvent.focusOut(field);
  await waitFor(() => expect(state.pads.map(pad => pad.text)).toEqual(["one two three"]));
  expect(notices("alert")).toEqual([]);
});
