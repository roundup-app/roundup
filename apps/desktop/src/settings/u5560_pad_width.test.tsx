import userEvent from "@testing-library/user-event";
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

it.each(["Narrow", "Wide", "Full"].flatMap(choice => ["close", "switch", "collapsed"].map(path => [choice, path])))("u5560b_saved_default_initialises_each_pad_opening %s %s", async (choice, path) => {
  await choose(choice);
  const { connected } = await openShelf([padOf("one", USER, "text"), padOf("two", USER, "other")]);
  const editor = await openPad("one");
  await selected(choice);
  const local = choice === "Full" ? "Wide" : "Full";
  fireEvent.click(screen.getByRole("radio", { name: local }));
  await selected(local);

  if (path === "collapsed") {
    fireEvent.click(screen.getByRole("radio", { name: choice }));
    await selected(choice);
    window.dispatchEvent(new Event("open-app-settings"));
    fireEvent.click(await screen.findByRole("tab", { name: "Pads" }));
    const defaults = await screen.findByRole("radiogroup", { name: "Default width" });
    within(defaults).getByRole("radio", { name: choice }).focus();
    const user = userEvent.setup();

    for (let step = 0; step < (choice === "Narrow" ? 2 : 1); step++) await user.keyboard(choice === "Full" ? "{ArrowLeft}" : "{ArrowRight}");
    await waitFor(() => expect(JSON.parse(localStorage.getItem("roundup:app-settings")!).padWidth).toBe(local.toLowerCase()));
    fireEvent.click(screen.getByRole("button", { name: "← Back" }));
    await selected(choice);
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
  }

  if (path !== "switch") {
    connected.drawer.close();
    await waitFor(() => expect(editor.isConnected).toBe(false));
  }

  await openPad(path === "close" ? "one" : "two");

  if (path === "collapsed") {
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Maximise" }));
  }

  await selected(path === "collapsed" ? local : choice);
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
