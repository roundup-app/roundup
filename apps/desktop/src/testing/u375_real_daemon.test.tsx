// @vitest-environment jsdom
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { chromePath } from "./chromePage";
import { appServer } from "./appServer";
import { openSwitcher, field, switcherKey as press } from "../switcher/switcherFixture";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { RequestedApp as App } from "../testing/requestedApp";
import type { AppSeam } from "../app/seam";
import { fakeEmulators } from "../terminal/paneHarness";
import { createServedApp } from "./realSeam";
import { startRealDaemon } from "./realDaemonFixture";

afterEach(() => { cleanup(); localStorage.clear(); });

window.matchMedia ??= (query) => ({ matches: false, media: query, onchange: null, addListener: () => undefined, removeListener: () => undefined, addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false });

it("u2773a_queries_keep_original_project_through_switch_events_and_reopen", async () => {
  const first = await startRealDaemon({});
  const second = await startRealDaemon({});

  try {
    const served = [createServedApp(first.base), createServedApp(second.base)];
    const projects = [(await served[0]!.projects())[0]!, (await served[1]!.projects())[0]!];

    const identities = await Promise.all(served.map((app) => app.rpc("rail.createWorkstream", { name: "same name", parent: null })));
    const mutations: string[] = [];

    const apps = served.map((app): AppSeam => ({ ...app, rpc: (method, params) => {
      if (!["rail.tree", "terminal.list", "daemon.ping", "worktree.status", "events.subscribe", "terminal.scheme"].includes(method)) mutations.push(method);

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
    fireEvent.input(field()!, { target: { value: "  first e\u0301 🧭 東京  " } });
    field()!.setSelectionRange(2, 8, "backward");
    press("Escape", {}, field()!);
    await chooseProject(second.dir);
    openSwitcher();
    await waitFor(() => expect(field()?.value).toBe(""));
    fireEvent.input(field()!, { target: { value: " second 🧭 " } });
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
    expect(mutations.filter((method) => !method.endsWith(".list") && !method.endsWith(".get") && !method.endsWith(".count") && method !== "workstream.queue" && method !== "todo.listHanded")).toEqual([]);
  } finally {
    cleanup();
    await second.stop();
    await first.stop();
  }
}, 60_000);


it("u2773a_queries_browser_reload_retains_caret_without_execution", async () => {
  const server = await appServer();
  const base = server.resolvedUrls.local[0]!;
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
    await browser("open", `${base}harness.html?view=workstreams&items=1&tabs=1&seed=tree-40`);
    await browser("set", "viewport", "1512", "950");
    await browser("wait", "--fn", "!!document.querySelector('.project-tab')");
    await open();
    await browser("wait", "--fn", "!!document.querySelector('.switcher input')");
    await browser("eval", "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
    await browser("eval", `(() => {
      const input = document.querySelector('.switcher input');
      input.value = '  é 🧭 東京  ';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await browser("eval", `(() => {
      const input = document.querySelector('.switcher input');
      input.setSelectionRange(2, 9, 'backward');
      input.dispatchEvent(new Event('select'));
    })()`);
    await browser("reload");
    await browser("wait", "--fn", "!!document.querySelector('.project-tab')");
    expect((await browser("eval", "!!document.querySelector('.switcher')")).result).toBe(false);
    await browser("eval", "window.__queryCallStart = window.__fake.app.calls.length");
    await open();
    await browser("wait", "--fn", "document.querySelector('.switcher input')?.value === '  é 🧭 東京  ' && document.querySelector('.switcher input').selectionStart === 2");
    expect((await browser("eval", "(() => { const input = document.querySelector('.switcher input'); return [input.selectionStart, input.selectionEnd, input.selectionDirection, document.activeElement === input, window.__fake.app.calls.slice(window.__queryCallStart)]; })()")).result).toEqual([2, 9, "backward", true, []]);

    // The retention-failure probe starts without the query restored above.
    await browser("eval", "localStorage.clear()");
    await browser("open", `${base}harness.html?view=workstreams&items=1&tabs=1&seed=tree-40`);
    await browser("wait", "--fn", "!!document.querySelector('.project-tab')");
    await open();
    await browser("wait", "--fn", "!!document.querySelector('.switcher input')");
    console.info("U2773 queries baseline Checks", (await browser("eval", "window.__checks()")).result);
    await browser("screenshot", join(tmpdir(), "u2773-queries-before.png"));
    await browser("eval", `(() => {
      const write = Storage.prototype.setItem;
      window.__queryStorageWrite = write;
      Storage.prototype.setItem = function(key, value) { if (key.startsWith('roundup:drafts:')) throw new Error('full'); return write.call(this, key, value); };
      const input = document.querySelector('.switcher input');
      input.value = '  é 🧭 東京  ';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await browser("wait", "--fn", "!!document.querySelector('.switcher [role=alert]')");
    console.info("U2773 queries retention failure Checks", (await browser("eval", "window.__checks()")).result);
    await browser("screenshot", join(tmpdir(), "u2773-queries-after.png"));
    const calls = (await browser("eval", "window.__fake.app.calls.length")).result;
    await browser("eval", `(() => {
      Storage.prototype.setItem = window.__queryStorageWrite;
      const input = document.querySelector('.switcher input');
      input.setSelectionRange(2, 9, 'backward');
      [...document.querySelectorAll('.switcher button')].find(button => button.textContent === 'Try again').focus();
    })()`);
    await browser("press", "Enter");
    await browser("wait", "--fn", "!document.querySelector('.switcher [role=alert]') && document.activeElement === document.querySelector('.switcher input')");
    expect((await browser("eval", `(() => {
      const input = document.querySelector('.switcher input');
      return [input.value, input.selectionStart, input.selectionEnd, input.selectionDirection, window.__fake.app.calls.length];
    })()`)).result).toEqual(["  é 🧭 東京  ", 2, 9, "backward", calls]);
    await browser("eval", `(() => {
      Storage.prototype.setItem = function() { throw new Error('full'); };
      const input = document.querySelector('.switcher input');
      input.value = 'discard this query';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await browser("wait", "--fn", "!!document.querySelector('.switcher [role=alert]')");
    await browser("eval", "[...document.querySelectorAll('.switcher button')].find(button => button.textContent === 'Discard query').focus()");
    await browser("press", "Enter");
    await browser("wait", "--fn", "!!document.querySelector('.switcher [role=alert]') && document.activeElement === document.querySelector('.switcher input')");
    expect((await browser("eval", "[document.querySelector('.switcher input').value, !!document.querySelector('.switcher [role=alert]'), window.__fake.app.calls.length]")).result).toEqual(["", true, calls]);
  } finally {
    await browser("close");
    await server.close();
    await rm(profile, { recursive: true, force: true });
  }
}, 60_000);
