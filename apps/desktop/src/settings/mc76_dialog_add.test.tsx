import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { createRoot, createSignal } from "solid-js";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { Machine } from "@contracts/machine/Machine";
import { createFakeApp } from "../testing/fakeApp";
import { createMachines } from "../state/machines";
import { useBrowserStorage } from "../state/storage";
import { AppSettings } from "./AppSettings";

beforeEach(() => {
  window.localStorage.clear();
  useBrowserStorage(window.localStorage);
});

afterEach(cleanup);

it("mc76_adding_through_the_dialog_shows_the_field", async () => {
  const app = createFakeApp();
  let list: Machine[] = [];
  app.handlers["machine.list"] = () => ({ machines: list, version: "0.1.21" });
  app.handlers["machine.add"] = ({ name }) => (list = [...list, { name, details: {}, reachable: true }]);
  const [tick, setTick] = createSignal(0);

  const machines = createRoot(() => {
    const made = createMachines(app, tick, () => null);

    made.watch(() => true);

    return made;
  });

  render(() => <AppSettings app={app} project={() => "/p"} />);
  await Promise.resolve();
  window.dispatchEvent(new Event("open-app-settings"));
  await screen.findByLabelText("Settings", { selector: "section" });
  fireEvent.click(screen.getByText("Machines", { selector: '[role="tab"]' }));
  fireEvent.click(await screen.findByRole("button", { name: "Add a machine" }));
  expect(machines.names()).toEqual([]);

  const dialog = within(await screen.findByRole("dialog"));
  fireEvent.input(dialog.getByRole("textbox"), { target: { value: "box" } });
  fireEvent.click(dialog.getByRole("button", { name: "Add" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  setTick(1);
  await waitFor(() => expect(machines.names()).toEqual(["box"]));
});
