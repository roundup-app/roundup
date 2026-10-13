import { execFile } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createServer } from "vite";
import { expect, it } from "vitest";
import { captureDir } from "../testing/captures";
import { CHECK_IDS } from "../testing/checks";
import type { Checks } from "../testing/checks";

const exec = promisify(execFile);

it("u460_rendered_bulk_actions_keep_checks_and_failure_names_visible", async () => {
  const profile = mkdtempSync(join(tmpdir(), "u460-browser-"));
  const cacheDir = mkdtempSync(join(tmpdir(), "u460-vite-"));
  const server = await createServer({ root: process.cwd(), cacheDir, server: { port: 0, hmr: false }, logLevel: "silent" });
  await server.listen();
  const session = `u460-${process.pid}`;
  let more = false;
  const browser = async (...args: string[]) => (await exec("agent-browser", ["--session", session, "--profile", profile, ...(more ? ["--args", "--force-high-contrast"] : []), ...args], { timeout: 60_000 })).stdout;
  const evaluate = async <T,>(script: string): Promise<T> => JSON.parse(await browser("eval", script));
  const settle = () => browser("eval", "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))");

  const capture = async (id: string, step: string, readings: Checks) => {
    const dir = captureDir(id);

    if (!dir) return;
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${step}.checks.json`), JSON.stringify(readings, null, 2));
    await browser("screenshot", join(dir, `${step}.png`));
  };

  try {
    for (const contrast of [false, true]) {
    more = contrast;

    for (const width of [1280, 1440]) for (const scheme of ["light", "dark"]) {
      await browser("set", "viewport", String(width), "800");
      await browser("set", "media", scheme);
      await browser("open", `${server.resolvedUrls!.local[0]}harness.html?seed=tree-40`);
      await browser("wait", ".shelf-tabs");
      await evaluate(`(() => { [...document.querySelectorAll('[role="tab"]')].find(tab => tab.textContent.startsWith('Todos')).click(); return true; })()`);
      await settle();
      await evaluate(`(async () => {
        const fake = window.__fake;
        const rpc = fake.app.rpc;
        for (let at = 0; at < 7; at++) {
          const made = await rpc('todo.create', { title: at === 4 ? 'Long '.repeat(60) : 'same title', body: null, blockers: null });
          await rpc('todo.move', { id: made.id, home: 'backend' });
          if (at < 2) await rpc('todo.complete', { id: made.id });
          const padName = at === 4 ? 'p'.repeat(120) : 'bulk-pad-' + at;
          await rpc('pad.create', { name: padName, text: '' });
          await rpc('pad.move', { name: padName, home: at < 5 ? 'backend' : null });
          if (at < 2) await rpc('pad.setOwner', { name: padName, owner: { kind: 'agent', id: at === 0 ? 'token-rotation' : 'login-store', parent: null } });
        }
        document.querySelector('.rail [data-id="backend"] .name').click();
        return true;
      })()`);
      await settle();
      const baseline = await evaluate<Checks>("window.__checks()");
      await evaluate(`(() => { const rows = document.querySelectorAll('.todo-row-button[aria-pressed]'); rows[0].dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true })); rows[1].dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })); return true; })()`);
      await settle();
      const before = await evaluate<number>("document.querySelector('.shelf-bulk-line').getBoundingClientRect().height");
      const tag = `${width}x800-${scheme}${more ? "-contrast" : ""}`;
      await capture("U458", `${tag}-selection`, await evaluate<Checks>("window.__checks()"));
      await evaluate(`(() => { document.querySelector('.shelf-bulk button').click(); return true; })()`);
      await settle();
      expect(await evaluate<number>("document.querySelector('.shelf-bulk-line').getBoundingClientRect().height")).toBe(before);
      await capture("U460", `${tag}-question`, await evaluate<Checks>("window.__checks()"));
      await evaluate(`(() => { window.__fake.failNext(-32001, 'Injected deletion failure'); document.querySelector('.shelf-bulk button').click(); return true; })()`);
      await browser("wait", "--text", "Could not delete");
      await settle();

      const failure = await evaluate<{ checks: Checks; overflow: boolean; outside: boolean; text: string }>(`(() => {
        const bulk = document.querySelector('.shelf-bulk');
        return { checks: window.__checks(), overflow: bulk.scrollWidth > bulk.clientWidth, outside: !bulk.closest('.shelf-scroll'), text: bulk.textContent };
      })()`);

      expect(failure.overflow).toBe(false);
      expect(failure.outside).toBe(true);
      expect(failure.text).toContain("Injected deletion failure");

      for (const id of CHECK_IDS) if (baseline[id].status === "pass") expect(failure.checks[id].status, id).toBe("pass");

      for (const id of ["D2", "D5", "D6", "D14"] as const) expect(failure.checks[id].status, id).toBe("pass");
      await capture("U460", `${tag}-failure`, failure.checks);
      await evaluate(`(() => { const row = document.querySelector('.todo-row-button[aria-pressed="true"]'); row.focus(); row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); document.querySelectorAll('.todo-row-button').forEach(button => { if (button.textContent.includes('done')) button.click(); }); return true; })()`);
      await settle();
      await browser("find", "role", "button", "click", "--name", "Clear done");
      await settle();
      await capture("U459", `${tag}-clear-done`, await evaluate<Checks>("window.__checks()"));
      await evaluate(`(() => { document.querySelector('.shelf-bulk button:last-child').click(); return true; })()`);
      await settle();
      await capture("U459", `${tag}-cancel`, await evaluate<Checks>("window.__checks()"));
      await evaluate(`(() => { [...document.querySelectorAll('[role="tab"]')].find(tab => tab.textContent.startsWith('Pads')).click(); return true; })()`);
      await settle();
      await evaluate(`(() => { const rows = document.querySelectorAll('.pad-name'); rows[0].focus(); rows[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true, cancelable: true })); rows[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true, bubbles: true, cancelable: true })); return true; })()`);
      await settle();
      expect(await evaluate<string>("document.querySelector('.shelf-bulk').textContent")).toContain('2 selected');
      await capture("U458", `${tag}-pads-selection`, await evaluate<Checks>("window.__checks()"));
      await evaluate(`(() => { document.querySelector('.shelf-bulk button').click(); return true; })()`);
      await settle();
      await evaluate(`(() => { window.__fake.failNext(-32001, 'Pad deletion failure'); document.querySelector('.shelf-bulk button').click(); return true; })()`);
      await browser("wait", "--text", "Pad deletion failure");
      await settle();

      const padChecks = await evaluate<Checks>("window.__checks()");

      for (const id of CHECK_IDS) if (baseline[id].status === 'pass') expect(padChecks[id].status, id).toBe('pass');

      for (const id of ["D2", "D5", "D6", "D14"] as const) expect(padChecks[id].status, id).toBe('pass');
      expect(await evaluate<boolean>("document.querySelector('.shelf-bulk').scrollWidth <= document.querySelector('.shelf-bulk').clientWidth")).toBe(true);
      await capture("U460", `${tag}-pads-failure`, await evaluate<Checks>("window.__checks()"));
    }

    await browser("close");
    }
  } catch (error) {
    console.error(await browser("errors"));
    console.error(await browser("snapshot", "-i"));
    throw error;
  } finally {
    await browser("close");
    await server.close();
    rmSync(profile, { recursive: true, force: true });
    rmSync(cacheDir, { recursive: true, force: true });
  }
}, 240_000);
