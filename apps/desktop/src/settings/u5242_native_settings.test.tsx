import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { AppSettings } from "./AppSettings";
import { appSettings } from "./preferences";
import { createFakeApp } from "../testing/fakeApp";

beforeEach(() => {
  vi.spyOn(Terminal.prototype, "open").mockImplementation(() => {});
  vi.spyOn(FitAddon.prototype, "fit").mockImplementation(() => {});
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });

const mount = async (navigation: () => string = () => "") => {
  const app = createFakeApp();
  app.handlers["models.list"] = () => ({ engines: [{ id: "engine-one", label: "Engine One" }], models: [{ id: "model-one", label: "Model One" }], efforts: [] });
  render(() => <AppSettings app={app} project={() => "/p"} navigation={navigation} />);
  await Promise.resolve();
  window.dispatchEvent(new Event("open-app-settings"));
  await screen.findByRole("region", { name: "Settings" });
};

const section = async (name: string) => {
  const tab = screen.getByRole("tab", { name });
  fireEvent.click(tab);
  await waitFor(() => expect(tab.getAttribute("aria-selected")).toBe("true"));
};

it("u5242a_each_page_exposes_its_rows_as_labelled_groups", async () => {
  await mount();

  for (const page of ["Agents", "Terminal", "Shortcuts", "Appearance"]) {
    await section(page);
    const panel = screen.getByRole("tabpanel", { name: page });
    const groups = within(panel).getAllByRole("group", { name: /\S/ });
    expect(groups.length).toBeGreaterThan(0);

    const controls = panel.querySelectorAll("input:not([type=hidden]), textarea, button, select");

    for (const control of controls) expect(control.closest("[role=group]") !== null, `${page}: ${control.outerHTML.slice(0, 80)}`).toBe(true);
  }
});

it("u5242b_each_control_is_described_by_the_text_under_it", async () => {
  await mount();
  await section("Appearance");
  const mode = screen.getByRole("radiogroup", { name: "Appearance" });
  const note = document.getElementById(mode.getAttribute("aria-describedby")!)!;
  expect(mode.contains(note)).toBe(true);
  expect(document.querySelectorAll(".settings-hint:empty")).toHaveLength(0);
  await section("Agents");
  const permission = screen.getByRole("combobox", { name: "Permission mode" });
  expect(permission.parentElement?.nextElementSibling?.id).toBe(permission.getAttribute("aria-describedby"));
  await section("Shortcuts");
  const shortcut = document.querySelector(".settings-shortcut")!;
  expect(shortcut.nextElementSibling?.id).toBe(shortcut.querySelector("button")!.getAttribute("aria-describedby"));
});

it("u5242c_forward_reopens_settings_after_back_and_clears_on_other_navigation", async () => {
  await mount();
  expect(screen.getByRole("button", { name: "Forward →" }).hasAttribute("disabled")).toBe(true);
  await section("Terminal");
  fireEvent.input(await screen.findByRole("spinbutton", { name: "Font size" }), { target: { value: "17" } });
  fireEvent.click(screen.getByRole("button", { name: "← Back" }));
  await waitFor(() => expect(() => screen.getByRole("region", { name: "Settings" })).toThrow());
  fireEvent.click(screen.getByRole("button", { name: "Forward →" }));
  await screen.findByRole("region", { name: "Settings" });
  expect(screen.getByRole("tab", { name: "Terminal" }).getAttribute("aria-selected")).toBe("true");
  expect((await screen.findByRole<HTMLInputElement>("spinbutton", { name: "Font size" })).value).toBe("17");
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.keyDown(window, { key: "[", code: "BracketLeft", metaKey: true });
  await waitFor(() => expect(() => screen.getByRole("region", { name: "Settings" })).toThrow());
  fireEvent.keyDown(window, { key: "]", code: "BracketRight", metaKey: true });
  await screen.findByRole("region", { name: "Settings" });
  fireEvent.click(screen.getByRole("button", { name: "← Back" }));
  await screen.findByRole("button", { name: "Forward →" });
  window.dispatchEvent(new CustomEvent("open-project-page", { detail: { path: "/other", command: "project-settings" } }));
  await waitFor(() => expect(() => screen.getByRole("button", { name: "Forward →" })).toThrow());
});

