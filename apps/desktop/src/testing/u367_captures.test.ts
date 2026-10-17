import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { chromePath, openPage } from "./chromePage";
import type { ChromePage } from "./chromePage";

/** U367's rendered observer: the Workstream confirm on the densest seed, with a running, an ahead and a dirty Agent, in Chromium. */

const found = chromePath();

const run = found || process.env["CI"] ? describe : describe.skip;

let page: ChromePage;

beforeAll(async () => {
  if (!found) throw new Error("U367 needs a Chrome binary: set CHROME_PATH");

  page = await openPage(found);
}, 90_000);

afterAll(async () => {
  await page?.close();
});

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
  });
});
