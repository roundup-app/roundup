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
  await page.until(`() => window.__fake.app.shownMenus.length > 0`);
  await page.call(`() => window.__fake.app.pickMenu("Remove")`);
  await page.until(`() => /Unlanded work: Uncommitted changes/.test(window.__question.shown?.message ?? '')`);
};

run("u367 the confirm", () => {
  vi.setConfig({ testTimeout: 60_000 });

  it("u367_a_failed_removal_keeps_the_row_and_shows_the_message_on_the_densest_seed", async () => {
    await openConfirm();
    await page.call(`() => { window.__fake.app.handlers['rail.remove'] = () => { throw new Error('removal failed; work kept'); }; }`);

    await page.call(`() => window.__question.answer(true)`);
    await page.until(`() => document.querySelector('[role=alert]')?.textContent.includes('removal failed; work kept')`);
    expect(await page.call<boolean>(`() => Boolean(document.querySelector('.rail-row[data-id="backend"]'))`)).toBe(true);
  });
});
