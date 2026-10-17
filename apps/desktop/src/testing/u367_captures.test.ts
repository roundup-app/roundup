import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { chromePath, openPage } from "./chromePage";
import type { ChromePage } from "./chromePage";
import { captureDir } from "./captures";
import type { Checks } from "./checks";

/** U367's rendered observer: the Workstream confirm on the densest seed, with a running, an ahead and a dirty Agent, in Chromium at 1280×800 and 1440×800. */

const found = chromePath();

const run = found || process.env["CI"] ? describe : describe.skip;

let page: ChromePage;

const ART = captureDir("U367");

beforeAll(async () => {
  if (!found) throw new Error("U367 needs a Chrome binary: set CHROME_PATH");

  page = await openPage(found);
}, 90_000);

afterAll(async () => {
  await page?.close();
});

const save = async (name: string) => {
  if (!ART) return;
  mkdirSync(ART, { recursive: true });
  writeFileSync(join(ART, `${name}.png`), Buffer.from(await page.shot(), "base64"));
  writeFileSync(join(ART, `${name}.checks.json`), JSON.stringify(await page.call(`() => window.__checks()`), null, 2));
};

const openConfirm = async () => {
  await page.load("/harness.html?seed=tree-40", 1280, 800);
  await page.until(`() => Boolean(window.__fake) && document.querySelector('.rail-row[data-id="backend"]') !== null`);

  // `logins` (error) holds uncommitted changes and `docs` (done) a commit the Base lacks; `tokens` and `migrate` still run.
  await page.call(`async () => {
    const { app } = window.__fake;
    const tree = app.handlers["rail.tree"];
    const worktree = (id) => ({ path: "/work/" + id, branch: "roundup/" + id });
    app.handlers["rail.tree"] = async (args) => (await tree(args)).map((node) => (node.id === "logins" || node.id === "docs" ? { ...node, worktree: worktree(node.id) } : node));
    app.handlers["agent.worktreeState"] = ({ id }) => ({ dirty: id === "logins", ahead: id === "docs" ? 2 : 0 });
    window.__fake.emit({ actor: { kind: "user", id: "you", parent: null }, name: "rail.changed" });
  }`);
  // rail.changed refreshes the Rail; its Worktree nodes must arrive before opening the menu.
  await page.until(`() => window.__fake.app.calls.filter(call => call.method === "rail.tree").length >= 2`);
  await page.call(`() => {
    document.querySelector('.rail-row[data-id="backend"]').dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 120, clientY: 80 }));
  }`);
  await page.until(`() => [...document.querySelectorAll('[role="menuitem"]')].some((each) => each.textContent.trim() === "Remove")`);
  await page.call(`() => [...document.querySelectorAll('[role="menuitem"]')].find((each) => each.textContent.trim() === "Remove").click()`);
  await page.until(`() => /Unlanded work: Uncommitted changes/.test(document.body.textContent)`);
};

run("u367 the confirm", () => {
  vi.setConfig({ testTimeout: 60_000 });

  it("u367_the_confirm_on_the_densest_seed_names_a_running_an_ahead_and_a_dirty_agent", async () => {
    await openConfirm();
    const text = await page.call<string>(`() => document.body.textContent`);

    expect(text).toMatch(/Stays at the Project root/);
    expect(text).toMatch(/Running/);
    expect(text).toMatch(/Unlanded work: 2 ahead/);

    for (const [width, height] of [[1280, 800], [1440, 800]] as const) {
      await page.resize(width, height);
      await page.until(`() => document.getAnimations().every(animation => animation.playState !== 'running' || animation.effect.getTiming().iterations === Infinity)`);
      const checks = await page.call<Checks>(`() => window.__checks()`);

      for (const id of ["D1", "D2", "D5", "D6", "D8"] as const) expect(checks[id].status, `${width}: ${id}`).toBe("pass");

      expect(await page.call<boolean>(`() => {
        const reasons = [...document.querySelectorAll('.rail-menu-name')].filter(line => line.textContent.includes('Unlanded work:'));
        return reasons.length === 2 && reasons.every(line => line.scrollWidth <= line.clientWidth);
      }`)).toBe(true);

      // The resize edge must not intercept the confirm's buttons or lines.
      expect(await page.call<boolean>(`() => {
        const menu = document.querySelector(".rail-menu");
        const edge = document.querySelector(".rail-edge").getBoundingClientRect();
        const box = menu.getBoundingClientRect();
        for (let y = box.top + 4; y < box.bottom - 4; y += 4) {
          if (!menu.contains(document.elementFromPoint(edge.left + 4, y))) return false;
        }
        return menu.contains(document.elementFromPoint(box.right - 20, box.top + 30));
      }`)).toBe(true);
      await save(`confirm-${width}x${height}`);
    }
  });

  it("u367_remove_across_the_rail_resize_edge_calls_once", async () => {
    await openConfirm();

    const point = await page.call<{ x: number; y: number }>(`() => {
      const edge = document.querySelector(".rail-edge").getBoundingClientRect();
      const button = [...document.querySelectorAll('.rail-menu button')].find(button => button.textContent === 'Remove').getBoundingClientRect();
      return { x: edge.left + 4, y: (button.top + button.bottom) / 2 };
    }`);

    await page.click(point.x, point.y);
    await page.until(`() => !document.querySelector('.rail-menu') && !document.querySelector('.rail-row[data-id="backend"]')`);
    expect(await page.call<number>(`() => window.__fake.app.calls.filter(call => call.method === 'rail.remove' && call.params.id === 'backend').length`)).toBe(1);
  });

  it("u367_a_failed_removal_keeps_the_row_and_shows_the_message_on_the_densest_seed", async () => {
    await openConfirm();
    await page.call(`() => { window.__fake.app.handlers['rail.remove'] = () => { throw new Error('removal failed; work kept'); }; }`);

    const point = await page.call<{ x: number; y: number }>(`() => {
      const button = [...document.querySelectorAll('.rail-menu button')].find(button => button.textContent === 'Remove').getBoundingClientRect();
      return { x: (button.left + button.right) / 2, y: (button.top + button.bottom) / 2 };
    }`);

    await page.click(point.x, point.y);
    await page.until(`() => document.querySelector('[role=alert]')?.textContent.includes('removal failed; work kept')`);
    expect(await page.call<boolean>(`() => Boolean(document.querySelector('.rail-row[data-id="backend"]'))`)).toBe(true);
    const checks = await page.call<Checks>(`() => window.__checks()`);

    for (const id of ["D1", "D2", "D5", "D6", "D8"] as const) expect(checks[id].status, id).toBe("pass");
    await save('failure-1280x800');
  });
});
