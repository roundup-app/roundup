import { chooseFooter } from "../rail/railFixture";
import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { mountNavigation } from "../testing/navigationFixture";
import { openProjectPage } from "../testing/menuProbe";
import { openSwitcher } from "../switcher/switcherFixture";
import { answerQuestion } from "../shelf/bulkQuestionHarness";
import { agent, door, info } from "../testing/nodes";

afterEach(() => { cleanup(); localStorage.clear(); sessionStorage.clear(); });

// U4707: the tab bar reads the 44px --row-text-inset Token (U5147d).
it.each(["keyboard", "menu", "bar"].flatMap(source => ["home", "a1", null, "empty"].map(selection => ({ source, selection }))))("u4313a_bar_plus_opens_once_and_focuses: $source $selection", async ({ source, selection }) => {
  const { daemon, connected, shells, emulators } = await mountNavigation(selection === "empty");

  if (selection !== "empty") connected().rail.select(selection);

  const owner = selection === "empty" ? null : "home";
  daemon.handlers["terminal.open"] = () => { shells.push(info("shell", { owner: owner ?? "/p" }));

    return { terminal_id: "shell" }; };

  if (source === "keyboard") window.dispatchEvent(new KeyboardEvent("keydown", { key: "t", code: "KeyT", metaKey: true, bubbles: true }));
  else if (source === "menu") openProjectPage("action:chord:⌘T", "/p");
  else fireEvent.click(within(screen.getByRole("group", { name: "Terminals" })).getByRole("button", { name: "New Terminal" }));
  await waitFor(() => expect(document.activeElement?.getAttribute("data-terminal")).toBe("shell"));
  expect(daemon.calls.filter(call => call.method === "terminal.open").map(call => call.params)).toEqual([{ workstream: owner, cols: 100, rows: 30 }]);
  expect(daemon.calls.filter(call => ["rail.createWorkstream", "rail.startDoor", "agent.spawn"].includes(call.method))).toHaveLength(0);
  expect(emulators.made.has("shell")).toBe(true);
  expect(document.querySelector('.bubble[data-bubble="shell"]')).not.toBeNull();
  expect(document.querySelector('.terminal-tabs[role="group"]')).toBeTruthy();
});

// U4707: the tab bar reads the 44px --row-text-inset Token (U5147d).
it("u4313a_empty_terminal_bar_keeps_new_terminal_available", async () => {
  const { connected, daemon, shells, emulators } = await mountNavigation(true);
  const portal = document.querySelector(".resource-agent");
  const initial = screen.getByRole("group", { name: "Terminals" });
  expect(within(initial).getAllByRole("button")).toEqual([within(initial).getByRole("button", { name: "New Terminal" })]);
  fireEvent.keyDown(document, { key: "Tab" });
  within(initial).getByRole("button", { name: "New Terminal" }).focus();
  expect(await screen.findByRole("tooltip")).toBeDefined();
  expect(daemon.calls.filter(call => ["terminal.open", "agent.spawn", "rail.createWorkstream", "rail.startDoor"].includes(call.method))).toHaveLength(0);
  shells.push(info("shell", { owner: "/p" }));
  await connected().rail.refresh({ terminals: true });
  const bar = await screen.findByRole("group", { name: "Terminals" });
  fireEvent.click(document.querySelector('.terminal-tab[data-bubble="shell"]')!);
  await waitFor(() => expect(emulators.made.has("shell")).toBe(true));
  fireEvent.click(document.querySelector('.terminal-tab[data-bubble="shell"]')!);
  expect(document.querySelector('.terminal-tabs[role="group"]')).toBe(bar);
  shells[0] = info("shell", { owner: "/p", running: false, exit_code: 0 });
  await connected().rail.refresh({ terminals: true });
  expect(document.querySelector('.terminal-tab[data-bubble="shell"]')).not.toBeNull();
  shells.splice(0);
  await connected().rail.refresh({ terminals: true });
  expect(screen.getByRole("group", { name: "Terminals" })).toBe(initial);
  expect(document.querySelector(".resource-agent")).toBe(portal);
  expect(daemon.calls.filter(call => ["terminal.close", "terminal.write"].includes(call.method))).toHaveLength(0);
});

