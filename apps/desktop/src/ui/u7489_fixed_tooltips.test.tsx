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

it("u7489a_a_fixed_tooltip_opens_three_times_per_icon", async () => {
  render(icons);

  for (let i = 0; i < 3; i++) await showOnce("Alpha");
  expect(storedSettings().tipShows).toEqual({ Alpha: 3 });
  hover(screen.getByRole("button", { name: "Alpha" }));
  await new Promise(done => setTimeout(done, 300));
  expect(screen.queryByRole("tooltip")).toBeNull();
  await showOnce("Beta");
  expect(storedSettings().tipShows.Beta).toBe(1);
});

it("u7489a_the_counts_survive_a_launch", async () => {
  window.localStorage.setItem("roundup:app-settings", JSON.stringify({ tipShows: { Alpha: 3 } }));
  useBrowserStorage(window.localStorage);
  render(icons);
  hover(screen.getByRole("button", { name: "Alpha" }));
  await new Promise(done => setTimeout(done, 300));
  expect(screen.queryByRole("tooltip")).toBeNull();
});

it("u7489b_a_changing_tooltip_never_retires", async () => {
  render(() => <Tip kind="changing" text="Working">{trigger => <button {...trigger()}>Status</button>}</Tip>);

  for (let i = 0; i < 5; i++) await showOnce("Status");
  expect(storedSettings().tipShows).toEqual({});
});

it("u7489b_a_retired_icon_keeps_its_accessible_name", async () => {
  window.localStorage.setItem("roundup:app-settings", JSON.stringify({ tipShows: { Alpha: 3 } }));
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

it("u7489c_show_icon_names_again_restores_three_shows", async () => {
  window.localStorage.setItem("roundup:app-settings", JSON.stringify({ tipShows: { Alpha: 3 }, mode: "dark" }));
  useBrowserStorage(window.localStorage);
  render(() => <ToastHost><AppSettings app={createFakeApp()} project={() => "/p"} />{icons()}</ToastHost>);
  window.dispatchEvent(new Event("open-app-settings"));
  await screen.findByLabelText("Settings", { selector: "section" });
  fireEvent.click(screen.getByText("Appearance", { selector: '[role="tab"]' }));
  fireEvent.click(await screen.findByRole("button", { name: "Show icon names again" }));
  await waitFor(() => expect(storedSettings().tipShows).toEqual({}));
  expect(storedSettings().mode).toBe("dark");
  await showOnce("Alpha");
});
