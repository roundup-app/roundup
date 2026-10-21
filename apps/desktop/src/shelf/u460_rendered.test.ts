import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { appServer } from "../testing/appServer";

const exec = promisify(execFile);

it("u460_rendered_bulk_actions_name_failures", async () => {
  const profile = mkdtempSync(join(tmpdir(), "u460-browser-"));
  const server = await appServer();
  const session = `u460-${process.pid}`;
  const browser = async (...args: string[]) => (await exec("agent-browser", ["--session", session, "--profile", profile, ...args], { timeout: 60_000 })).stdout;
  const evaluate = async <T,>(script: string): Promise<T> => JSON.parse(await browser("eval", script));
  // Shelf.select and createBulkDelete.ask queue their focus microtasks; a render frame follows those microtasks.
  const settle = () => browser("eval", "new Promise(resolve => requestAnimationFrame(() => resolve(true)))");

  try {
    await browser("set", "viewport", "1280", "800");
    await browser("open", `${server.resolvedUrls.local[0]}harness.html?seed=tree-40`);
    await browser("wait", ".shelf-tabs");
    await evaluate(`(() => { const tab = document.querySelector('#shelf-tab-todos');
        if (tab.getAttribute('aria-expanded') !== 'true') tab.click(); return true; })()`);
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
        if (at < 2) await rpc('pad.setOwner', { name: padName, owner: { kind: 'agent', id: at === 0 ? 'tokens' : 'logins', parent: null } });
      }
      document.querySelector('.rail [data-id="backend"] .name').click();
      return true;
    })()`);
    await settle();
    await evaluate(`(() => { document.querySelector('.shelf [data-shelf-group="unassigned"][data-state="closed"] [data-part="branch-control"]')?.click(); return true; })()`);
    await settle();
    await evaluate(`(() => { const rows = document.querySelectorAll('.todo-row-button[aria-pressed]'); rows[2].dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true })); rows[3].dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })); return true; })()`);
    await settle();
    await evaluate(`(() => { document.querySelector('.shelf-bulk button').click(); return true; })()`);
    await settle();
    await evaluate(`(() => { window.__fake.failNext(-32001, 'Injected deletion failure'); document.querySelector('[role=alertdialog] .shelf-question-words button:last-child').click(); return true; })()`);
    await browser("wait", "--text", "Could not delete");
    await settle();

    expect(await evaluate<string>("document.querySelector('.shelf-bulk').textContent")).toContain("Injected deletion failure");
    await evaluate(`(() => { const row = document.querySelector('.todo-row-button[aria-pressed="true"]'); row.focus(); row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); document.querySelectorAll('.todo-row-button').forEach(button => { if (button.textContent.includes('done')) button.click(); }); return true; })()`);
    await settle();
    await browser("find", "role", "button", "click", "--name", "Clear done");
    await settle();
    await evaluate(`(() => { document.querySelector('[role=alertdialog] .shelf-question-words button:first-child').click(); return true; })()`);
    await settle();
    await evaluate(`(() => { [...document.querySelectorAll('[role="tab"]')].find(tab => tab.textContent.startsWith('Pads')).click(); return true; })()`);
    await settle();
    await evaluate(`(() => { const rows = document.querySelectorAll('.pad-name'); rows[4].focus(); rows[4].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true, cancelable: true })); rows[4].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', shiftKey: true, bubbles: true, cancelable: true })); return true; })()`);
    await settle();
    expect(await evaluate<string>("document.querySelector('.shelf-bulk').textContent")).toContain('2 selected');
    await evaluate(`(() => { document.querySelector('.shelf-bulk button').click(); return true; })()`);
    await settle();
    await evaluate(`(() => { const remove = window.__fake.app.handlers['pad.delete']; window.__fake.app.handlers['pad.delete'] = params => params.name.length === 120 ? Promise.reject(new Error('Pad deletion failure')) : remove(params); document.querySelector('[role=alertdialog] .shelf-question-words button:last-child').click(); return true; })()`);
    await browser("wait", "--text", "Pad deletion failure");
    await settle();

    expect(await evaluate<string>("document.querySelector('.shelf-bulk').textContent")).toContain('p'.repeat(120));
  } catch (error) {
    console.error(await browser("errors"));
    console.error(await browser("snapshot", "-i"));
    throw error;
  } finally {
    await browser("close");
    await server.close();
    rmSync(profile, { recursive: true, force: true });
  }
}, 90_000);
