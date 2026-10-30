import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { path, tab } from "../header/stripFixture";
import { agent, workstream, info, USER } from "./nodes";
import { padHandlers, todoHandlers } from "./stores";
import { padOf } from "../pads/padsFixture";
import { todo } from "../todos/testHarness";
import { App } from "../App";
import { createFakeApp } from "./fakeApp";
import { fakeEmulators } from "../terminal/paneHarness";
import { leaderKey } from "../keys/leaderFixture";
import { captureActions } from "../keys/registry";
import { openProjectPage } from "./menuProbe";
import { showShelfTab } from "./shelfTabs";
import { settled } from "../rail/railFixture";
import { copy } from "./copy";

// Actual App openings, rather than a fixture containing representative fields.
const inventory = ["Project rename", "Agent rename", "Workstream rename", "Todo rename", "Pad rename", "Capture", "Import prompt", "Font family", "Switcher query", "Ask prompt", "Spawn prompt", "Opening prompt", "New Todo", "New Pad", "Todo title", "Todo body", "Todo comment", "Terminal rename", "New Workstream", "Project query", "Engine query", "Model query", "Owner query", "Blocker query", "Wait-for query", "Change note"] as const;

afterEach(() => { cleanup(); localStorage.clear(); });

it.each(inventory)("u3787d_each_field_keeps_literal_input %s", async opening => {
  const app = createFakeApp();
  app.add(path("p"));

  if (opening === "Project query") app.add(path("other"));
  const daemon = app.of(path("p"));
  daemon.handlers["rail.tree"] = () => [workstream("home", { name: "Home" }), agent("a", "idle", "ready", { name: "Original", worktree: { path: "/p/work", base: "main", branch: "work" } })];
  Object.assign(daemon.handlers, todoHandlers({ todos: [todo(1, { title: "Original" }), todo(2, { title: "Other" })] }, () => {}), padHandlers({ pads: [padOf("Original", USER)], history: [] }, () => {}));
  daemon.handlers["project.importDiscover"] = () => ({ candidates: [], excluded: [] });
  daemon.handlers["reaction.list"] = () => [];
  daemon.handlers["agent.worktreeState"] = () => ({ ahead: 0, behind: 0, dirty: true });
  daemon.handlers["agent.changedFiles"] = () => ({ files: [{ path: "src/a.ts", status: "modified", line: 1 }] });
  daemon.handlers["agent.compareFile"] = async () => (await import("../changes/noteHarness")).COMPARISON;
  daemon.handlers["terminal.list"] = () => [info("term", { owner: path("p"), title: "Shell" })];
  daemon.handlers["terminal.open"] = () => ({ terminal_id: "term" });

  // U4687a retains a text editor only for a family draft restored before App construction.
  if (opening === "Font family") {
    const { draftStorage } = await import("../state/storage");
    await draftStorage("app-settings").edit({ surface: "settings", object: "fontFamily", recipient: null }, { text: "recovered family", saved: "" }, null, "ordinary").retained;
  }

  render(() => <App app={app} reducedMotion={() => true} clock={() => 0} createEmulator={fakeEmulators().factory} prepareIdle={open => open.showView("terminal-tabs")} />);
  await screen.findByRole("textbox", { name: "Ask" });
  let field: HTMLInputElement | HTMLTextAreaElement;

  if (opening === "Change note") {
    openProjectPage("view:workstreams", path("p"));

    const row = await waitFor(() => { const found = document.querySelector<HTMLElement>('.rail-row[data-id="a"]'); expect(found).not.toBeNull();

 return found!; });

    fireEvent.click(row);
    fireEvent.click(await screen.findByRole("button", { name: "1 changed file" }));
    await (await import("../changes/noteHarness")).openFile();
    fireEvent.click(await screen.findByRole("button", { name: "Add note" }));
    field = await screen.findByRole("textbox", { name: "Note" });
  } else if (opening === "Project query") {
    leaderKey("KeyP");
    field = await screen.findByRole("combobox", { name: "Switch Project" });
  } else if (opening === "Engine query" || opening === "Model query") {
    window.dispatchEvent(new Event("open-app-settings"));
    fireEvent.click(await screen.findByRole("tab", { name: "Agents" }));
    const label = opening === "Engine query" ? "Engine" : "Model";
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(label) }));
    field = await screen.findByRole("combobox", { name: label });
  } else if (opening === "Ask prompt") {
    field = await screen.findByRole("textbox", { name: "Ask" });
  } else if (opening === "Switcher query") {
    leaderKey("KeyK");
    field = await screen.findByRole("combobox", { name: "Switch to" });
  } else if (opening === "Spawn prompt" || opening === "Opening prompt" || opening === "Terminal rename") {
    openProjectPage("view:workstreams", path("p"));
    await screen.findByRole("tree", { name: "Rail" });

    if (opening === "Spawn prompt") {
      fireEvent.keyDown(document, { key: "n", code: "KeyN", metaKey: true, shiftKey: true });
      field = await screen.findByRole("textbox", { name: "Task" });
    } else if (opening === "Opening prompt") {
      const row = document.querySelector<HTMLElement>('.rail-row[data-id="home"]')!;
      fireEvent.contextMenu(row);
      await app.pickMenu(copy.openingPromptMenu);
      field = await screen.findByRole("textbox", { name: copy.openingPrompt });
    } else {
      fireEvent.keyDown(document, { key: "t", code: "KeyT", metaKey: true });
      const control = await screen.findByRole("button", { name: "Shell" });
      fireEvent.dblClick(control);
      field = await screen.findByRole("textbox", { name: "Terminal name" });
    }
  } else if (["New Todo", "New Pad", "Todo title", "Todo body", "Todo comment", "New Workstream", "Owner query", "Blocker query", "Wait-for query"].includes(opening)) {
    showShelfTab(opening === "New Pad" ? "Pads" : "Todos");

    if (opening === "New Todo" || opening === "New Pad") {
      fireEvent.click(await screen.findByRole("button", { name: opening === "New Todo" ? "add todo to Overview" : "Add Pad" }));
      field = await screen.findByRole("textbox", { name: opening === "New Todo" ? "New Todo title" : "Pad name" });
    } else {
      const group = await waitFor(() => { const found = document.querySelector<HTMLElement>('.todos-tab [data-shelf-group="unassigned"] .shelf-group-control'); expect(found).not.toBeNull();

 return found!; });

      if (group.closest("[data-shelf-group]")?.getAttribute("aria-expanded") !== "true") fireEvent.click(group);

      const row = await waitFor(() => { const found = document.querySelector<HTMLElement>('.shelf [data-todo="1"] .todo-row-button'); expect(found).not.toBeNull();

 return found!; });

      row.focus();

      if (opening === "Owner query") {
        fireEvent.click(row);
        leaderKey("KeyA");
        field = await screen.findByRole("combobox", { name: "Assign" });
      } else if (opening === "New Workstream" || opening === "Wait-for query") {
        fireEvent.keyDown(row, { key: "o", code: "KeyO" });
        fireEvent.click(await screen.findByText("New Workstream…"));

        if (opening === "Wait-for query") {
          fireEvent.click(await screen.findByRole("radio", { name: "Start after another Todo" }));
          fireEvent.click(await screen.findByRole("button", { name: "Choose a Todo" }));
          field = await screen.findByRole("combobox", { name: "Todo to wait for" });
        } else field = await screen.findByRole("textbox", { name: "Workstream name" });
      } else {
        fireEvent.keyDown(row, { key: "Enter" });
        await screen.findByRole("region", { name: "Todo history" });

        if (opening === "Todo title") fireEvent.dblClick(document.querySelector('.todo-detail-title p[tabindex]')!);

        if (opening === "Todo body") fireEvent.click(await screen.findByRole("button", { name: "Add notes" }));

        if (opening === "Blocker query") {
          fireEvent.click(await screen.findByRole("button", { name: "Blocker" }));
          field = await screen.findByRole("combobox", { name: "Blocker" });
        } else field = await screen.findByRole("textbox", { name: opening === "Todo title" ? "Title" : opening === "Todo body" ? "Body" : "Write a comment" });
      }
    }
  } else if (opening === "Project rename") {
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

    const row = await waitFor(() => { const found = document.querySelector<HTMLElement>(selector); expect(found).not.toBeNull();

 return found!; });

    row.focus();
    fireEvent.keyDown(row, { key: "F2" });
    field = await screen.findByRole("textbox", { name: "Name" });
  } else if (opening === "Capture") {
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
  } else throw new Error(`Missing field observer: ${opening}`);

  await settled();
  expect(field.getAttribute("spellcheck")).toBe("false");
  expect(field.getAttribute("autocorrect")).toBe("off");
  expect(field.getAttribute("autocapitalize")).toBe("off");
  const text = "  e\u0301 🧭 日本語 /a_b --x='yes';  ";
  field.focus();
  fireEvent.input(field, { target: { value: text } });
  await settled();
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

