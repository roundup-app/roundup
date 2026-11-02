import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { AppSettings } from "./AppSettings";
import { createFakeApp } from "../testing/fakeApp";
import { openPad, openShelf, padOf } from "../pads/padsFixture";
import { USER } from "../testing/nodes";

const settings = async () => {
  render(() => <AppSettings app={createFakeApp()} project={() => null} />);
  await Promise.resolve();
  window.dispatchEvent(new Event("open-app-settings"));
  fireEvent.click(await screen.findByRole("tab", { name: "Pads" }));

  return screen.findByRole("radiogroup", { name: "Default width" });
};

const choose = async (choice: string) => {
  const group = await settings();

  if (choice === "Narrow") {
    fireEvent.click(within(group).getByRole("radio", { name: "Wide" }));
    await waitFor(() => expect(JSON.parse(localStorage.getItem("roundup:app-settings")!).padWidth).toBe("wide"));
  }

  fireEvent.click(within(group).getByRole("radio", { name: choice }));
  await waitFor(() => expect(JSON.parse(localStorage.getItem("roundup:app-settings")!).padWidth).toBe(choice.toLowerCase()));
  fireEvent.click(screen.getByRole("button", { name: "← Back" }));
};

const selected = async (choice: string) => {
  const group = await screen.findByRole("radiogroup", { name: "Width" });
  await waitFor(() => expect(within(group).getByRole<HTMLInputElement>("radio", { name: choice }).checked).toBe(true));
};

afterEach(() => { cleanup(); localStorage.clear(); });

it.each(["Narrow", "Wide", "Full"])("u5560b_saved_default_initialises_each_pad_opening %s", async choice => {
  await choose(choice);
  const { connected } = await openShelf([padOf("one", USER, "text"), padOf("two", USER, "other")]);
  const firstEditor = await openPad("one");
  await selected(choice);
  fireEvent.click(screen.getByRole("radio", { name: choice === "Full" ? "Wide" : "Full" }));
  connected.drawer.close();
  await waitFor(() => expect(firstEditor.isConnected).toBe(false));
  const secondEditor = await openPad("one");
  await selected(choice);
  window.dispatchEvent(new Event("open-app-settings"));
  fireEvent.click(await screen.findByRole("tab", { name: "Pads" }));
  const next = choice === "Full" ? "Wide" : "Full";
  const defaults = await screen.findByRole("radiogroup", { name: "Default width" });
  const current = within(defaults).getByRole("radio", { name: choice });
  current.focus();
  fireEvent.keyDown(current, { key: choice === "Full" ? "ArrowLeft" : "End" });
  await waitFor(() => expect(JSON.parse(localStorage.getItem("roundup:app-settings")!).padWidth).toBe(next.toLowerCase()));
  fireEvent.click(screen.getByRole("button", { name: "← Back" }));
  await selected(choice);
  fireEvent.click(screen.getByRole("button", { name: "Restore" }));
  connected.drawer.close();
  await waitFor(() => expect(secondEditor.isConnected).toBe(false));
  await openPad("two");
  expect(screen.queryAllByRole("radio")).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Maximise" }));
  await selected(next);
});

it.each(["wide", "invalid", null])("u5560b_default_survives_restart_and_defaults_alone %s", async stored => {
  await choose("Wide");
  cleanup();
  const record = JSON.parse(localStorage.getItem("roundup:app-settings")!);
  record.fontSize = 19;

  if (stored === null) delete record.padWidth;
  else record.padWidth = stored;
  localStorage.setItem("roundup:app-settings", JSON.stringify(record));
  const group = await settings();
  const expected = stored === "wide" ? "Wide" : "Narrow";
  expect(within(group).getByRole<HTMLInputElement>("radio", { name: expected }).checked).toBe(true);
  fireEvent.click(screen.getByRole("tab", { name: "Terminal" }));
  expect(await screen.findByRole("spinbutton", { name: "Font size" })).toHaveProperty("value", "19");
  fireEvent.click(screen.getByRole("button", { name: "← Back" }));
  await openShelf([padOf("note", USER, "text")]);
  await openPad("note");
  await selected(expected);
});
