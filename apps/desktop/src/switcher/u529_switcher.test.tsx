import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { chromePath } from "../testing/chromePage";
import { App } from "../App";
import { startRealDaemon } from "../testing/realDaemonFixture";
import { createServedApp } from "../testing/realSeam";
import { fakeEmulators } from "../terminal/paneHarness";
import type { AppSeam } from "../app/seam";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSignal, Show } from "solid-js";
import { Combobox } from "../ui/Combobox";
import { info } from "../testing/nodes";
import { openSwitcher, field, mountSwitcher, press, rows } from "./switcherFixture";

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });

const type = (text: string) => fireEvent.input(field()!, { target: { value: text } });

const methods = (app: { calls: { method: string }[] }) => app.calls.map((call) => call.method);

describe("u529 ⌘K switches to an Agent or Terminal by name", () => {
  it("u529_cmd_k_lists_agents_doors_groups_and_terminals_and_filters_as_you_type", async () => {
    await mountSwitcher();
    openSwitcher();
    await waitFor(() => expect(field()).not.toBeNull());

    expect(document.activeElement).toBe(field());
    // error, then needs-you, then Rail order; the Terminal last with its Workstream's name.
    expect(rows()).toEqual(["Cy", "Bob", "lead", "Ann", "ops", "Dee", "build shell ops"]);

    type("AN");
    await waitFor(() => expect(rows()).toEqual(["Ann"]));

    type("zzz");
    await waitFor(() => expect(document.querySelector(".switcher")!.textContent).toContain("No match"));
    expect(rows()).toEqual([]);
  });

  it("u529_enter_on_an_agent_selects_it_and_focuses_the_pane", async () => {
    const { connected, app } = await mountSwitcher();
    const before = app.calls.length;

    openSwitcher();
    await waitFor(() => expect(field()).not.toBeNull());
    type("dee");
    await waitFor(() => expect(rows()).toEqual(["Dee"]));
    press("Enter", {}, field()!);

    await waitFor(() => expect(connected.rail.selected()).toBe("dee"));
    expect(field()).toBeNull();
    expect(document.activeElement?.closest(".pane-screen")).not.toBeNull();
    expect(methods(app).slice(before)).not.toContain("takeover.begin");
  });

  it("u529_enter_on_a_terminal_shows_its_bubble_and_focuses_its_emulator", async () => {
    const { connected } = await mountSwitcher();

    openSwitcher();
    await waitFor(() => expect(field()).not.toBeNull());
    type("build");
    await waitFor(() => expect(rows()).toEqual(["build shell ops"]));
    press("Enter", {}, field()!);

    await waitFor(() => expect(connected.rail.selected()).toBe("ops"));
    await waitFor(() => expect(document.activeElement?.closest("[data-bubble]")?.getAttribute("data-bubble")).toBe("7"));
  });

  it("u524_the_switcher_restores_a_project_terminal_at_the_project_root", async () => {
    const { connected } = await mountSwitcher("dee", undefined, [info("8", { owner: "/p", title: "project shell" })]);

    openSwitcher();
    await waitFor(() => expect(field()).not.toBeNull());
    type("project shell");
    press("Enter", {}, field()!);

    await waitFor(() => expect(document.activeElement?.closest("[data-bubble]")?.getAttribute("data-bubble")).toBe("8"));
    expect(connected.rail.selected()).toBeNull();
  });

  it("u529_escape_returns_focus_and_calls_nothing", async () => {
    const { app } = await mountSwitcher();
    const origin = document.querySelector<HTMLElement>('[role="tree"] [tabindex="0"]')!;

    origin.focus();

    const calls = app.calls.length;

    openSwitcher();
    await waitFor(() => expect(field()).not.toBeNull());
    press("Escape", {}, field()!);

    await waitFor(() => expect(field()).toBeNull());
    expect(document.activeElement).toBe(origin);
    expect(app.calls.length).toBe(calls);
  });
});

