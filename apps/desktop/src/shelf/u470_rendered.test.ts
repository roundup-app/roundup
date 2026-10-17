import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { appServer } from "../testing/appServer";

const exec = promisify(execFile);

it("u470_scope_rows_match_counts_and_failure_stays_visible", async () => {
  const profile = mkdtempSync(join(tmpdir(), "u470-browser-"));
  const server = await appServer();
  const session = `u470-${process.pid}`;
  const browser = async (...args: string[]) => (await exec("agent-browser", ["--session", session, "--profile", profile, ...args], { timeout: 60_000 })).stdout;
  const evaluate = async <T,>(script: string): Promise<T> => JSON.parse(await browser("eval", script));
  // Shelf.select queues its focus microtask; the following render frame observes that focus.
  const settle = () => browser("eval", "new Promise(resolve => requestAnimationFrame(() => resolve(true)))");

  const seed = `(async () => {
    localStorage.clear();
    const rpc = window.__fake.app.rpc;
    for (const home of ['backend', 'auth', null]) {
      const todo = await rpc('todo.create', { title: home === 'backend' ? 'T'.repeat(300) : 'Scope Todo ' + home, body: null, blockers: null });
      await rpc('todo.move', { id: todo.id, home });
      const name = home === 'backend' ? 'p'.repeat(120) : 'scope-pad-' + home;
      await rpc('pad.create', { name, text: '' });
      await rpc('pad.move', { name, home });
    }
    document.querySelector('.rail [data-id="backend"] .name').click();
    return true;
  })()`;

  const scope = `document.querySelector('.scope-control')`;

  try {
    await browser("set", "viewport", "1280", "800");
    await browser("set", "media", "light");

    await browser("open", `${server.resolvedUrls.local[0]}harness.html?seed=tree-40`);
    await browser("wait", ".shelf-tabs");
    await evaluate(seed);
    await settle();

    await browser("mouse", "move", "0", "0");

    for (const all of [false, true]) for (const tab of ["todos", "pads"]) {
      await evaluate(`(() => { if (${scope}.getAttribute('aria-pressed') !== '${all}') ${scope}.click(); document.querySelector('#shelf-tab-${tab}').click(); return true; })()`);
      await settle();

      const read = await evaluate<{ rows: number; count: number }>(`(() => {
        return { rows: document.querySelectorAll('${tab === "todos" ? "[data-todo]" : ".pad-name"}').length, count: Number(document.querySelector('#shelf-tab-${tab} .shelf-count')?.textContent ?? 0) };
      })()`);

      expect(await evaluate<boolean>(`!!${scope}.querySelector('svg.lucide-list-filter')`)).toBe(true);
      expect(read.rows).toBe(read.count);
    }

    await evaluate(`document.querySelector('#shelf-tab-todos').click()`);
    await settle();
    await evaluate(`(() => { ${scope}.click(); window.__fake.failNext(-32001, 'Injected completion failure'); document.querySelector('.shelf input[type="checkbox"]').click(); return true; })()`);
    await browser("wait", "--text", "Injected completion failure");
  } finally {
    await browser("close");
    await server.close();
    rmSync(profile, { recursive: true, force: true });
  }
}, 120_000);

it("u470_tab_space_and_enter", async () => {
  const profile = mkdtempSync(join(tmpdir(), "u470-keys-"));
  const server = await appServer();


  const session = `u470-keys-${process.pid}`;
  const browser = async (...args: string[]) => (await exec("agent-browser", ["--session", session, "--profile", profile, ...args], { timeout: 60_000 })).stdout;
  const evaluate = async <T,>(script: string): Promise<T> => JSON.parse(await browser("eval", script));
  // Shelf.select queues its focus microtask before the render frame.
  const settle = () => browser("eval", "new Promise(resolve => requestAnimationFrame(() => resolve(true)))");

  try {
    await browser("open", `${server.resolvedUrls.local[0]}harness.html?seed=tree-40`);
    await browser("wait", ".shelf-tabs");
    await evaluate(`(() => { document.querySelector('.rail [data-id="backend"] .name').click(); document.querySelector('#shelf-tab-todos').focus(); return true; })()`);
    await browser("press", "Tab");
    await settle();
    expect(await evaluate<boolean>("document.activeElement === document.querySelector('.scope-control')")).toBe(true);
    await evaluate(`(() => {
      window.__scopePresses = { clicks: 0, keys: [], repeats: [] };
      const scope = document.querySelector('.scope-control');
      scope.addEventListener('click', () => window.__scopePresses.clicks++);
      scope.addEventListener('keydown', press => { window.__scopePresses.keys.push(press.key); window.__scopePresses.repeats.push(press.repeat); });
      return true;
    })()`);
    await browser("press", "Space");
    await settle();
    expect(await evaluate<string>("document.activeElement.getAttribute('aria-pressed')")).toBe("true");
    await browser("press", "Enter");
    await settle();
    expect(await evaluate<string>("document.activeElement.getAttribute('aria-pressed')")).toBe("false");
    expect(await evaluate<{ clicks: number; keys: string[]; repeats: boolean[] }>("window.__scopePresses")).toEqual({ clicks: 2, keys: [" ", "Enter"], repeats: [false, false] });
    await browser("press", "Tab");
    await settle();
    expect(await evaluate<string>("document.activeElement.getAttribute('aria-label')")).toBe("Hide work items");
  } finally {
    await browser("close");
    await server.close();
    rmSync(profile, { recursive: true, force: true });
  }
}, 90_000);
