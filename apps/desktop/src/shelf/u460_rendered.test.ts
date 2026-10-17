import { execFile } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { captureDir } from "../testing/captures";
import { contrastRgb } from "../testing/contrast";
import { CHECK_IDS } from "../testing/checks";
import type { Checks } from "../testing/checks";
import { appServer } from "../testing/appServer";

const exec = promisify(execFile);

describe("u135_selected_shelf_metadata_keeps_compound_contrast", () => {
  it.each([
    ["light", 1280], ["light", 1440], ["dark", 1280], ["dark", 1440],
  ] as const)("u460_rendered_bulk_actions_keep_checks_and_failure_names_visible %s %i", async (scheme, width) => {
    const profile = mkdtempSync(join(tmpdir(), "u460-browser-"));
    const server = await appServer();
    const session = `u460-${process.pid}`;
    const browser = async (...args: string[]) => (await exec("agent-browser", ["--session", session, "--profile", profile, ...args], { timeout: 60_000 })).stdout;
    const evaluate = async <T,>(script: string): Promise<T> => JSON.parse(await browser("eval", script));
    // Shelf.select and createBulkDelete.ask queue their focus microtasks; a render frame follows those microtasks.
    const settle = () => browser("eval", "new Promise(resolve => requestAnimationFrame(() => resolve(true)))");

    const capture = async (id: string, step: string, readings: Checks) => {
      const dir = captureDir(id);

      if (!dir) return;
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${step}.checks.json`), JSON.stringify(readings) + "\n");
      await browser("screenshot", join(dir, `${step}.png`));
    };

    try {
      // U135: both schemes and Shelf viewport widths must keep the selected metadata readable.
      await browser("set", "viewport", String(width), "800");
      await browser("set", "media", scheme);
      await browser("open", `${server.resolvedUrls.local[0]}harness.html?seed=tree-40`);
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
          if (at < 2) await rpc('pad.setOwner', { name: padName, owner: { kind: 'agent', id: at === 0 ? 'tokens' : 'logins', parent: null } });
        }
        document.querySelector('.rail [data-id="backend"] .name').click();
        return true;
      })()`);
      await settle();
      const baseline = await evaluate<Checks>("window.__checks()");
      await capture("U458", `${width}x800-${scheme}-baseline`, baseline);
      await evaluate(`(() => { const rows = document.querySelectorAll('.todo-row-button[aria-pressed]'); rows[2].dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true })); rows[3].dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })); return true; })()`);
      await settle();
      const tag = `${width}x800-${scheme}`;
      await capture("U458", `${tag}-selection`, await evaluate<Checks>("window.__checks()"));
      await evaluate(`(() => { document.querySelector('.shelf-bulk button').click(); return true; })()`);
      await settle();
      await capture("U460", `${tag}-question`, await evaluate<Checks>("window.__checks()"));
      await evaluate(`(() => { window.__fake.failNext(-32001, 'Injected deletion failure'); document.querySelector('.shelf-bulk button').click(); return true; })()`);
      await browser("wait", "--text", "Could not delete");
      await settle();

      const failure = await evaluate<{ checks: Checks; text: string }>(`(() => ({ checks: window.__checks(), text: document.querySelector('.shelf-bulk').textContent }))()`);

      expect(failure.text).toContain("Injected deletion failure");

      for (const id of CHECK_IDS) expect(failure.checks[id].status, id).toBe("pass");
      await capture("U460", `${tag}-failure`, failure.checks);
      await evaluate(`(() => { const row = document.querySelector('.todo-row-button[aria-pressed="true"]'); row.focus(); row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); document.querySelectorAll('.todo-row-button').forEach(button => { if (button.textContent.includes('done')) button.click(); }); return true; })()`);
      await settle();
      await capture("U460", `${tag}-cancel-selection`, await evaluate<Checks>("window.__checks()"));
      await browser("find", "role", "button", "click", "--name", "Clear done");
      await settle();
      await capture("U459", `${tag}-clear-done`, await evaluate<Checks>("window.__checks()"));
      await evaluate(`(() => { document.querySelector('.shelf-bulk button:last-child').click(); return true; })()`);
      await settle();
      await capture("U459", `${tag}-cancel`, await evaluate<Checks>("window.__checks()"));
      await evaluate(`(() => { [...document.querySelectorAll('[role="tab"]')].find(tab => tab.textContent.startsWith('Pads')).click(); return true; })()`);
      await settle();
      await evaluate(`(() => { const rows = document.querySelectorAll('.pad-name'); rows[4].focus(); rows[4].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true, cancelable: true })); rows[4].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', shiftKey: true, bubbles: true, cancelable: true })); return true; })()`);
      await settle();
      expect(await evaluate<string>("document.querySelector('.shelf-bulk').textContent")).toContain('2 selected');
      await capture("U458", `${tag}-pads-selection`, await evaluate<Checks>("window.__checks()"));
      await evaluate(`(() => { document.querySelector('.shelf-bulk button').click(); return true; })()`);
      await settle();
      await capture("U460", `${tag}-pads-question`, await evaluate<Checks>("window.__checks()"));
      await evaluate(`(() => { const remove = window.__fake.app.handlers['pad.delete']; window.__fake.app.handlers['pad.delete'] = params => params.name.length === 120 ? Promise.reject(new Error('Pad deletion failure')) : remove(params); document.querySelector('.shelf-bulk button').click(); return true; })()`);
      await browser("wait", "--text", "Pad deletion failure");
      await settle();

      const metadata = await evaluate<{ text: { r: number; g: number; b: number }; ground: { r: number; g: number; b: number } }[]>(`(() => {
        const rgb = value => {
          const channels = value.match(/[\\d.]+/g).map(Number);
          return { r: channels[0], g: channels[1], b: channels[2], a: channels[3] ?? 1 };
        };
        const over = (ink, ground) => ({
          r: ink.r * ink.a + ground.r * (1 - ink.a),
          g: ink.g * ink.a + ground.g * (1 - ink.a),
          b: ink.b * ink.a + ground.b * (1 - ink.a), a: 1,
        });
        return [...document.querySelectorAll('.shelf-row[data-selected="true"] .shelf-meta')].map(el => {
          let ground = { r: 255, g: 255, b: 255, a: 1 };
          const chain = [];
          for (let node = el; node; node = node.parentElement) chain.unshift(node);
          for (const node of chain) {
            const css = getComputedStyle(node);
            ground = over(rgb(css.backgroundColor), ground);
            const layers = [...css.backgroundImage.matchAll(/linear-gradient\\((rgba?\\([^)]+\\)),\\s*\\1\\)/g)];
            if (node.matches('.shelf-row')) {
              if (layers.length !== 2) throw new Error('Expected leading mark and full-size wash');
              ground = over(rgb(layers[1][1]), ground);
            } else {
              for (const layer of layers.reverse()) ground = over(rgb(layer[1]), ground);
            }
          }
          return { text: over(rgb(getComputedStyle(el).color), ground), ground };
        });
      })()`);

      expect(metadata.length).toBeGreaterThan(0);

      for (const { text, ground } of metadata) expect(contrastRgb(text, ground), `${tag} selected Pad metadata`).toBeGreaterThanOrEqual(4.5);
      expect(await evaluate<string>("document.querySelector('.shelf-bulk').textContent")).toContain('p'.repeat(120));

      const padChecks = await evaluate<Checks>("window.__checks()");

      for (const id of CHECK_IDS) expect(padChecks[id].status, id).toBe('pass');
      await capture("U460", `${tag}-pads-failure`, await evaluate<Checks>("window.__checks()"));
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
});