it("u2773a_queries_controlled_input_restores_without_execution", async () => {
  const { app, connected } = await mountSwitcher("ann");
  const [query, setQuery] = createSignal("");
  const [open, setOpen] = createSignal(true);
  const [highlighted, setHighlighted] = createSignal<string | null>("dee");
  const select = vi.fn((value: string) => connected.rail.select(value));
  const exact = "  e\u0301 🧭 東京  ";
  const items = [{ value: "dee", label: exact }, { value: "ann", label: "other" }];
  let input!: HTMLInputElement;

  const view = render(() => <Show when={open()}><Combobox.Root items={items.filter((item) => item.label.includes(query()))}
    inputValue={query()} inputRef={(element) => { input = element; }}
    highlightedValue={highlighted()} onHighlightChange={setHighlighted} onInput={setQuery} onSelect={select}
    label="Query" placeholder="" empty="" row={(item) => item.label} /></Show>);

  await waitFor(() => expect(document.activeElement).toBe(input));
  fireEvent.input(input, { target: { value: exact } });
  input.setSelectionRange(2, 9, "backward");
  const selection = { start: input.selectionStart, end: input.selectionEnd, direction: input.selectionDirection };
  const origin = document.querySelector<HTMLElement>('[role="tree"] [tabindex="0"]')!;
  origin.focus();
  const calls = app.calls.length;

  setQuery("");
  await waitFor(() => expect(input.value).toBe(""));
  setQuery(exact);
  await waitFor(() => expect(input.value).toBe(exact));
  expect([...view.container.querySelectorAll('[role="option"]')].map((row) => row.getAttribute("data-value"))).toEqual(["dee"]);
  expect(document.activeElement).toBe(origin);

  // Explicit reopening remounts the field; the owner restores selection through the fresh native ref.
  const previous = input;
  setOpen(false);
  setOpen(true);
  await waitFor(() => expect(document.activeElement).toBe(input));
  expect(input).not.toBe(previous);
  input.focus();
  input.setSelectionRange(selection.start, selection.end, selection.direction ?? undefined);
  expect([input.selectionStart, input.selectionEnd, input.selectionDirection]).toEqual([2, 9, "backward"]);
  expect(input.value).toBe(exact);
  expect(document.activeElement).toBe(input);
  expect(select).not.toHaveBeenCalled();
  expect(connected.rail.selected()).toBe("ann");
  expect(app.calls.length).toBe(calls);
});


it("u2773a_queries_restores_exact_work", async () => {
  const { app, connected } = await mountSwitcher("ann");
  const exact = "  e\u0301 🧭 東京  ";
  openSwitcher();
  await waitFor(() => expect(field()).not.toBeNull());
  type(exact);
  field()!.setSelectionRange(2, 9, "backward");
  press("Escape", {}, field()!);
  const calls = app.calls.length;
  openSwitcher();
  await waitFor(() => expect(field()?.value).toBe(exact));
  await waitFor(() => expect([field()!.selectionStart, field()!.selectionEnd, field()!.selectionDirection]).toEqual([2, 9, "backward"]));
  expect(connected.rail.selected()).toBe("ann");
  expect(app.calls.length).toBe(calls);

  cleanup();
  const reopened = await mountSwitcher("ann");
  const origin = document.querySelector<HTMLElement>('[role="tree"] [tabindex="0"]')!;
  origin.focus();
  const reopenedCalls = reopened.app.calls.length;
  await Promise.resolve();
  expect(document.activeElement).toBe(origin);
  expect(field()).toBeNull();
  openSwitcher();
  await waitFor(() => expect(field()?.value).toBe(exact));
  await waitFor(() => expect([field()!.selectionStart, field()!.selectionEnd, field()!.selectionDirection]).toEqual([2, 9, "backward"]));
  expect(reopened.app.calls.length).toBe(reopenedCalls);
});


