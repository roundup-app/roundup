// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { mountTodos, todo, todoCallsTo as callsTo } from "./testHarness";

afterEach(cleanup);

const owned = () => todo(1, { title: "agent work", owner: { kind: "agent", id: "a", parent: null } });

const row = () => screen.findByRole("button", { name: /^(?:Idle|Blocked|Done) #1 / });

it("u3789f_double_click_opens_and_never_renames", async () => {
  const { app } = await mountTodos([owned()]);

  fireEvent.dblClick(await row());

  await waitFor(() => expect(document.querySelector(".drawer")?.getAttribute("data-open")).toBe("true"));
  expect(screen.queryByRole("textbox", { name: /rename|title/i })).toBeNull();
  expect(callsTo(app, "todo.update")).toEqual([]);
});

it("u3789f_f2_and_menu_rename_any_owners_item", async () => {
  const { app } = await mountTodos([owned()]);

  { const focusedRow = await row(); focusedRow.focus(); fireEvent.keyDown(focusedRow, { key: "F2", code: "F2" }); }

  const field = await screen.findByRole<HTMLInputElement>("textbox");
  fireEvent.input(field, { target: { value: "renamed" } });
  fireEvent.keyDown(field, { key: "Enter" });

  await waitFor(() => expect(callsTo(app, "todo.update")).toHaveLength(1));
  expect(callsTo(app, "todo.update")[0]!.params).toMatchObject({ id: 1, title: "renamed" });
  expect(screen.queryByText(/failed/i)).toBeNull();
});