// The native panel is a second production entry point (main.tsx?capture), not an App child.
it("u3787d_each_field_keeps_literal_input native CapturePanel request", async () => {
  const { CapturePanel } = await import("../todos/CapturePanel");
  const actions: import("../app/seam").CaptureAction[] = [];

  const port: import("../app/seam").CapturePort = {
    configure: async () => {}, show: async () => {}, dismiss: async () => {}, publish: async () => {},
    act: async action => { actions.push(action); },
    onRequested: async () => () => {}, onAction: async () => () => {},
    onState: async listener => {
      listener({ session: "original", sequence: 0, text: "", owner: "Me", home: "Home", recovered: [], retention: false, failure: null, mode: "dark" });

      return () => {};
    },
  };

  render(() => <CapturePanel port={port} />);
  const field = await screen.findByRole<HTMLTextAreaElement>("textbox", { name: "Capture a Todo" });
  expect([field.getAttribute("spellcheck"), field.getAttribute("autocorrect"), field.getAttribute("autocapitalize")]).toEqual(["false", "off", "off"]);
  const text = "  é 🧭 日本語 /a_b --x='yes';  ";
  fireEvent.input(field, { target: { value: text } });
  field.setSelectionRange(2, 7, "backward");
  fireEvent.blur(field);
  expect([field.value, field.selectionStart, field.selectionEnd, field.selectionDirection]).toEqual([text, 2, 7, "backward"]);
  fireEvent.keyDown(field, { key: "Enter" });
  await waitFor(() => expect(actions).toContainEqual({ kind: "file", session: "original", sequence: 2, text, keepOpen: false }));
  fireEvent.keyDown(field, { key: "Escape" });
  expect(actions.at(-1)).toEqual({ kind: "dismiss", session: "original" });
});
