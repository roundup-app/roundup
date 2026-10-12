import { cleanup, fireEvent, render, screen, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { App } from "../App";
import { seedApp } from "../testing/seeds";
import { ScopeControl } from "./ScopeControl";
import { ShelfToggle } from "./Shelf";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

it("u416_shelf_scope_controls_use_sentence_case", () => {
  render(() => <ScopeControl showAll={false} onChange={() => {}} />);
  const group = screen.getByRole("group", { name: "Show Todos" });

  expect(within(group).getAllByRole("button").map((button) => button.textContent)).toEqual(["All", "This one"]);
});

it.each([true, false])("u416_shelf_toggle_uses_sentence_case_%s", (open) => {
  render(() => <ShelfToggle open={open} onToggle={() => {}} />);

  expect(screen.getByRole("button", { name: open ? "Hide Shelf" : "Show Shelf" })).toBeTruthy();
});

it("u416_shelf_tablist_uses_its_glossary_capital", async () => {
  const controls = seedApp("tree-40", Date.now());

  render(() => <App app={controls.app} reducedMotion={() => true} clock={Date.now} />);
  const tabs = await screen.findByRole("tablist", { name: "Shelf" });

  expect(within(tabs).getAllByRole("tab").map((tab) => tab.textContent!.replace(/\d+$/, ""))).toEqual(["Todos", "Pads"]);
  fireEvent.click(screen.getByRole("button", { name: "Hide Shelf" }));
  fireEvent.click(screen.getByRole("button", { name: "Show Shelf" }));
  expect(screen.getByRole("tablist", { name: "Shelf" })).toBeTruthy();
});
