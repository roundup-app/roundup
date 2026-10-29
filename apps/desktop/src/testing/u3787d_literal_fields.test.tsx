import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { renderTabs, path, tab } from "../header/stripFixture";
import { agent, door, USER } from "./nodes";
import { padHandlers, todoHandlers } from "./stores";
import { padOf } from "../pads/padsFixture";
import { todo } from "../todos/testHarness";
import { captureActions } from "../keys/registry";
import { openProjectPage } from "./menuProbe";
import { showShelfTab } from "./shelfTabs";
import { settled } from "../rail/railFixture";

// Actual App openings, rather than a fixture containing representative fields.
const inventory = ["Project rename", "Agent rename", "Workstream rename", "Todo rename", "Pad rename", "Capture", "Import prompt", "Font family", "Switcher query", "Reaction name", "Reaction instruction"] as const;

afterEach(() => { cleanup(); localStorage.clear(); });

it.each(inventory)("u3787d_each_field_keeps_literal_input %s", async opening => {
  const { app } = renderTabs({ p: [door("home", "idle", "ready"), agent("a", "idle", "ready", { name: "Original" })] });
  const daemon = app.of(path("p"));
  Object.assign(daemon.handlers, todoHandlers({ todos: [todo(1, { title: "Original" })] }, () => {}), padHandlers({ pads: [padOf("Original", USER)], history: [] }, () => {}));
  daemon.handlers["project.importDiscover"] = () => ({ candidates: [], excluded: [] });
  daemon.handlers["reaction.list"] = () => [];
  await screen.findByRole("region", { name: "Project overview" });
  let field: HTMLInputElement | HTMLTextAreaElement;

  if (opening === "Project rename") {
    fireEvent.dblClick(tab("p").querySelector(".tab-name") ?? tab("p"));
    field = await screen.findByRole("textbox", { name: "Project name" });
  } else if (opening === "Agent rename" || opening === "Workstream rename") {
    openProjectPage("view:workstreams", path("p"));
    const row = await waitFor(() => {
      const found = document.querySelector<HTMLElement>(`.rail-row[data-id="${opening === "Agent rename" ? "a" : "home"}"]`);
      expect(found).not.toBeNull();
      return found!;
    });
    row.focus();
    fireEvent.keyDown(row, { key: "F2" });
    field = await screen.findByRole("textbox", { name: "Name" });
  } else if (opening === "Todo rename" || opening === "Pad rename") {
    showShelfTab(opening === "Todo rename" ? "Todos" : "Pads");
    const selector = opening === "Todo rename" ? '.shelf [data-todo="1"] .todo-row-button' : '.shelf [data-pad="Original"] .pad-name';
    const group = await waitFor(() => {
      const found = document.querySelector<HTMLElement>(`${opening === "Todo rename" ? ".todos-tab" : ".pads-tab"} [data-shelf-group="unassigned"] .shelf-group-control`);
      expect(found).not.toBeNull();
      return found!;
    });
    if (group.closest("[data-shelf-group]")?.getAttribute("aria-expanded") !== "true") fireEvent.click(group);
    const row = await waitFor(() => { const found = document.querySelector<HTMLElement>(selector); expect(found).not.toBeNull(); return found!; });
    row.focus();
    fireEvent.keyDown(row, { key: "F2" });
    field = await screen.findByRole("textbox", { name: "Name" });
  } else if (opening === "Capture" || opening === "Switcher query") {
    const action = captureActions(document.activeElement).find(action => action.value === (opening === "Capture" ? "action:leader:T" : "action:leader:K"));
    expect(action).toBeDefined();
    action!.run();
    field = await screen.findByRole(opening === "Capture" ? "textbox" : "combobox", { name: opening === "Capture" ? "Capture a Todo" : "Switch to" });
  } else if (opening === "Import prompt") {
    openProjectPage("import-work", path("p"));
    field = await screen.findByRole("textbox", { name: "Import instructions" });
  } else if (opening === "Font family") {
    window.dispatchEvent(new Event("open-app-settings"));
    fireEvent.click(await screen.findByRole("tab", { name: "Terminal" }));
    field = await screen.findByRole("textbox", { name: "Font family" });
  } else {
    openProjectPage("view:reactions", path("p"));
    fireEvent.click(await screen.findByRole("button", { name: "New reaction" }));
    field = await screen.findByRole("textbox", { name: opening === "Reaction name" ? "Name" : "Instruction" });
  }

  await settled();
  expect(field.getAttribute("spellcheck")).toBe("false");
  expect(field.getAttribute("autocorrect")).toBe("off");
  expect(field.getAttribute("autocapitalize")).toBe("off");
  const text = "  e\u0301 🧭 日本語 /a_b --x='yes';  ";
  field.focus();
  fireEvent.input(field, { target: { value: text } });
  field.setSelectionRange(2, 7, "backward");
  fireEvent.select(field);
  await settled();
  expect(field.value).toBe(text);
  expect([field.selectionStart, field.selectionEnd, field.selectionDirection]).toEqual([2, 7, "backward"]);
  fireEvent.blur(field);
  await settled();
  // Some rename holders close on blur; their exact recoverable draft remains owned by P11.
  if (field.isConnected) expect(field.value).toBe(text);
  expect(daemon.calls.filter(call => call.method === "terminal.write")).toEqual([]);
});