it("u5242c_forward_clears_when_the_user_selects_another_view", async () => {
  const [selected, select] = createSignal("a");
  await mount(selected);
  fireEvent.click(screen.getByRole("button", { name: "← Back" }));
  await screen.findByRole("button", { name: "Forward →" });
  select("b");
  await waitFor(() => expect(() => screen.getByRole("button", { name: "Forward →" })).toThrow());
  fireEvent.keyDown(window, { key: "]", code: "BracketRight", metaKey: true });
  await waitFor(() => expect(() => screen.getByRole("region", { name: "Settings" })).toThrow());
});

it("u5242d_mode_and_scale_previews_follow_the_draft_without_committing", async () => {
  await mount();
  await section("Appearance");
  const preview = () => document.querySelector<HTMLElement>(".settings-appearance-preview")!;
  fireEvent.click(screen.getByRole("radio", { name: "Large" }));
  fireEvent.click(screen.getByRole("radio", { name: "Light" }));
  await waitFor(() => expect(preview().dataset).toMatchObject({ scale: "large", mode: "light" }));
  await waitFor(() => expect(appSettings()).toMatchObject({ interfaceScale: "large", mode: "light" }));
  // Nothing applied the App's appearance here, so the preview alone shows the choice.
  expect(document.documentElement.dataset.interfaceScale).toBeUndefined();
  expect(preview().dataset).toMatchObject({ scale: "large", mode: "light" });
});

const search = () => screen.getByRole("searchbox", { name: "Search settings" }) as HTMLInputElement;

it("u5243a_search_results_show_place_control_and_description", async () => {
  await mount();
  await section("Terminal");
  fireEvent.input(search(), { target: { value: "font family" } });
  const first = (await screen.findAllByRole("listitem"))[0]!;
  expect(first.textContent).toContain("Terminal › Font");
  const control = within(first).getByRole("combobox", { name: "Font family" });
  expect(document.getElementById(control.getAttribute("aria-describedby")!)).not.toBeNull();
  expect(screen.queryByRole("tablist")).toBeNull();
  fireEvent.input(search(), { target: { value: "zzzzqx" } });
  expect(await screen.findByText("No settings match.")).toBeTruthy();
  expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  fireEvent.input(search(), { target: { value: "" } });
  expect((await screen.findByRole("tab", { name: "Terminal" })).getAttribute("aria-selected")).toBe("true");
});

it("u5243b_a_result_control_edits_the_same_setting", async () => {
  await mount();
  fireEvent.input(search(), { target: { value: "font size" } });
  const input = await screen.findByRole("spinbutton", { name: "Font size" });
  fireEvent.input(input, { target: { value: "19" } });
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(appSettings().fontSize).toBe(19));
  fireEvent.input(search(), { target: { value: "" } });
  await section("Terminal");
  expect(((await screen.findByRole("spinbutton", { name: "Font size" })) as HTMLInputElement).value).toBe("19");
});

it("u5243c_search_typing_changes_nothing_but_the_results", async () => {
  await mount();
  await section("Terminal");
  fireEvent.input(search(), { target: { value: "x" } });
  expect(search().getAttribute("spellcheck")).toBe("false");
  expect(search().getAttribute("autocorrect")).toBe("off");
  expect(search().getAttribute("autocapitalize")).toBe("off");
  fireEvent.input(search(), { target: { value: "font family" } });
  search().focus();
  fireEvent.keyDown(search(), { key: "ArrowDown" });
  expect(screen.getByRole("combobox", { name: "Font family" })).toBe(document.activeElement);
  fireEvent.keyDown(search(), { key: "Escape" });
  expect(search().value).toBe("");
  expect(screen.getByRole("region", { name: "Settings" })).toBeTruthy();
  expect(screen.getByRole("tab", { name: "Terminal" }).getAttribute("aria-selected")).toBe("true");
  fireEvent.keyDown(search(), { key: "Escape" });
  await waitFor(() => expect(() => screen.getByRole("region", { name: "Settings" })).toThrow());
});