it("u4274c_terminal_bar_follows_eligible_terminals_on_selection", async () => {
  const { connected, daemon, nodes, shells } = await mountNavigation();
  shells.push(info("shell", { owner: "home" }));
  nodes.push({ ...nodes[0]!, id: "other", name: "Other", order: 20 });
  await connected().rail.refresh({ terminals: true });
  connected().rail.select("a1");
  await waitFor(() => expect(document.querySelector('.terminal-tab[data-bubble="shell"]')).not.toBeNull());
  const bar = document.querySelector(".terminal-tabs");
  connected().rail.select("other");
  expect(document.querySelectorAll(".terminal-tab")).toHaveLength(0);
  expect(document.querySelector(".terminal-tabs")).toBe(bar);
  connected().rail.select("a1");
  expect(document.querySelector('.terminal-tab[data-bubble="shell"]')).not.toBeNull();
  expect(daemon.calls.filter(call => call.method === "terminal.close")).toHaveLength(0);
});

it("u524_a_failed_empty_project_open_can_be_retried", async () => {
  const { daemon, shells } = await mountNavigation(true);
  daemon.handlers["terminal.open"] = () => { throw new Error("cannot open"); };

  const action = document.querySelector<HTMLButtonElement>(".terminal-new")!;
  fireEvent.click(action);
  await screen.findByRole("alert");
  await waitFor(() => expect(document.activeElement).toBe(action));
  daemon.handlers["terminal.open"] = () => {
    shells.push(info("shell", { owner: "/p" }));

    return { terminal_id: "shell" };
  };

  fireEvent.click(action);
  await waitFor(() => expect(document.activeElement?.getAttribute("data-terminal")).toBe("shell"));
  expect(daemon.calls.filter(call => call.method === "terminal.open").map(call => call.params)).toEqual([{ workstream: null, cols: 100, rows: 30 }, { workstream: null, cols: 100, rows: 30 }]);
  expect(screen.queryByRole("alert")).toBeNull();
});

it("u4313a_closing_the_last_terminal_returns_focus_to_plus", async () => {
  const { connected, daemon, shells } = await mountNavigation(true);
  shells.push(info("shell", { owner: "/p" }));
  await connected().rail.refresh({ terminals: true });
  daemon.handlers["terminal.close"] = () => { shells.splice(0);

    return null; };

  const close = document.querySelector<HTMLButtonElement>('.terminal-tab-pair[data-bubble="shell"] button:last-child')!;
  close.focus();
  fireEvent.click(close);
  await answerQuestion(true);
  await waitFor(() => expect(document.activeElement).toBe(document.querySelector(".terminal-new")));
  expect(within(screen.getByRole("group", { name: "Terminals" })).getAllByRole("button")).toEqual([document.querySelector(".terminal-new")]);
  expect(daemon.calls.filter(call => call.method === "terminal.close").map(call => call.params)).toEqual([{ id: "shell" }]);
});

it.each(["keyboard", "footer"].flatMap(source => ["home", "a1", null, "empty"].map(selection => ({ source, selection }))))("u4313a_rail_agent_uses_the_new_agent_action: $source $selection", async ({ source, selection }) => {
  const { daemon, connected, nodes } = await mountNavigation(selection === "empty");

  if (selection !== "empty") connected().rail.select(selection);
  const parent = selection === "home" ? "home" : null;
  daemon.handlers["agent.spawn"] = () => {
    const spawned = agent("fresh", "idle", "starting", { parent });
    nodes.push(spawned);
    queueMicrotask(() => daemon.emit({ actor: { kind: "user", id: "you", parent: null }, name: "rail.changed" }));

    return spawned;
  };

  if (source === "keyboard") window.dispatchEvent(new KeyboardEvent("keydown", { key: "n", code: "KeyN", metaKey: true, bubbles: true }));
  else await chooseFooter("Agent");
  await waitFor(() => expect(connected().rail.selected()).toBe("fresh"));
  expect(daemon.calls.filter(call => ["agent.spawn", "terminal.open", "rail.createWorkstream"].includes(call.method))).toEqual([
    { method: "agent.spawn", params: { cwd: "/p", prompt: null, parent, model: null, effort: null, cols: 100, rows: 30 } },
  ]);
});

it("u4277c_hidden_project_terminals_never_report_empty", async () => {
  const { connected, shells } = await mountNavigation(true);
  shells.push(info("shell", { owner: "other" }));
  await connected().rail.refresh({ terminals: true });
  const bar = await screen.findByRole("group", { name: "Terminals" });
  expect(within(bar).queryByRole("status")).toBeNull();
});

