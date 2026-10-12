import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { seedApp } from "../testing/seeds";
import type { SeedName } from "../testing/seeds";
import tokenCss from "../tokens.css?inline";
import appCss from "../styles.css?inline";
import railCss from "../rail/styles.css?inline";
import buttonCss from "../buttons.css?inline";
import inkCss from "../ink/styles.css?inline";
import rowCss from "../todos/rowButton.styles.css?inline";
import stripCss from "../header/strip.styles.css?inline";
import shelfCss from "./styles.css?inline";

// U426: every row carries its icons, so the whole-tree style walks cost more than the default 5 s under a loaded `just check`.
vi.setConfig({ testTimeout: 30_000 });

/** The then-clauses of U368, U370 and U371 that `u373_frame.test.tsx` names but does not assert, each read on the rendered tree. */

let sheet: HTMLStyleElement | undefined;

afterEach(() => {
  sheet?.remove();
  cleanup();
  localStorage.clear();
  document.querySelectorAll("[data-probe]").forEach((probe) => probe.remove());
});

const mountApp = async (seed: SeedName = "tree-40") => {
  window.matchMedia ??= (query) => ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false });
  sheet = document.head.appendChild(document.createElement("style"));
  sheet.textContent = [tokenCss, appCss, railCss, buttonCss, inkCss, rowCss, stripCss, shelfCss].join("\n");
  const controls = seedApp(seed, Date.now());

  render(() => <App app={controls.app} reducedMotion={() => true} clock={Date.now} />);
  await screen.findByRole("tablist", { name: "shelf" });

  return controls;
};

const shelf = () => document.querySelector<HTMLElement>(".shelf")!;

const tabs = () => within(screen.getByRole("tablist", { name: "shelf" })).getAllByRole("tab");

const tabNamed = (name: string) => tabs().find((tab) => tab.textContent!.startsWith(name))!;

const chord = (init: KeyboardEventInit = {}, target: Element | Document = document.body) =>
  fireEvent.keyDown(target, { code: "Backslash", key: "\\", metaKey: true, ...init });

const selectRow = (id: string) => {
  fireEvent.click(document.querySelector(`[data-id="${id}"]`)!);
};

const scopeGroup = () => screen.queryByRole("group", { name: "show Todos" });

const probe = (role: string, attributes: Record<string, string> = {}) => {
  const element = document.body.appendChild(document.createElement("div"));

  element.dataset["probe"] = "";
  element.setAttribute("role", role);

  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);

  return element;
};

