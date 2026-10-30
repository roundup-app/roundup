import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { RequestedApp as App } from "../testing/requestedApp";
import { fakeEmulators } from "../terminal/paneHarness";
import { seedApp } from "../testing/seeds";
import { showEverythingInApp } from "../testing/showEverything";

afterEach(() => { cleanup(); localStorage.clear(); });

const open = async () => {
  const controls = seedApp("tree-40", 0);
  const tree = controls.app.handlers["rail.tree"]!;
  // Scope selection needs a Workstream and its Agent; the dense seed makes disposal dominate this proof.
  controls.app.handlers["rail.tree"] = async params => (await tree(params)).filter(node => node.id === "backend" || node.id === "migrate");
  render(() => <App app={controls.app} reducedMotion={() => true} clock={() => 0} createEmulator={fakeEmulators().factory} />);
  await showEverythingInApp();

  return controls;
};

const line = () => document.querySelector<HTMLElement>("[data-shelf-scope]")!;

const select = async (name: string) => {
  fireEvent.click([...document.querySelectorAll<HTMLElement>(".rail-row")].find(row => row.textContent!.trim().startsWith(name))!);
  await waitFor(() => expect(within(line()).getByRole("button", { name: `add todo to ${name}` })).toBeTruthy());
};

it("u3730_the_scope_line_holds_the_name_and_one_add_button", async () => {
  // Rule 10: visible label/order checks retire to the critic; this test retains accessible scope and unique creation.
  const { app } = await open();

  const expectScope = async (name: string) => {
    await waitFor(() => expect(within(line()).getByRole("button", { name: `add todo to ${name}` })).toBeTruthy());
    expect(within(line()).getAllByRole("button", { name: /^add todo to / })).toHaveLength(1);
  };

  await expectScope("Overview");
  await select("backend");
  await expectScope("backend");
  await app.rpc("rail.rename", { id: "backend", name: "Renamed work" });
  await expectScope("Renamed work");
  await select("migrate-db");
  await expectScope("migrate-db");
});

it("u3730_add_files_into_the_scope_and_returns_focus", async () => {
  const { app } = await open();
  await select("backend");
  fireEvent.click(within(line()).getByRole("button", { name: "add todo to backend" }));
  const field = await screen.findByRole("textbox", { name: /new todo/i });
  await waitFor(() => expect(document.activeElement).toBe(field));
  fireEvent.input(field, { target: { value: "scoped" } });
  fireEvent.keyDown(field, { key: "Enter" });
  await waitFor(() => expect(app.calls.map(call => call.method)).toContain("todo.create"));
  expect(app.calls.find(call => call.method === "todo.create")!.params).toMatchObject({ title: "scoped" });
  await waitFor(() => expect(app.calls.map(call => call.method)).toContain("todo.move"));
  expect(app.calls.find(call => call.method === "todo.move")!.params).toMatchObject({ home: expect.any(String) });
  fireEvent.click(within(line()).getByRole("button", { name: "add todo to backend" }));
  const again = await screen.findByRole("textbox", { name: /new todo/i });
  fireEvent.keyDown(again, { key: "Escape" });
  await waitFor(() => expect(document.activeElement).toBe(within(line()).getByRole("button", { name: "add todo to backend" })));
});

it("u3730_no_group_or_row_repeats_the_scope_name", async () => {
  await open();
  await select("backend");
  const repeats = () => [...document.querySelectorAll(".shelf-panel [data-shelf-group] .shelf-group-control, .shelf-panel .shelf-row")].filter(element => element.textContent === "backend" || element.closest("[hidden]") === null && element.textContent!.trim().startsWith("backend"));
  expect(repeats()).toEqual([]);
  fireEvent.click(within(screen.getByRole("tablist", { name: "Bench" })).getByRole("tab", { name: /^Pads/ }));
  await showEverythingInApp();
  expect(document.querySelector('[data-shelf-group="backend"]')).toBeNull();
});
