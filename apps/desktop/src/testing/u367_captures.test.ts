import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { chromePath, openPage } from "./chromePage";
import type { ChromePage } from "./chromePage";

/** U367's rendered observer: the Workstream confirm on the densest seed, with a running, an ahead and a dirty Agent, in Chromium at 1280×800 and 700×800. */

const found = chromePath();

const run = found || process.env["CI"] ? describe : describe.skip;

let page: ChromePage;

const ART = resolve(process.cwd(), "../../artifacts/ux/U367");

beforeAll(async () => {
  if (!found) throw new Error("U367 needs a Chrome binary: set CHROME_PATH");

  page = await openPage(found);
}, 90_000);

afterAll(async () => {
  await page?.close();
});

const save = async (name: string) => {
  mkdirSync(ART, { recursive: true });
  writeFileSync(join(ART, `${name}.png`), Buffer.from(await page.shot(), "base64"));
  writeFileSync(join(ART, `${name}.checks.json`), JSON.stringify(await page.call(`() => window.__checks()`), null, 2));
};

run("u367 the confirm", () => {
  vi.setConfig({ testTimeout: 60_000 });

  it("u367_the_confirm_on_the_densest_seed_names_a_running_an_ahead_and_a_dirty_agent", async () => {
    await page.load("/harness.html?seed=tree-40", 1280, 800);
    await page.until(`() => Boolean(window.__fake) && document.querySelector('[data-id="backend"]') !== null`);

    // `logins` (error) holds uncommitted changes and `docs` (done) a commit the Base lacks; `tokens` and `migrate` still run.
    await page.call(`async () => {
      const { app } = window.__fake;
      const tree = app.handlers["rail.tree"];
      const worktree = (id) => ({ path: "/work/" + id, branch: "roundup/" + id });
      app.handlers["rail.tree"] = async (args) => (await tree(args)).map((node) => (node.id === "logins" || node.id === "docs" ? { ...node, worktree: worktree(node.id) } : node));
      app.handlers["agent.worktreeState"] = ({ id }) => ({ dirty: id === "logins", ahead: id === "docs" ? 2 : 0 });
      window.__fake.emit({ actor: { kind: "user", id: "you", parent: null }, name: "rail.changed" });
      await new Promise((done) => setTimeout(done, 200));
      document.querySelector('[data-id="backend"]').dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 120, clientY: 80 }));
    }`);
    await page.until(`() => [...document.querySelectorAll('[role="menuitem"]')].some((each) => each.textContent.trim() === "remove")`);
    await page.call(`() => [...document.querySelectorAll('[role="menuitem"]')].find((each) => each.textContent.trim() === "remove").click()`);
    await page.until(`() => /unlanded work: uncommitted changes/.test(document.body.textContent)`);

    const text = await page.call<string>(`() => document.body.textContent`);

    expect(text).toMatch(/stays at the project root/);
    expect(text).toMatch(/running/);
    expect(text).toMatch(/unlanded work: 2 ahead/);

    // The Rail edge lies under the confirm: the point at the edge's x inside the menu hits the menu.
    expect(await page.call<boolean>(`() => { const menu = document.querySelector(".rail-menu"); const edge = document.querySelector(".rail-edge").getBoundingClientRect(); const box = menu.getBoundingClientRect(); return menu.contains(document.elementFromPoint(edge.left + 4, box.top + 30)); }`)).toBe(true);

    // The confirm is wider than the Rail and must paint over the pane: the point at its right edge hits the menu.
    expect(await page.call<boolean>(`() => { const menu = document.querySelector(".rail-menu"); const box = menu.getBoundingClientRect(); return menu.contains(document.elementFromPoint(box.right - 20, box.top + 30)); }`)).toBe(true);

    for (const [width, height] of [[1280, 800], [700, 800]] as const) {
      await page.resize(width, height);
      await save(`confirm-${width}x${height}`);
    }
  });
});
