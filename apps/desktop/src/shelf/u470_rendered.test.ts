import { execFile } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { createServer } from "vite";
import { expect, it } from "vitest";
import { captureDir } from "../testing/captures";
import { CHECK_IDS } from "../testing/checks";
import type { Checks } from "../testing/checks";
import { appServer } from "../testing/appServer";

const exec = promisify(execFile);

it("u470_rendered_header_keeps_checks_and_failure_visible", async () => {
  const profile = mkdtempSync(join(tmpdir(), "u470-browser-"));
  const cacheDir = mkdtempSync(join(tmpdir(), "u470-vite-"));
  const server = await appServer();
  const mainRoot = process.env["ROUNDUP_U470_MAIN"];
  const main = mainRoot ? await createServer({ root: mainRoot, cacheDir: join(cacheDir, "main"), server: { port: 0, hmr: false }, logLevel: "silent" }) : null;
  await main?.listen();
  const session = `u470-${process.pid}`;
  const browser = async (...args: string[]) => (await exec("agent-browser", ["--session", session, "--profile", profile, ...args], { timeout: 60_000 })).stdout;
  const evaluate = async <T,>(script: string): Promise<T> => JSON.parse(await browser("eval", script));
  // Shelf.select queues its focus microtask; the following render frame observes that focus.
  const settle = () => browser("eval", "new Promise(resolve => requestAnimationFrame(() => resolve(true)))");

  const capture = async (step: string, checks: Checks) => {
    const dir = captureDir("U470");

    if (!dir) return;
    mkdirSync(dirname(join(dir, step)), { recursive: true });
    writeFileSync(join(dir, `${step}.checks.json`), JSON.stringify(checks) + "\n");
    await browser("screenshot", join(dir, `${step}.png`));
  };

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
    // One representative case: 1280 by 800, light, normal contrast.
    await browser("set", "viewport", "1280", "800");
    await browser("set", "media", "light");
    const tag = "1280x800-light";
    const baselines = new Map<string, Checks>();

    if (main) {
      await browser("open", `${main.resolvedUrls!.local[0]}harness.html?seed=tree-40`);
      await browser("wait", ".shelf-tabs");
      await evaluate(seed);
      await settle();

      for (const all of [false, true]) for (const tab of ["todos", "pads"]) {
        await evaluate(`(() => {
          document.querySelector('#shelf-tab-todos').click();
          [...document.querySelectorAll('[aria-label="Show Todos"] button')].find(b => b.textContent === '${all ? "All" : "This one"}').click();
          document.querySelector('#shelf-tab-${tab}').click(); return true;
        })()`);
        await settle();
        const checks = await evaluate<Checks>("window.__checks()");
        baselines.set(`${tab}-${all}`, checks);
        await capture(`base/${tag}-${tab}-${all}`, checks);
      }
    }

    await browser("open", `${server.resolvedUrls.local[0]}harness.html?seed=tree-40`);
    await browser("wait", ".shelf-tabs");
    await evaluate(seed);
    await settle();

    await browser("mouse", "move", "0", "0");

    for (const all of [false, true]) for (const tab of ["todos", "pads"]) {
      await evaluate(`(() => { if (${scope}.getAttribute('aria-pressed') !== '${all}') ${scope}.click(); document.querySelector('#shelf-tab-${tab}').click(); return true; })()`);
      await settle();

      const read = await evaluate<{ checks: Checks; rows: number; count: number }>(`(() => {
        return { checks: window.__checks(), rows: document.querySelectorAll('${tab === "todos" ? "[data-todo]" : ".pad-name"}').length, count: Number(document.querySelector('#shelf-tab-${tab} .shelf-count')?.textContent ?? 0) };
      })()`);

      expect(await evaluate<boolean>(`!!${scope}.querySelector('svg.lucide-list-filter')`)).toBe(true);
      expect(read.rows).toBe(read.count);

      for (const id of CHECK_IDS) {
        if (baselines.get(`${tab}-${all}`)?.[id].status === "pass") expect(read.checks[id].status, JSON.stringify(read.checks[id])).toBe("pass");
        expect(read.checks[id].status, JSON.stringify(read.checks[id])).toBe("pass");
      }

      await capture(`head/${tag}-${tab}-${all}`, read.checks);
    }

    // Real browser default button activation: Tab, Space, Enter, each one press.
    await evaluate(`(() => { document.querySelector('#shelf-tab-todos').click(); document.querySelector('#shelf-tab-todos').focus(); return true; })()`);
    await browser("press", "Tab");
    await settle();
    expect(await evaluate<boolean>(`document.activeElement === ${scope}`)).toBe(true);
    const before = await evaluate<string>(`${scope}.getAttribute('aria-pressed')`);
    await browser("press", "Space");
    await settle();
    expect(await evaluate<string>(`${scope}.getAttribute('aria-pressed')`)).toBe(before === "true" ? "false" : "true");
    await browser("press", "Enter");
    await settle();
    expect(await evaluate<string>(`${scope}.getAttribute('aria-pressed')`)).toBe(before);
    expect(await evaluate<boolean>(`document.activeElement === ${scope}`)).toBe(true);
    await browser("hover", ".scope-control");
    await capture(`interaction/${tag}-hover-focus`, await evaluate<Checks>("window.__checks()"));
    const point = await evaluate<number[]>(`(() => { const box = ${scope}.getBoundingClientRect(); return [box.left + box.width / 2, box.top + box.height / 2]; })()`);

    await browser("mouse", "move", String(point[0]), String(point[1]));
    await browser("mouse", "down", "left");
    expect(await evaluate<boolean>(`${scope}.matches(':active')`)).toBe(true);
    await capture(`interaction/${tag}-press`, await evaluate<Checks>("window.__checks()"));
    await browser("mouse", "up", "left");
    await settle();
    await evaluate(`(() => { ${scope}.click(); window.__fake.failNext(-32001, 'Injected completion failure'); document.querySelector('.shelf input[type="checkbox"]').click(); return true; })()`);
    await browser("wait", "--text", "Injected completion failure");
    const failure = { checks: await evaluate<Checks>("window.__checks()") };

    for (const id of CHECK_IDS) expect(failure.checks[id].status, id).toBe("pass");
    await capture(`interaction/${tag}-failure`, failure.checks);
  } finally {
    await browser("close");
    await server.close();
    await main?.close();
    rmSync(profile, { recursive: true, force: true });
    rmSync(cacheDir, { recursive: true, force: true });
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