describe("u368 the control is absent unless a Workstream is selected", () => {
  it("u368_absent_with_an_agent_or_terminal_selected", async () => {
    await mountApp();

    selectRow("backend");
    expect(await screen.findByRole("group", { name: "show Todos" })).toBeTruthy();

    for (const id of ["migrate"]) {
      selectRow(id);
      await waitFor(() => expect(document.querySelector(`[data-id="${id}"]`)!.getAttribute("aria-selected")).toBe("true"));
      expect(scopeGroup(), id).toBeNull();
    }
  });

  it("u368_one_is_pressed_and_the_control_is_the_panels_first_line", async () => {
    await mountApp();
    selectRow("backend");

    const group = await screen.findByRole("group", { name: "show Todos" });
    const [all, thisOne] = within(group).getAllByRole("button");
    const panel = screen.getByRole("tabpanel");

    // U347 inverts U368's default: a Workstream selected fresh opens on `this one`.
    expect([all!.getAttribute("aria-pressed"), thisOne!.getAttribute("aria-pressed")]).toEqual(["false", "true"]);
    // The first button of the panel is in the group, and the group precedes every row of the list (`all` shows rows).
    fireEvent.click(all!);
    await waitFor(() => expect(panel.querySelector("[data-todo]")).not.toBeNull());
    expect(group.contains(panel.querySelector("button"))).toBe(true);

    for (const row of panel.querySelectorAll("[data-todo]")) expect(group.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("u368_this_one_narrows_to_the_selected_workstreams_todos", async () => {
    const controls = await mountApp();

    await controls.app.rpc("rail.createWorkstream", { name: "elsewhere", parent: null });
    selectRow("backend");

    const group = await screen.findByRole("group", { name: "show Todos" });
    // SAFETY: the group holds exactly the two buttons `all` and `this one`.
    const [all, thisOne] = within(group).getAllByRole("button") as [HTMLElement, HTMLElement];

    fireEvent.click(all);
    const wide = shelf().querySelectorAll("[data-todo]").length;

    fireEvent.click(thisOne);
    const homed = shelf().querySelectorAll("[data-todo]").length;

    // The seed's Todos belong to the Agent `tokens` under `auth`, so `backend` is not their Home: the list narrows.
    expect(wide).toBeGreaterThan(0);
    expect(homed).toBeLessThan(wide);
    fireEvent.click(all);
    expect(shelf().querySelectorAll("[data-todo]")).toHaveLength(wide);
  });
});

describe("u370 the chord and esc", () => {
  it("u370_the_chord_toggles_from_a_terminal_and_never_reaches_it", async () => {
    await mountApp();
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

  it("u370_the_chord_toggles_with_a_drawer_open", async () => {
    await mountApp();
    fireEvent.click(await screen.findByRole("button", { name: "add pad" }).catch(() => tabNamed("Pads")));
    fireEvent.click(tabNamed("Pads"));
    await screen.findByRole("button", { name: "add pad" });

    const drawer = probe("dialog", { "aria-label": "drawer" });

    drawer.className = "drawer";
    drawer.dataset["open"] = "true";
    chord({}, drawer);
    expect(shelf().hidden).toBe(true);
  });

  it("u370_caps_lock_is_neutral", async () => {
    await mountApp();
    chord({ key: "|", modifierCapsLock: true });
    expect(shelf().hidden).toBe(true);
    chord({ key: "\\", modifierCapsLock: true });
    expect(shelf().hidden).toBe(false);
  });

  it("u370_esc_does_nothing_with_a_drawer_or_dialog_open", async () => {
    await mountApp();

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
    await mountApp();
    fireEvent.click(tabNamed("Pads"));
    fireEvent.click(await screen.findByRole("button", { name: "add pad" }));

    const field = await screen.findByLabelText("pad name");

    fireEvent.keyDown(field, { key: "Escape" });
    expect(shelf().hidden).toBe(false);
  });
});

describe("u371 the tokens and the ground", () => {
  const block = (scheme: "light" | "dark") => {
    const dark = tokenCss.match(/@media \(prefers-color-scheme: dark\) {([\s\S]*?)\n}\n/)![1]!;

    return scheme === "dark" ? dark : tokenCss.replace(dark, "");
  };

  it("u371_the_values_of_the_shadow_tokens_light_and_dark", () => {
    expect(block("light")).toContain("--shadow-shelf: 0 0 24px rgba(0, 0, 0, 0.1);");
    expect(block("light")).toContain("--shadow-scroll: inset 0 8px 8px -8px rgba(0, 0, 0, 0.18);");
    expect(block("dark")).toContain("--shadow-shelf: 0 0 24px rgba(0, 0, 0, 0.45);");
    expect(block("dark")).toContain("--shadow-scroll: inset 0 8px 8px -8px rgba(0, 0, 0, 0.6);");
  });

  it("u371_the_ground_is_sunken_and_a_dialog_covers_the_shelf", async () => {
    await mountApp();

    expect(getComputedStyle(shelf()).backgroundColor).toBe("var(--sunken)");
    // Help and the close dialog render in `.overlay`, which paints above the Shelf's z-index.
    expect(Number(getComputedStyle(document.querySelector(".overlay")!).zIndex)).toBeGreaterThan(Number(getComputedStyle(shelf()).zIndex));
  });
});