it.each(["write", "read", "invalid"])("u2773e_recovery_actions_keep_surface_draft_%s", async (failure) => {
  const key = "roundup:drafts:/p";
  const exact = "  e\u0301 🧭 東京  ";
  const writeText = vi.fn(async (_text: string) => {});
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });

  if (failure === "invalid") localStorage.setItem(key, "{broken");

  const read = failure === "read" ? vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); }) : null;
  const { app } = await mountSwitcher();
  const write = failure === "write" ? vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("full"); }) : null;
  const calls = app.calls.length;
  openSwitcher();
  await waitFor(() => expect(field()).not.toBeNull());
  type(exact);
  expect(await screen.findByRole("alert")).toBeDefined();
  expect(field()!.value).toBe(exact);
  fireEvent.click(screen.getByRole("button", { name: "Copy query" }));

  await waitFor(() => expect(writeText).toHaveBeenCalledWith(exact));

  if (failure === "invalid") expect(localStorage.getItem(key)).toBe("{broken");

  read?.mockRestore();
  write?.mockRestore();

  if (failure === "invalid") localStorage.removeItem(key);

  fireEvent.click(screen.getByRole("button", { name: "Retry storage" }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(JSON.parse(localStorage.getItem(key)!).drafts.at(-1).value.query).toBe(exact);
  expect(field()!.value).toBe(exact);
  expect(app.calls.length).toBe(calls);

  const refuse = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("full"); });
  type("newer query");
  await screen.findByRole("alert");
  refuse.mockRestore();
  fireEvent.click(screen.getByRole("button", { name: "Discard query" }));
  expect(field()!.value).toBe("");
  expect(JSON.parse(localStorage.getItem(key)!).drafts).toEqual([]);
  expect(app.calls.length).toBe(calls);
});


it("u2773a_queries_keep_original_project_through_switch_events_and_reopen", async () => {
  const first = await startRealDaemon({});
  const second = await startRealDaemon({});

  try {
    const served = [createServedApp(first.base), createServedApp(second.base)];
    const projects = [(await served[0]!.projects())[0]!, (await served[1]!.projects())[0]!];

    const identities = await Promise.all(served.map((app) => app.rpc("rail.createWorkstream", { name: "same name", parent: null })));
    const mutations: string[] = [];

    const apps = served.map((app): AppSeam => ({ ...app, rpc: (method, params) => {
      if (!["rail.tree", "terminal.list", "daemon.ping", "worktree.status", "decision.list", "events.subscribe", "terminal.scheme"].includes(method)) mutations.push(method);

      return app.rpc(method, params);
    } }));

    const app: AppSeam = { ...apps[0]!, projects: async () => projects, forProject: (path) => apps[path === first.dir ? 0 : 1]! };
    const mount = () => render(() => <App app={app} reducedMotion={() => false} clock={Date.now} createEmulator={fakeEmulators().factory} />);

    const chooseProject = async (path: string) => {
      await waitFor(() => expect(document.querySelector(`.project-tab[data-path="${path}"]`)).not.toBeNull());
      fireEvent.click(document.querySelector(`.project-tab[data-path="${path}"] [role="tab"]`)!);
      await waitFor(() => expect(document.querySelector(`.project-tab[data-path="${path}"] [role="tab"]`)?.getAttribute("aria-selected")).toBe("true"));
      await waitFor(() => expect(document.querySelector(`.rail-row[data-id="${identities[path === first.dir ? 0 : 1]!.id}"]`)).not.toBeNull());
    };

    mount();
    await chooseProject(first.dir);
    openSwitcher();
    await waitFor(() => expect(field()).not.toBeNull());
    type("  first e\u0301 🧭 東京  ");
    field()!.setSelectionRange(2, 8, "backward");
    press("Escape", {}, field()!);
    await chooseProject(second.dir);
    openSwitcher();
    await waitFor(() => expect(field()?.value).toBe(""));
    type(" second 🧭 ");
    press("Escape", {}, field()!);
    await served[0]!.rpc("rail.rename", { id: identities[0]!.id, name: "incoming rename" });
    await chooseProject(first.dir);
    openSwitcher();
    await waitFor(() => expect(field()?.value).toBe("  first e\u0301 🧭 東京  "));
    await waitFor(() => expect([field()!.selectionStart, field()!.selectionEnd, field()!.selectionDirection]).toEqual([2, 8, "backward"]));
    press("Escape", {}, field()!);
    mutations.length = 0;
    cleanup();
    mount();
    await chooseProject(second.dir);
    expect(field()).toBeNull();
    openSwitcher();
    await waitFor(() => expect(field()?.value).toBe(" second 🧭 "));
    expect(mutations.filter((method) => !method.endsWith(".list") && !method.endsWith(".get") && !method.endsWith(".count"))).toEqual([]);
  } finally {
    cleanup();
    await second.stop();
    await first.stop();
  }
}, 180_000);


