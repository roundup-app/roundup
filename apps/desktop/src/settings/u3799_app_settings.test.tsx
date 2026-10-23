import { join } from "node:path";
import { captureDir } from "../testing/captures";
import { openLane } from "../todos/laneBrowser";
import { openProjectPage } from "../testing/menuProbe";
import { openTabs, tab, path } from "../header/stripFixture";
import { rowOf } from "../rail/railFixture";
import { workstream, agent } from "../testing/nodes";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { App } from "../App";
import { createFakeApp } from "../testing/fakeApp";

afterEach(() => { cleanup(); localStorage.clear(); });

it("u3799_the_event_and_cmd_comma_open_app_settings_in_the_center_with_four_groups", async () => {
  render(() => <App app={createFakeApp()} reducedMotion={() => true} clock={Date.now} />);
  await screen.findByRole("button", { name: /Choose/ });
  fireEvent.keyDown(window, { key: ",", code: "Comma", metaKey: true });
  const view = await screen.findByRole("region", { name: "Settings" });
  expect(within(screen.getByRole("region", { name: "Centre" })).getByRole("region", { name: "Settings" })).toBe(view);
  expect(within(view).getAllByRole("region").map(item => item.getAttribute("aria-label"))).toEqual(["Agents", "Terminal", "Shortcuts", "Appearance"]);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByRole("button", { name: /^Engine / })).toBeNull();
  expect(screen.queryByRole("button", { name: /^Model / })).toBeNull();
  fireEvent.keyDown(window, { key: ",", code: "Comma", metaKey: true });
  expect(screen.getAllByRole("region", { name: "Settings" })).toHaveLength(1);
});

it("u3800_close_returns_the_center_and_focus", async () => {
  render(() => <App app={createFakeApp()} reducedMotion={() => true} clock={Date.now} />);
  const opener = await screen.findByRole("button", { name: /Choose/ });
  opener.focus();
  window.dispatchEvent(new Event("open-app-settings"));
  const view = await screen.findByRole("region", { name: "Settings" });
  fireEvent.keyDown(view, { key: "Escape", code: "Escape" });
  expect(screen.queryByRole("region", { name: "Settings" })).toBeNull();
  expect(document.activeElement).toBe(opener);
  expect(screen.getByRole("button", { name: /Choose/ })).toBe(opener);
  fireEvent.keyDown(opener, { key: ",", code: "Comma", metaKey: true });
  await screen.findByRole("region", { name: "Settings" });
  fireEvent.click(within(screen.getByRole("region", { name: "Settings" })).getByRole("button", { name: "Close" }));
  expect(document.activeElement).toBe(opener);
});

it.each([["KeyY", "y", "⌃⇧Y"], ["Numpad1", "1", "⌃⇧1"], ["F13", "F13", "⌃⇧F13"]])("u3804_a_new_chord_opens_the_field_and_help_lists_it_%s", async (code, key, label) => {
  const { seedApp } = await import("../testing/seeds");
  const { HELP_ROWS } = await import("../keys/chords");
  const { copy } = await import("../copy");
  const controls = seedApp("tree-40", Date.now());
  render(() => <App app={controls.app} reducedMotion={() => true} clock={Date.now} />);
  await screen.findAllByRole("treeitem");
  window.dispatchEvent(new Event("open-app-settings"));
  fireEvent.click(await screen.findByRole("button", { name: "Quick add a Todo ⇧⌘T" }));
  expect(screen.getByRole("button", { name: "Quick add a Todo Press a shortcut" })).toBeTruthy();
  fireEvent.keyDown(window, { key, code, ctrlKey: true, shiftKey: true });
  fireEvent.click(within(screen.getByRole("region", { name: "Settings" })).getByRole("button", { name: "Close" }));
  fireEvent.keyDown(window, { key: "T", code: "KeyT", metaKey: true, shiftKey: true });
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.keyDown(window, { key, code, ctrlKey: true, shiftKey: true });
  expect(await screen.findByRole("dialog")).toBeTruthy();
  expect(HELP_ROWS.findLast(row => row.what === copy.captureATodo)?.keys).toBe(label);
});


