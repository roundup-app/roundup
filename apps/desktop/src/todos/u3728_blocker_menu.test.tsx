import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { mountTodos, todo, todoCallsTo } from "./testHarness";

afterEach(cleanup);

const panel = () => screen.getByRole("complementary", { name: "Drawer" });

const openMenu = async (todos = [todo(1, { title: "alpha" }), todo(2, { title: "beta" }), todo(3, { title: "gamma" })], id = 1) => {
  const mounted = await mountTodos(todos);
  fireEvent.click(await screen.findByRole("button", { name: new RegExp(`^(Idle|Blocked) #${id} `) }));
  const button = await within(panel()).findByRole("button", { name: /Blocker/ });
  fireEvent.click(button);
  await screen.findByRole("combobox");

  return { ...mounted, button };
};

const rows = () => screen.queryAllByRole("option").map((option) => option.textContent);

it("u3728_blocker_menu_filters_picks_and_escapes", async () => {
  const { app, button } = await openMenu();
  expect(within(panel()).queryByRole("option")).toBeNull();
  const input = screen.getByRole("combobox");
  input.focus();
  fireEvent.input(input, { target: { value: "#3" } });
  await waitFor(() => expect(rows()).toEqual(["gamma#3"]));
  fireEvent.input(input, { target: { value: "bet" } });
  await waitFor(() => expect(rows()).toEqual(["beta#2"]));
  fireEvent.keyDown(input, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("combobox")).toBeNull());
  expect(todoCallsTo(app, "todo.setBlockers")).toHaveLength(0);
  expect(document.activeElement).toBe(button);

  fireEvent.click(button);
  fireEvent.input(await screen.findByRole("combobox"), { target: { value: "gam" } });
  await waitFor(() => expect(rows()).toEqual(["gamma#3"]));
  fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
  await waitFor(() => expect(todoCallsTo(app, "todo.setBlockers").map((call) => call.params)).toEqual([{ id: 1, blockers: [3], expected_change: 1 }]));
  await waitFor(() => expect(screen.queryByRole("combobox")).toBeNull());
  expect(panel().contains(document.activeElement)).toBe(true);
});

it("u3728_blocker_menu_omits_cycles_and_current_blockers", async () => {
  // 2 waits on 1 (a cycle if 1 waited on 2); 3 waits on 2 (a longer cycle); 4 is already a blocker of 1; 5 is free.
  await openMenu([todo(4), todo(1, { blockers: [4], blocked: true }), todo(2, { blockers: [1], blocked: true }), todo(3, { blockers: [2], blocked: true }), todo(5, { title: "free" })], 1);
  expect(rows()).toEqual(["free#5"]);
});