it("u2773a_queries_browser_reload_retains_caret_without_execution", async () => {
  const real = await startRealDaemon({}, true);
  const profile = await mkdtemp(join(tmpdir(), "u2773-queries-"));
  const config = join(profile, "config.json");
  await writeFile(config, "{}");

  const executable = chromePath();

  if (!executable) throw new Error("Query observer requires isolated Chromium");

  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("AGENT_BROWSER_")));

  const browser = async (...args: string[]) => {
    const { stdout } = await promisify(execFile)("agent-browser", ["--executable-path", executable, "--args", "--no-sandbox", "--config", config, "--session", `queries-${process.pid}`, "--profile", profile, "--json", ...args], { env, timeout: 60_000 });
    const reply = JSON.parse(stdout);

    expect(reply.success, stdout).toBe(true);

    return reply.data;
  };

  const open = () => browser("eval", `(() => {
    for (const event of [{ key: 'k', code: 'KeyK', metaKey: true }, { key: 'k', code: 'KeyK' }])
      document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { ...event, bubbles: true, cancelable: true }));
  })()`);

  try {
    await browser("open", `${real.base}/harness.html?daemon=1`);
    await browser("set", "viewport", "1512", "950");
    await browser("wait", "--fn", "!!document.querySelector('.project-tab')");
    await open();
    await browser("wait", "--fn", "!!document.querySelector('.switcher input')");
    await browser("eval", "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
    await browser("eval", `(() => {
      const input = document.querySelector('.switcher input');
      input.value = '  é 🧭 東京  ';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.setSelectionRange(2, 9, 'backward');
      input.dispatchEvent(new Event('select'));
    })()`);
    await browser("reload");
    await browser("wait", "--fn", "!!document.querySelector('.project-tab')");
    expect((await browser("eval", "!!document.querySelector('.switcher')")).result).toBe(false);
    await browser("eval", `window.__queryCalls = []; const originalFetch = window.fetch.bind(window); window.fetch = (url, init) => { if (String(url).endsWith('/rpc')) window.__queryCalls.push(JSON.parse(init.body).method); return originalFetch(url, init); };`);
    await open();
    await browser("wait", "--fn", "document.querySelector('.switcher input')?.value === '  é 🧭 東京  ' && document.querySelector('.switcher input').selectionStart === 2");
    expect((await browser("eval", "(() => { const input = document.querySelector('.switcher input'); return [input.selectionStart, input.selectionEnd, input.selectionDirection, document.activeElement === input, window.__queryCalls]; })()")).result).toEqual([2, 9, "backward", true, []]);

    await browser("open", `${real.base}/harness.html?seed=tree-40`);
    await browser("wait", "--fn", "!!document.querySelector('.project-tab')");
    await open();
    await browser("wait", "--fn", "!!document.querySelector('.switcher input')");
    console.info("U2773 queries baseline Checks", (await browser("eval", "window.__checks()")).result);
    await browser("screenshot", join(tmpdir(), "u2773-queries-before.png"));
    await browser("eval", `(() => {
      const write = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key, value) { if (key.startsWith('roundup:drafts:')) throw new Error('full'); return write.call(this, key, value); };
      const input = document.querySelector('.switcher input');
      input.value = '  é 🧭 東京  ';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await browser("wait", "--fn", "!!document.querySelector('.switcher [role=alert]')");
    console.info("U2773 queries retention failure Checks", (await browser("eval", "window.__checks()")).result);
    await browser("screenshot", join(tmpdir(), "u2773-queries-after.png"));
  } finally {
    await browser("close");
    await real.stop();
    await rm(profile, { recursive: true, force: true });
  }
}, 180_000);
