import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, expect, it } from "vitest";
import { CHORDS, ariaChord } from "../keys/chords";
import { createFakeApp } from "../testing/fakeApp";
import { AppSettings } from "../settings/AppSettings";
import { storedSettings } from "../settings/preferences";
import { useBrowserStorage } from "../state/storage";
import { ToastHost } from "../testing/toastHost";
import { IconButton } from "./IconButton";
import { Tip } from "./Tip";

beforeEach(() => { window.localStorage.clear(); useBrowserStorage(window.localStorage); });

afterEach(cleanup);

const hover = (button: HTMLElement) => {
  fireEvent.pointerEnter(button, { pointerType: "mouse" });
};

const showOnce = async (name: string) => {
  const button = screen.getByRole("button", { name });

  hover(button);
  await screen.findByRole("tooltip");
  fireEvent.pointerLeave(button, { pointerType: "mouse", clientX: 900, clientY: 900 });
  await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
};

const icons = () => <><IconButton aria-label="Alpha">a</IconButton><IconButton aria-label="Beta">b</IconButton></>;

it("u7489a_a_fixed_tooltip_opens_once_per_icon", async () => {
  render(icons);

  await showOnce("Alpha");
  expect(storedSettings().tipShows).toEqual({ Alpha: 1 });
  hover(screen.getByRole("button", { name: "Alpha" }));
  await new Promise(done => setTimeout(done, 300));
  expect(screen.queryByRole("tooltip")).toBeNull();
  await showOnce("Beta");
  expect(storedSettings().tipShows.Beta).toBe(1);
});

it("u7489a_the_counts_survive_a_launch", async () => {
  window.localStorage.setItem("roundup:app-settings", JSON.stringify({ tipShows: { Alpha: 1 } }));
  useBrowserStorage(window.localStorage);
  render(icons);
  hover(screen.getByRole("button", { name: "Alpha" }));
  await new Promise(done => setTimeout(done, 300));
  expect(screen.queryByRole("tooltip")).toBeNull();
});

it("u7650a_a_changing_tooltip_opens_under_every_choice", async () => {
  render(() => <Tip kind="changing" text="Working">{trigger => <button {...trigger()}>Status</button>}</Tip>);

  for (const iconNames of ["hide", "once", "always"]) {
    window.localStorage.setItem("roundup:app-settings", JSON.stringify({ iconNames }));
    useBrowserStorage(window.localStorage);

    for (let i = 0; i < 2; i++) await showOnce("Status");
  }

  expect(storedSettings().tipShows).toEqual({});
});

it("u7489b_a_retired_icon_keeps_its_accessible_name", async () => {
  window.localStorage.setItem("roundup:app-settings", JSON.stringify({ tipShows: { Alpha: 1 } }));
  useBrowserStorage(window.localStorage);
  render(() => <IconButton aria-label="Alpha" action="shelf.maximise">a</IconButton>);
  const button = screen.getByRole("button", { name: "Alpha" });

  hover(button);
  await new Promise(done => setTimeout(done, 300));
  expect(screen.queryByRole("tooltip")).toBeNull();
  expect(button.getAttribute("aria-keyshortcuts")).toBe(ariaChord(CHORDS["shelf.maximise"]));
});

const sources = (dir: string): string[] => readdirSync(dir).flatMap(entry => {
  const path = join(dir, entry);

  return statSync(path).isDirectory() ? sources(path) : entry.endsWith(".tsx") && !/\.test\./.test(entry) ? [path] : [];
});

it("u7489b_every_tip_is_sorted_fixed_or_changing", () => {
  const bare = sources("src").flatMap(file => [...readFileSync(file, "utf8").matchAll(/<Tip\b(?![^>]*\bkind=)/g)].map(() => file));
  const fixed = sources("src").flatMap(file => [...readFileSync(file, "utf8").matchAll(/<Tip kind="fixed"/g)].map(() => file)).sort();

  expect(bare).toEqual([]);
  expect(fixed).toEqual([
    "src/bubbles/Bubbles.tsx", "src/pads/PadRichEditor.tsx", "src/pads/PadRichEditor.tsx", "src/rail/RailToggle.tsx", "src/ui/BusyButton.tsx", "src/ui/IconButton.tsx",
  ]);
});

const settingsOpen = async () => {
  render(() => <ToastHost><AppSettings app={createFakeApp()} project={() => "/p"} />{icons()}</ToastHost>);
  window.dispatchEvent(new Event("open-app-settings"));
  await screen.findByLabelText("Settings", { selector: "section" });
  fireEvent.click(screen.getByText("Appearance", { selector: '[role="tab"]' }));
};

const hoverCount = async (name: string, wait = 300) => {
  const button = screen.getByRole("button", { name });
  let opened = 0;

  for (let i = 0; i < 2; i++) {
    hover(button);
    await new Promise(done => setTimeout(done, wait));

    if (screen.queryByRole("tooltip")) opened++;
    fireEvent.pointerLeave(button, { pointerType: "mouse", clientX: 900, clientY: 900 });
    await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
  }

  return opened;
};

it("u7650a_icon_names_is_a_three_way_choice", async () => {
  await settingsOpen();

  for (const label of ["Hide", "Show once", "Always show"]) expect(await screen.findByText(label)).toBeTruthy();
  expect(storedSettings().iconNames).toBe("once");
});

it("u7650a_each_choice_opens_a_name_tooltip_0_1_or_every_time", async () => {
  for (const [iconNames, opens] of [["hide", 0], ["once", 1], ["always", 2]] as const) {
    cleanup();
    window.localStorage.clear();
    window.localStorage.setItem("roundup:app-settings", JSON.stringify({ iconNames }));
    useBrowserStorage(window.localStorage);
    render(icons);

    expect(await hoverCount("Alpha")).toBe(opens);

    if (iconNames === "once") expect(await hoverCount("Beta")).toBe(1);
  }
});

it("u7650a_picking_show_once_starts_every_count_fresh", async () => {
  window.localStorage.setItem("roundup:app-settings", JSON.stringify({ iconNames: "always", tipShows: { Alpha: 1 }, mode: "dark" }));
  useBrowserStorage(window.localStorage);
  await settingsOpen();
  fireEvent.click(await screen.findByText("Show once"));
  await waitFor(() => expect(storedSettings().iconNames).toBe("once"));
  expect(storedSettings().tipShows).toEqual({});
  expect(storedSettings().mode).toBe("dark");

  expect(await hoverCount("Alpha")).toBe(1);
});

it("u7650a_the_choice_survives_a_launch", async () => {
  window.localStorage.setItem("roundup:app-settings", JSON.stringify({ iconNames: "hide" }));
  useBrowserStorage(window.localStorage);
  render(icons);
  expect(await hoverCount("Alpha")).toBe(0);
});