it("u3813_overview_has_no_sublinks_and_project_commands_open_selected_pages", async () => {
  const { app } = await openTabs({ api: [], web: [] });

  for (const [name, cap] of [["api", 2], ["web", 7]] as const) {
    app.of(path(name)).handlers["project.get"] = () => ({ worktrees: { on: false, check: null }, mcp: { on: true }, workstreamCap: cap, models: { roles: [] } });
    app.of(path(name)).handlers["project.importDiscover"] = () => ({ candidates: [{ source: name, revision: "r", title: name, cwd: "", last_activity_ms: 1n }], excluded: [] });
    fireEvent.click(tab(name));
    await waitFor(() => expect(tab(name).getAttribute("aria-selected")).toBe("true"));
    expect(screen.queryByRole("button", { name: "Import Claude Code work" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Project settings" })).toBeNull();

    for (const [command, heading] of [["import-work", "Import Claude Code work"], ["project-settings", "Project settings"]] as const) {
      openProjectPage(command);
      const page = await screen.findByRole("region", { name: heading });
      expect(within(screen.getByRole("region", { name: "Centre" })).getByRole("region", { name: heading })).toBe(page);
      expect(screen.queryByRole("dialog")).toBeNull();

      if (command === "import-work") expect(await within(page).findByRole("checkbox", { name: new RegExp(name) })).toBeTruthy();
      else await waitFor(() => expect(within(page).getByRole("textbox")).toHaveProperty("value", String(cap)));
      fireEvent.click(within(page).getByRole("button", { name: "Close" }));
    }

    expect(app.of(path(name)).calls.filter(call => call.method === "project.get")).toHaveLength(1);
    expect(app.of(path(name)).calls.filter(call => call.method === "project.importDiscover")).toHaveLength(1);
  }
});


it.each(["import-work", "project-settings"] as const)("u3814_project_pages_survive_work_elsewhere_%s", async command => {
  const { app } = await openTabs({ api: [workstream("w"), agent("a", "idle", "ready", { parent: "w" })] });
  app.of(path("api")).handlers["project.get"] = () => ({ worktrees: { on: false, check: null }, mcp: { on: true }, workstreamCap: 2, models: { roles: [] } });
  const overview = screen.getByRole("button", { name: /^Overview, Project root/ });
  overview.focus();
  openProjectPage(command);
  const heading = command === "import-work" ? "Import Claude Code work" : "Project settings";
  const page = await screen.findByRole("region", { name: heading });

  if (command === "import-work") fireEvent.click(within(page).getByRole("button", { name: "Last month" }));
  else { const field = await within(page).findByRole("textbox"); fireEvent.input(field, { target: { value: "unfinished" } }); }

  openProjectPage(command);
  expect(screen.getByRole("region", { name: heading })).toBe(page);
  fireEvent.click(rowOf("a"));
  expect(screen.getByRole("region", { name: heading })).toBe(page);
  fireEvent.click(overview);
  expect(screen.getByRole("region", { name: heading })).toBe(page);

  if (command === "import-work") expect(within(page).getByRole("button", { name: "Last month" }).getAttribute("aria-pressed")).toBe("true");
  else expect(within(page).getByRole("textbox")).toHaveProperty("value", "unfinished");
  fireEvent.keyDown(page, { key: "Escape" });
  await waitFor(() => expect(document.activeElement).toBe(overview));
});

it.each(["import-work", "project-settings"] as const)("u3814_project_switch_keeps_each_page_with_its_project_%s", async command => {
  const { app } = await openTabs({ api: [], web: [] });

  for (const [name, cap] of [["api", 2], ["web", 7]] as const) {
    app.of(path(name)).handlers["project.get"] = () => ({ worktrees: { on: false, check: null }, mcp: { on: true }, workstreamCap: cap, models: { roles: [] } });
    app.of(path(name)).handlers["project.importDiscover"] = () => ({ candidates: [{ source: name, revision: "r", title: name, cwd: "", last_activity_ms: 1n }], excluded: [] });
  }

  const heading = command === "import-work" ? "Import Claude Code work" : "Project settings";

  for (const name of ["api", "web"]) {
    fireEvent.click(tab(name));
    await waitFor(() => expect(tab(name).getAttribute("aria-selected")).toBe("true"));
    openProjectPage(command);
    const page = await screen.findByRole("region", { name: heading });

    if (command === "import-work") {
      fireEvent.click(await within(page).findByRole("checkbox", { name: new RegExp(name) }));
      fireEvent.click(within(page).getByRole("button", { name: name === "api" ? "Last month" : "Last day" }));
    } else {
      await waitFor(() => expect(within(page).getByRole("textbox")).toHaveProperty("value", name === "api" ? "2" : "7"));

      if (name === "api") fireEvent.input(within(page).getByRole("textbox"), { target: { value: "unfinished" } });
    }
  }

  fireEvent.click(tab("api"));
  await waitFor(() => expect(tab("api").getAttribute("aria-selected")).toBe("true"));
  const page = await screen.findByRole("region", { name: heading });

  if (command === "import-work") {
    expect(await within(page).findByRole("checkbox", { name: /api/ })).toBeTruthy();
    expect(within(page).getByRole("button", { name: "Last month" }).getAttribute("aria-pressed")).toBe("true");
    expect(within(page).queryByRole("checkbox", { name: /web/ })).toBeNull();
  } else await waitFor(() => expect(within(page).getByRole("textbox")).toHaveProperty("value", "unfinished"));
  expect(app.of(path("api")).calls.filter(call => call.method === "project.importCommit")).toHaveLength(0);
});

it.each(["import-work", "project-settings"] as const)("u3814_close_restores_the_previous_center_and_focus_missing_element_%s", async command => {
  await openTabs({ api: [workstream("w")] });
  const opener = document.createElement("button");
  document.body.append(opener);
  opener.focus();
  openProjectPage(command);
  const page = await screen.findByRole("region", { name: command === "import-work" ? "Import Claude Code work" : "Project settings" });
  opener.remove();
  fireEvent.click(within(page).getByRole("button", { name: "Close" }));
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: /^Overview, Project root/ })));
});


