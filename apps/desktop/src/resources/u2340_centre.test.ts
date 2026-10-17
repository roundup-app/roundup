import { afterAll, beforeAll, expect, it } from "vitest";
import { chromePath, openPage } from "../testing/chromePage";
import type { ChromePage } from "../testing/chromePage";

let page: ChromePage;

beforeAll(async () => {
  const chrome = chromePath();

  if (!chrome) throw new Error("U2340 requires Chromium");
  page = await openPage(chrome);
}, 90_000);

afterAll(async () => { await page?.close(); });

const open = async (width = 1512): Promise<void> => {
  await page.load("/harness.html?seed=resources", width, 950);
  await page.until(`() => Boolean(window.__fake)`);
  await page.call(`() => { if (!document.querySelector('.content-actions [aria-label="Show work items"]')) document.querySelector('[aria-label="Hide work items"]')?.click(); document.querySelector('[data-id="worktree-agent"]').click(); }`);
  await page.until(`() => document.querySelector('.resource-agent .resource-num') && document.querySelector('[aria-label="Show work items"]')`);
};

it("u2340a_checks_hold_on_the_densest_seed", async () => {
  await open();
  await page.call(`() => {
    const app = window.__fake.app;
    app.handlers['terminal.list'] = () => Array.from({length:16}, (_, i) => ({id:String(200+i),owner:'worktree-agent',title:'A'.repeat(60),program:'zsh',running:true,exit_code:null,cwd:'/p'}));
    window.__fake.emit({actor:{kind:'user',id:'you',parent:null},name:'terminal.changed'});
    app.handlers['project.resources'] = () => { throw new Error('not updating'); };
    app.handlers['rail.tree'] = () => { throw new Error('daemon is gone'); };
    window.__fake.emit({actor:{kind:'user',id:'you',parent:null},name:'rail.changed'});
  }`);
  await page.until(`() => document.querySelectorAll('.terminal-tab').length === 16 && document.querySelector('.resource-stale') && document.querySelector('.pane-failure [role="alert"]')`);

  const checks = await page.call<Record<string, { status: string }>>(`() => window.__checks()`);

  for (const id of ["D2", "D5", "D6"]) expect(checks[id]!.status, id).toBe("pass");
}, 60_000);
