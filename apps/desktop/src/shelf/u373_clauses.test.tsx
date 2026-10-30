import { leaderKey } from "../keys/leaderFixture";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { RequestedApp as App } from "../testing/requestedApp";
import { fakeEmulators } from "../terminal/paneHarness";
import { seedApp } from "../testing/seeds";
import type { SeedName } from "../testing/seeds";
import tokenCss from "../tokens.css?raw";
import appCss from "../styles.css?inline";
import railCss from "../rail/styles.css?inline";
import buttonCss from "../buttons.css?inline";
import inkCss from "../ink/styles.css?inline";
import rowCss from "../todos/rowButton.styles.css?inline";
import stripCss from "../header/strip.styles.css?inline";
import shelfCss from "./styles.css?inline";

/** The then-clauses of U368, U370 and U371 that `u373_frame.test.tsx` names but does not assert, each read on the rendered tree. */

let sheet: HTMLStyleElement | undefined;

afterEach(() => {
  document.querySelectorAll("[data-probe]").forEach((probe) => probe.remove());
});

afterAll(() => {
  sheet?.remove();
  cleanup();
  localStorage.clear();
});

// Every test reads and toggles state `shared` puts back, so they share one mounted App.
let live: Awaited<ReturnType<typeof mountApp>> | undefined;

const shared = async () => {
  live ??= await mountApp();
  const field = screen.queryByLabelText("Pad name");

  if (field) fireEvent.keyDown(field, { key: "Escape" });

  if (shelf().hidden) chord();

  if (tabs().find((tab) => tab.getAttribute("aria-selected") === "true")?.textContent?.startsWith("Todos") !== true) fireEvent.click(tabNamed("Todos"));
  await waitFor(() => expect(within(shelf()).getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(tabNamed("Todos").id));
};

const mountApp = async (seed: SeedName = "tree-40") => {
  window.matchMedia ??= (query) => ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false });
  sheet = document.head.appendChild(document.createElement("style"));
  sheet.textContent = [tokenCss, appCss, railCss, buttonCss, inkCss, rowCss, stripCss, shelfCss].join("\n");
  const controls = seedApp(seed, Date.now());

  render(() => <App app={controls.app} reducedMotion={() => true} clock={Date.now} createEmulator={fakeEmulators().factory} />);
  await waitFor(() => expect(shelf()).not.toBeNull());
  await screen.findByRole("tablist", { name: "Bench" });

  return controls;
};

const shelf = () => document.querySelector<HTMLElement>(".shelf")!;

const tabs = () => within(screen.getByRole("tablist", { name: "Bench" })).getAllByRole("tab");

const tabNamed = (name: string) => tabs().find((tab) => tab.textContent!.startsWith(name))!;

const chord = (init: KeyboardEventInit = {}, target: Element | Document = document.body) =>
  leaderKey("KeyB", init, target);

const probe = (role: string, attributes: Record<string, string> = {}) => {
  const element = document.body.appendChild(document.createElement("div"));

  element.dataset["probe"] = "";
  element.setAttribute("role", role);

  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);

  return element;
};


describe("u370 the chord and esc", () => {
  it("u370_leader_b_toggles_from_a_terminal_and_never_reaches_it", async () => {
    await shared();
    const field = document.body.appendChild(document.createElement("textarea"));
    const reached: KeyboardEvent[] = [];

    field.dataset["probe"] = "";
    field.className = "xterm-helper-textarea";
    field.addEventListener("keydown", (press) => reached.push(press));
    field.focus();

    chord({}, field);
    expect(shelf().hidden).toBe(true);
    chord({}, field);
    expect(shelf().hidden).toBe(false);
    expect(reached).toEqual([]);
  });

  it("u370_leader_b_toggles_with_a_drawer_open", async () => {
    await shared();
    fireEvent.click(tabNamed("Pads"));
    await within(shelf()).findByRole("button", { name: "Add Pad" });

    const drawer = probe("dialog", { "aria-label": "drawer" });

    drawer.className = "drawer";
    drawer.dataset["open"] = "true";
    expect(shelf().hidden).toBe(false);
    chord({}, drawer);
    await waitFor(() => expect(shelf().hidden).toBe(true));
  });

  it("u370_caps_lock_is_neutral", async () => {
    await shared();
    chord({ key: "|", modifierCapsLock: true });
    expect(shelf().hidden).toBe(true);
    chord({ key: "\\", modifierCapsLock: true });
    expect(shelf().hidden).toBe(false);
  });

  it("u370_esc_does_nothing_with_a_drawer_or_dialog_open", async () => {
    await shared();

    const drawer = probe("region");

    drawer.className = "drawer";
    drawer.dataset["open"] = "true";
    fireEvent.keyDown(tabNamed("Todos"), { key: "Escape" });
    expect(shelf().hidden).toBe(false);
    drawer.remove();

    const dialog = probe("alertdialog");

    fireEvent.keyDown(tabNamed("Todos"), { key: "Escape" });
    expect(shelf().hidden).toBe(false);
    dialog.remove();
    fireEvent.keyDown(tabNamed("Todos"), { key: "Escape" });
    expect(shelf().hidden).toBe(true);
  });

  it("u370_esc_does_not_close_from_a_text_field_inside", async () => {
    await shared();
    fireEvent.click(tabNamed("Pads"));
    fireEvent.click(await within(shelf()).findByRole("button", { name: "Add Pad" }));

    const field = await within(shelf()).findByLabelText("Pad name");

    fireEvent.keyDown(field, { key: "Escape" });
    expect(shelf().hidden).toBe(false);
  });
});
