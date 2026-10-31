// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { RpcError } from "../app/seam";
import { AGENT, openShelf, padOf } from "../pads/padsFixture";
import { mountTodos, todo } from "./testHarness";

afterEach(cleanup);

const noReply = (method: string) => new RpcError(-32603, `no reply to ${method} within 5s`);

it("u5172a_unanswered_todo_toggle_shows_the_asked_state_marked_applying", async () => {
  const { app } = await mountTodos([todo(3)]);
  app.handlers["todo.complete"] = () => { throw noReply("todo.complete"); };

  const box = await screen.findByRole<HTMLInputElement>("checkbox", { name: "Complete todo 3" });

  fireEvent.click(box);
  await waitFor(() => expect(box.getAttribute("aria-busy")).toBe("true"));
  expect(box.checked).toBe(true);
  expect(screen.queryByRole("alert")).toBeNull();
});

it("u5172a_unanswered_pad_rename_shows_the_asked_name_marked_applying", async () => {
  const { app } = await openShelf([padOf("notes", AGENT, "a")]);
  app.handlers["pad.rename"] = () => { throw noReply("pad.rename"); };

  const row = await screen.findByRole("button", { name: "notes" });
  row.focus();
  fireEvent.keyDown(row, { key: "F2", code: "F2" });
  const field = await screen.findByRole<HTMLInputElement>("textbox");
  fireEvent.input(field, { target: { value: "plan" } });
  fireEvent.keyDown(field, { key: "Enter" });

  const renamed = await screen.findByRole("button", { name: "plan" });
  expect(renamed.getAttribute("aria-busy")).toBe("true");
  expect(screen.queryByText(/Rename failed:/)).toBeNull();
});
