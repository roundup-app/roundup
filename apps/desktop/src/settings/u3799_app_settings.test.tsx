import { batch } from "solid-js";
import { showEverythingInApp } from "../testing/showEverything";
import { mkdirSync, writeFileSync } from "node:fs";
import { fakeEmulators } from "../terminal/paneHarness";
import { join } from "node:path";
import { captureDir } from "../testing/captures";
import { openLane } from "../todos/laneBrowser";
import { openProjectPage } from "../testing/menuProbe";
import { openTabs, tab, path } from "../header/stripFixture";
import { rowOf } from "../rail/railFixture";
import { workstream } from "../testing/nodes";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { RequestedApp as App } from "../testing/requestedApp";
import { createFakeApp } from "../testing/fakeApp";

afterEach(() => { batch(cleanup); localStorage.clear(); });

it("u3799_the_event_and_cmd_comma_open_app_settings_in_the_center_with_four_groups", async () => {
  render(() => <App app={createFakeApp()} reducedMotion={() => true} clock={Date.now} />);
  await screen.findByRole("button", { name: /Choose/ });
  fireEvent.keyDown(window, { key: ",", code: "Comma", metaKey: true });
  const view = await screen.findByRole("region", { name: "Settings" });
  expect(within(screen.getByRole("region", { name: "Centre" })).getByRole("region", { name: "Settings" })).toBe(view);
  expect(within(view).getAllByRole("tab").map(item => item.textContent)).toEqual(["Agents", "Terminal", "Shortcuts", "Appearance"]);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByRole("button", { name: /^Engine / })).toBeNull();
  expect(screen.queryByRole("button", { name: /^Model / })).toBeNull();
  fireEvent.keyDown(window, { key: ",", code: "Comma", metaKey: true });
  expect(screen.getByRole("region", { name: "Settings" })).toBe(view);
});

it("u3800_close_returns_the_center_and_focus", async () => {
  render(() => <App app={createFakeApp()} reducedMotion={() => true} clock={Date.now} />);
  const opener = await screen.findByRole("button", { name: /Choose/ });
  opener.focus();
  window.dispatchEvent(new Event("open-app-settings"));
  const view = await screen.findByRole("region", { name: "Settings" });
  fireEvent.keyDown(view, { key: "Escape", code: "Escape" });
  expect(view.isConnected).toBe(false);
  expect(document.activeElement).toBe(opener);
  expect(screen.getByRole("button", { name: /Choose/ })).toBe(opener);
  fireEvent.keyDown(opener, { key: ",", code: "Comma", metaKey: true });
  await screen.findByRole("region", { name: "Settings" });
  fireEvent.click(within(screen.getByRole("region", { name: "Settings" })).getByRole("button", { name: "← Back" }));
  expect(document.activeElement).toBe(opener);
});

it.each([["KeyY", "y", "⌃⇧Y"], ["Numpad1", "1", "⌃⇧1"], ["F13", "F13", "⌃⇧F13"]])("u3804_a_new_chord_opens_the_field_and_help_lists_it_%s", async (code, key, label) => {
  const { seedApp } = await import("../testing/seeds");
  const { HELP_ROWS } = await import("../keys/chords");
  const { copy } = await import("./copy");
  const controls = seedApp("tree-40", Date.now());
  render(() => <App app={controls.app} reducedMotion={() => true} clock={Date.now} />);
  await screen.findAllByRole("treeitem");
  window.dispatchEvent(new Event("open-app-settings"));
  const settings = within(await screen.findByRole("region", { name: "Settings" }));
  fireEvent.click(settings.getByRole("tab", { name: "Shortcuts" }));
  const recorder = await settings.findByRole("button", { name: /^Quick add a Todo/ });
  fireEvent.click(recorder);
  expect(recorder.getAttribute("aria-pressed")).toBe("true");
  fireEvent.keyDown(window, { key, code, ctrlKey: true, shiftKey: true });
  fireEvent.click(within(screen.getByRole("region", { name: "Settings" })).getByRole("button", { name: "← Back" }));
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

it.each(["import-work", "project-settings"] as const)("u3814_escape_restores_the_previous_center_and_focus_missing_element_%s", async command => {
  await openTabs({ api: [workstream("w")] });
  const opener = document.createElement("button");
  document.body.append(opener);
  opener.focus();
  openProjectPage(command);
  const page = await screen.findByRole("region", { name: command === "import-work" ? "Import Claude Code work" : "Project settings" });
  opener.remove();
  fireEvent.keyDown(page, { key: "Escape", code: "Escape" });
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: /^Overview, Project root/ })));
});


