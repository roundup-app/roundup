import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { expect, it } from "vitest";
import { App } from "../App";
import { fakeEmulators } from "../terminal/paneHarness";
import { seedApp } from "../testing/seeds";
import { showEverythingInApp } from "../testing/showEverything";
import { rpcCalls } from "../testing/appFixture";

const open = async () => {
  const controls = seedApp("tree-40", 0);
  render(() => <App app={controls.app} reducedMotion={() => true} clock={() => 0} createEmulator={fakeEmulators().factory} />);
  await showEverythingInApp();

  return controls;
};

it("u3789a_click_selects_without_opening", async () => {
  const { app } = await open();
  const row = document.querySelector<HTMLButtonElement>('.todos-tab [data-todo="1"] .todo-row-button')!;
  const before = app.calls.length;
  fireEvent.click(row);
  fireEvent.click(row);
  expect(row.getAttribute("aria-pressed")).toBe("true");
  expect(document.activeElement).toBe(row);
  expect(document.querySelector('.drawer[data-open="true"]')).toBeNull();
  expect(app.calls.slice(before).filter(call => ["todo.get", "todo.readHistory", "todo.getHistory", "agent.resume", "agent.spawn"].includes(call.method))).toEqual([]);
});

it("u3789a_return_and_open_activate_once", async () => {
  const { app } = await open();
  const row = document.querySelector<HTMLButtonElement>('.todos-tab [data-todo="1"] .todo-row-button')!;
  row.focus();
  fireEvent.keyDown(row, { key: "Enter", code: "Enter" });
  await screen.findByRole("complementary", { name: "Drawer" });
  await waitFor(() => expect(rpcCalls(app, "todo.readHistory")).toHaveLength(1));
});