it.each(["home", "a1", null, "empty", "root-agent"])("u4453c_command_menu_opens_once_and_focuses: %s", async selection => {
  const { connected, daemon, nodes, shells, emulators } = await mountNavigation(selection === "empty" || selection === "root-agent");

  if (selection === "root-agent") {
    nodes.push(agent("root-agent", "idle", "ready"));
    shells.push(info("unrelated", { owner: "/p" }));
    await connected().rail.refresh({ terminals: true });
  }

  if (selection !== "empty") connected().rail.select(selection);
  const selected = connected().rail.selected();
  const owner = selection === "empty" || selection === "root-agent" ? null : "home";
  daemon.handlers["terminal.open"] = () => {
    shells.push(info("shell", { owner: owner ?? "/p" }));

    return { terminal_id: "shell" };
  };

  if (selection === "a1" || selection === "root-agent") await waitFor(() => expect(document.activeElement?.getAttribute("data-terminal")).toBe(`t-${selection}`));

  openSwitcher();
  const field = await screen.findByRole("combobox");
  await waitFor(() => expect(document.activeElement).toBe(field));
  fireEvent.input(field, { target: { value: "New Terminal" } });
  const option = await screen.findByRole("option", { name: /New Terminal/ });
  expect(option).toBeDefined();
  fireEvent.keyDown(field, { key: "Enter", code: "Enter" });
  await waitFor(() => expect(document.activeElement?.getAttribute("data-terminal")).toBe("shell"));
  expect(daemon.calls.filter(call => call.method === "terminal.open").map(call => call.params)).toEqual([{ workstream: owner, cols: 100, rows: 30 }]);
  expect(emulators.made.has("shell")).toBe(true);
  expect(document.querySelectorAll('.bubble[data-bubble="shell"]')).toHaveLength(1);
  expect(connected().rail.selected()).toBe(selected);

  if (selection === "root-agent") {
    expect(document.querySelector('.terminal-tab[data-bubble="unrelated"]')).toBeNull();
    connected().rail.select(null);
    expect(document.querySelector('.terminal-tab[data-bubble="shell"]')).not.toBeNull();
    connected().rail.select(selected);
    expect(document.querySelector('.terminal-tab[data-bubble="shell"]')).toBeNull();
  }
});

it.each(["agent", "door", "workstream", "ask", "inbox", "resources"].flatMap(view => [false, true].map(populated => ({ view, populated }))))("u4453c_terminal_bar_stays_in_every_view: $view $populated", async ({ view, populated }) => {
  const { connected, nodes, shells } = await mountNavigation(!populated);

  if (populated) {
    nodes.push(door("supervisor", "idle", "Ready", { parent: "home" }));
    shells.push(info("shell", { owner: "home", title: "shell" }));
    await connected().rail.refresh({ terminals: true });
    connected().rail.select(view === "agent" ? "a1" : view === "door" ? "supervisor" : view === "ask" ? null : "home");
  }

  if (view === "inbox" || view === "resources") connected().showView(view);
  const bar = screen.getByRole("group", { name: "Terminals" });
  expect(within(bar).getByRole("button", { name: "New Terminal" }).hasAttribute("disabled")).toBe(false);
  expect(bar.querySelector('.terminal-tab[data-bubble="shell"]') !== null).toBe(populated && view !== "ask");

});

it("u4453c_tabs_and_saved_drafts_stay_reachable", async () => {
  const { connected, shells, daemon } = await mountNavigation();
  shells.push(info("saved", { owner: "home", title: "zsh" }));
  await connected().rail.refresh({ terminals: true });
  connected().rail.select("home");
  const tab = document.querySelector<HTMLElement>('.terminal-tab[data-bubble="saved"]')!;
  fireEvent.dblClick(tab);
  const field = await screen.findByRole("textbox", { name: "Terminal name" });
  const text = "  saved e\u0301 🫧  ";
  fireEvent.input(field, { target: { value: text } });
  fireEvent.keyDown(field, { key: "Escape" });
  await waitFor(() => expect(document.activeElement?.getAttribute("data-bubble")).toBe("saved"));
  shells[0] = { ...shells[0]!, running: false, exit_code: 0 };
  await connected().rail.refresh({ terminals: true });
  const retained = connected().drafts.list();
  daemon.handlers["terminal.open"] = () => {
    shells.push(info("new", { owner: "home" }));

    return { terminal_id: "new" };
  };

  fireEvent.click(screen.getByRole("button", { name: "New Terminal" }));
  await waitFor(() => expect(document.activeElement?.getAttribute("data-terminal")).toBe("new"));
  expect(connected().drafts.list()).toEqual(retained);
  const recovery = document.querySelector<HTMLButtonElement>(".terminal-recover")!;
  recovery.focus();
  expect(document.activeElement).toBe(recovery);
  fireEvent.click(recovery);
  const dialog = await screen.findByRole("dialog", { name: "Unfinished work" });
  expect(dialog.querySelector(".draft-value")?.textContent).toBe(text);
  expect(connected().drafts.list()).toEqual([expect.objectContaining({ destination: { surface: "bubbles", object: shells[0]!.incarnation, recipient: "saved" }, value: { name: text, base: "zsh" } })]);
  expect(daemon.calls.filter(call => ["terminal.open", "terminal.close", "terminal.write"].includes(call.method))).toEqual([{ method: "terminal.open", params: { workstream: "home", cols: 100, rows: 30 } }]);
});