it("u3814_switching_settings_pages_keeps_the_original_return_destination", async () => {
  await openTabs({ api: [workstream("w")] });
  const overview = screen.getByRole("button", { name: /^Overview, Project root/ });
  overview.focus();
  window.dispatchEvent(new Event("open-app-settings"));
  const appPage = await screen.findByRole("region", { name: "Settings" });
  openProjectPage("import-work");
  const imported = await screen.findByRole("region", { name: "Import Claude Code work" });
  expect(appPage.isConnected).toBe(false);
  openProjectPage("project-settings");
  const page = await screen.findByRole("region", { name: "Project settings" });
  fireEvent.keyDown(page, { key: "Escape", code: "Escape" });
  await waitFor(() => expect(document.activeElement).toBe(overview));
  expect(imported.isConnected).toBe(false);
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
      window.__fake.app.handlers['project.importCommit'] = () => ({ outcomes: [{ source: 's0', workstream: null, agent: null, error: { code: -32003, message: 'Import could not copy this conversation because storage is unavailable. Free disk space, then retry Import.', outcome: 'failed' } }] });
      return true;
    })()`);
    await lane.browser("click", ".import-confirm");
    await lane.until("document.querySelector('.import-candidate [role=alert]')?.checkVisibility()");
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
    await lane.browser("click", '.rail-row[data-id="agent-1"]');
    expect(await lane.evaluate("!!document.querySelector('.settings-view textarea')")).toBe(true);
    await lane.browser("click", "#shelf-tab-pads");
    expect(await lane.evaluate("!!document.querySelector('.settings-view textarea')")).toBe(true);
    await lane.browser("click", ".terminal-new");
    await lane.until("!!document.querySelector('.bubble:not([hidden])')");
    expect(await lane.evaluate("!!document.querySelector('.settings-view textarea')")).toBe(true);
    await lane.capture("U3814", "terminal-bubble-and-settings");
    await lane.browser("click", ".bubble [aria-label=Minimise]");
    await lane.browser("click", ".settings-head button");
    await lane.until("!document.querySelector('.settings-view')");
    mkdirSync(join(captureDir("U3814")!, "base"), { recursive: true });
    writeFileSync(join(captureDir("U3814")!, "base", "pads.checks.json"), JSON.stringify(await lane.evaluate("window.__checks()")) + "\n");
    const origin = await lane.evaluate<string>("location.origin");

    for (const seed of ["agents-10", "tree-40", "first-run"]) {
      await lane.evaluate("localStorage.clear()");
      await lane.browser("open", `${origin}/harness.html?view=workstreams&items=1&tabs=1&seed=${seed}`);
      await lane.until("!!document.querySelector('.window')");

      if (seed !== "first-run") {
        await lane.until("!!document.querySelector('.todo-project-root')");
        await lane.capture("U3813", `${seed}-overview`);
        await lane.evaluate("window.dispatchEvent(new CustomEvent('open-project-page', { detail: { path: document.querySelector('.project-tab[data-selected=true]').dataset.path, command: 'import-work' } }))");
        await lane.until("!!document.querySelector('.import-panel')");
        await lane.capture("U3814", `${seed}-import`);

        if (seed === "tree-40") {
          await lane.evaluate("(() => { window.__fake.app.chooser.path = '/Users/you/second-project'; return true; })()");
          await lane.browser("click", ".strip-add");
          await lane.until("document.querySelector('.project-tab[data-selected=true]')?.dataset.path === '/Users/you/second-project'");
          await lane.until("!document.querySelector('.import-panel')");
          await lane.evaluate("window.dispatchEvent(new CustomEvent('open-project-page', { detail: { path: '/Users/you/second-project', command: 'project-settings' } }))");
          await lane.until("!!document.querySelector('.settings-view textarea')");
          await lane.capture("U3814", "second-project-settings");
          await lane.browser("click", '.project-tab[data-path="/Users/you/harness"] .tab-name');
          await lane.until("!!document.querySelector('.import-panel')");
          await lane.capture("U3814", "original-project-import");
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
}, 60_000);

it.each([false, true])("u4277a_sections_work_by_pointer_and_keyboard_project_%s", async project => {
  const { seedApp } = await import("../testing/seeds");
  render(() => <App app={project ? seedApp("empty-project", Date.now()).app : createFakeApp()} reducedMotion={() => true} clock={Date.now} createEmulator={fakeEmulators().factory} />);

  if (project) await screen.findByRole("tree", { name: "Rail" });
  else await screen.findByRole("button", { name: /Choose/ });
  window.dispatchEvent(new Event("open-app-settings"));
  const view = await screen.findByRole("region", { name: "Settings" });

  for (const name of ["Agents", "Terminal", "Shortcuts", "Appearance"]) {
    fireEvent.click(within(view).getByRole("tab", { name }));
    await waitFor(() => expect(within(view).getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(within(view).getByRole("tab", { name }).id));
  }

  const pages = ["Agents", "Terminal", "Shortcuts", "Appearance"];
  within(view).getByRole("tab", { name: "Agents" }).focus();
  await Promise.resolve();

  for (const [key, names] of [["ArrowDown", pages.slice(1)], ["ArrowUp", pages.slice(0, -1).reverse()]] as const) {
    for (const name of names) {
      fireEvent.keyDown(document.activeElement!, { key });
      const tab = within(view).getByRole("tab", { name });
      await waitFor(() => expect(document.activeElement).toBe(tab));
      await waitFor(() => expect(tab.getAttribute("aria-selected")).toBe("true"));
      await waitFor(() => expect(within(view).getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(tab.id));
    }
  }

  fireEvent.click(within(view).getByRole("tab", { name: "Appearance" }));
  const panel = await within(view).findByRole("tabpanel", { name: "Appearance" });
  const appearanceChoice = within(panel).getByRole("radio", { name: "System" });
  appearanceChoice.focus();
  await waitFor(() => expect(within(view).getByRole("tabpanel").contains(appearanceChoice)).toBe(true));
  expect(document.activeElement).toBe(appearanceChoice);

});

it("u4277a_section_navigation_keeps_unsubmitted_font_text", async () => {
  const { appSettings, saveAppSettings } = await import("./preferences");
  await saveAppSettings({ fontSize: 17 });
  render(() => <App app={createFakeApp()} reducedMotion={() => true} clock={Date.now} />);
  await screen.findByRole("button", { name: /Choose/ });
  window.dispatchEvent(new Event("open-app-settings"));
  fireEvent.click(await screen.findByRole("tab", { name: "Terminal" }));
  fireEvent.input(await screen.findByRole("spinbutton", { name: "Font size" }), { target: { value: " 300 " } });
  fireEvent.click(screen.getByRole("tab", { name: "Agents" }));
  fireEvent.click(screen.getByRole("tab", { name: "Terminal" }));
  expect((await screen.findByRole<HTMLInputElement>("spinbutton", { name: "Font size" })).value).toBe(" 300 ");
  expect(appSettings().fontSize).toBe(17);
});