it("u3814_switching_settings_pages_keeps_the_original_return_destination", async () => {
  await openTabs({ api: [workstream("w")] });
  const overview = screen.getByRole("button", { name: /^Overview, Project root/ });
  overview.focus();
  window.dispatchEvent(new Event("open-app-settings"));
  await screen.findByRole("region", { name: "Settings" });
  openProjectPage("import-work");
  expect(await screen.findByRole("region", { name: "Import Claude Code work" })).toBeTruthy();
  expect(screen.queryByRole("region", { name: "Settings" })).toBeNull();
  openProjectPage("project-settings");
  const page = await screen.findByRole("region", { name: "Project settings" });
  fireEvent.click(within(page).getByRole("button", { name: "Close" }));
  await waitFor(() => expect(document.activeElement).toBe(overview));
  expect(screen.queryByRole("region", { name: "Import Claude Code work" })).toBeNull();
});

it.skipIf(!captureDir("U3813"))("u3813_u3814_u3815_rendered_project_pages", async () => {
  const lane = await openLane(1512, "dark", "builder-3511");

  try {
    await lane.capture("U3813", "tree-40-overview");
    await lane.browser("record", "start", join(captureDir("U3814")!, "project-pages.webm"));
    await lane.until("!!window.__fake && !!document.querySelector('.todo-project-root')");
    await lane.evaluate(`(() => {
      window.__fake.app.handlers['project.importDiscover'] = () => ({ candidates: Array.from({ length: 10 }, (_, at) => ({ source: 's' + at, revision: 'r' + at, title: ('長い会話 🪁 ' + at + ' ').repeat(12), cwd: 'src', last_activity_ms: 1n })), excluded: [] });
      window.dispatchEvent(new CustomEvent('open-project-page', { detail: { path: '/Users/you/harness', command: 'import-work' } }));
      return true;
    })()`);
    await lane.until("document.querySelectorAll('.import-check').length === 10");
    await lane.capture("U3814", "import-page");
    await lane.browser("click", ".import-check");
    await lane.evaluate(`(() => {
      window.__fake.app.handlers['project.importCommit'] = () => ({ outcomes: [{ source: 's0', workstream: null, agent: null, error: 'Import could not copy this conversation because storage is unavailable. Free disk space, then retry Import.' }] });
      return true;
    })()`);
    await lane.browser("click", ".import-confirm");
    await lane.until("document.querySelector('.import-panel').textContent.includes('storage is unavailable')");
    await lane.capture("U3815", "partial-failure");
    await lane.evaluate(`(() => {
      const write = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key, value) { if (key.startsWith('roundup:import:')) throw new Error('Storage is full'); return write.call(this, key, value); };
      document.querySelectorAll('.import-check')[1].click();
      return true;
    })()`);
    await lane.until("document.querySelector('.import-panel').textContent.includes('could not be saved for reload')");
    await lane.capture("U3815", "retention-failure");
    await lane.evaluate(`(() => { window.dispatchEvent(new CustomEvent('open-project-page', { detail: { path: '/Users/you/harness', command: 'project-settings' } })); return true; })()`);
    await lane.until("!!document.querySelector('.settings-view textarea')");
    await lane.capture("U3814", "project-settings");
    await lane.browser("click", ".todo-project-root");
    expect(await lane.evaluate("!!document.querySelector('.settings-view textarea')")).toBe(true);
    await lane.browser("click", "#shelf-tab-pads");
    expect(await lane.evaluate("!!document.querySelector('.settings-view textarea')")).toBe(true);
    await lane.browser("click", ".terminal-new");
    await lane.until("!!document.querySelector('.bubble:not([hidden])')");
    expect(await lane.evaluate("!!document.querySelector('.settings-view textarea')")).toBe(true);
    await lane.capture("U3814", "terminal-bubble-and-settings");
    const origin = await lane.evaluate<string>("location.origin");

    for (const seed of ["agents-10", "tabs-8", "first-run"]) {
      await lane.evaluate("localStorage.clear()");
      await lane.browser("open", `${origin}/harness.html?seed=${seed}`);
      await lane.until("!!document.querySelector('.window')");

      if (seed !== "first-run") {
        await lane.until("!!document.querySelector('.todo-project-root')");
        await lane.capture("U3813", `${seed}-overview`);
        await lane.evaluate("window.dispatchEvent(new CustomEvent('open-project-page', { detail: { path: document.querySelector('.project-tab[data-selected=true]').dataset.path, command: 'import-work' } }))");
        await lane.until("!!document.querySelector('.import-panel')");
        await lane.capture("U3814", `${seed}-import`);

        if (seed === "tabs-8") {
          await lane.browser("click", ".project-tab:nth-child(2) .tab-name-button");
          await lane.until("!document.querySelector('.import-panel')");
          await lane.evaluate("window.dispatchEvent(new CustomEvent('open-project-page', { detail: { path: document.querySelector('.project-tab[data-selected=true]').dataset.path, command: 'project-settings' } }))");
          await lane.until("!!document.querySelector('.settings-view textarea')");
          await lane.capture("U3814", "second-project-settings");
        }
      } else {
        await lane.until("!!document.querySelector('.empty') || !!document.querySelector('.choose-project') || document.body.textContent.includes('Choose')");
        await lane.capture("U3813", "first-run");
      }
    }

    expect(await lane.evaluate("document.querySelectorAll('.rail-import').length")).toBe(0);
  } finally {
    try { await lane.browser("record", "stop"); } finally { await lane.close(); }
  }
}, 180_000);