it.skipIf(!process.env.ROUNDUP_CAPTURES?.includes("U4453c"))("u4453c_rendered_root_agent_new_terminal", async () => {
  const { mkdirSync, writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { captureDir } = await import("../testing/captures");
  const { openLane } = await import("../todos/laneBrowser");
  const { startAppServer } = await import("../testing/appServer");
  const baseline = process.env.ROUNDUP_BASELINE_ROOT ? await startAppServer({ root: process.env.ROUNDUP_BASELINE_ROOT }) : null;
  const page = await openLane(1512, "dark", "u4453c-root-agent");
  const origin = await page.evaluate<string>("location.origin");

  try {
    for (const [side, url] of [...(baseline ? [["base", baseline.resolvedUrls.local[0]]] : []), ["head", origin]]) {
      await page.evaluate("localStorage.clear()");
      await page.browser("open", new URL("/harness.html?seed=agents-10", url).href);
      await page.until("!!window.__fake && !!document.querySelector('[data-id=agent-3]')");
      await page.browser("click", "[data-id=agent-3]");
      await page.until("document.querySelector('[data-id=agent-3]').getAttribute('data-selected') === 'true'");
      await page.browser("press", "Meta+k");
      await page.until("!!document.querySelector('.hint-line.leader')");
      await page.browser("press", "k");
      await page.until("document.activeElement?.getAttribute('role') === 'combobox'");
      await page.browser("fill", "[role=combobox]", "New Terminal");
      await page.until("!!document.querySelector('[role=option]')");
      await page.browser("press", "Enter");
      await page.until("window.__fake.app.calls.filter(c => c.method === 'terminal.open').length === 1 && !document.querySelector('[role=combobox]')");

      if (side === "head") await page.until("document.activeElement?.closest('.bubble') !== null");
      await page.evaluate("document.fonts.ready.then(() => true)");
      const output = join(captureDir("U4453c")!, side!);
      mkdirSync(output, { recursive: true });
      const observed = await page.evaluate<{ checks: unknown }>("({checks:window.__checks(), selected:document.querySelector('.rail-row[data-selected=true]')?.dataset.id, focused:document.activeElement?.closest('.bubble')?.dataset.bubble, shown:[...document.querySelectorAll('.bubble:not([hidden])')].map(b=>b.dataset.bubble), calls:window.__fake.app.calls.filter(c=>c.method==='terminal.open')})");
      writeFileSync(join(output, "root-agent.checks.json"), JSON.stringify(observed.checks, null, 2));
      writeFileSync(join(output, "root-agent.observation.json"), JSON.stringify({ ...observed, checks: undefined }, null, 2));
      await page.browser("screenshot", join(output, "root-agent.png"));

      if (side === "head") expect(observed).toMatchObject({ selected: "agent-3", calls: [{ method: "terminal.open", params: { workstream: null, cols: 100, rows: 30 } }] });
      await page.evaluate("localStorage.clear()");
      await page.browser("open", new URL("/harness.html?seed=tree-40", url).href);
      await page.until("!!window.__fake && !!document.querySelector('[data-id=migrate]')");
      await page.browser("click", "[data-id=migrate]");
      await page.until("document.querySelector('[data-id=migrate]').getAttribute('data-selected') === 'true'");
      await page.evaluate("window.__fake.app.handlers['terminal.open'] = () => { throw new Error('Cannot open Terminal: the shell could not start. Check the shell configuration and retry New Terminal.'); }; true");
      await page.until("!!document.querySelector('.terminal-new')");
      await page.browser("click", ".terminal-new");
      await page.until("document.querySelector('.bubbles [role=alert]')?.textContent.includes('Check the shell configuration')");
      writeFileSync(join(output, "root-agent-dense-open-failure.checks.json"), JSON.stringify(await page.evaluate("window.__checks()"), null, 2));
      await page.browser("screenshot", join(output, "root-agent-dense-open-failure.png"));
    }
  } finally {
    await page.close();
    await baseline?.close();
  }
}, 120_000);
