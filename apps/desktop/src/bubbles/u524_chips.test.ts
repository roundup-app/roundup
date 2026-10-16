import { afterAll, beforeAll, expect, it } from "vitest";
import { chromePath, openPage } from "../testing/chromePage";
import type { ChromePage } from "../testing/chromePage";
type Box = { l: number; r: number; t: number; b: number };
let page: ChromePage;
beforeAll(async () => { page = await openPage(chromePath()!); }, 90_000);
afterAll(async () => { await page?.close(); });
it("u524_eight_run_chips_scroll_inside_the_strip_clear_of_the_readout", async () => {
  for (const width of [1280, 1440]) {
    await page.load('/harness.html?seed=bubbles', width, 800);
    await page.until(`() => Boolean(window.__fake)`);
    await page.call(`() => document.querySelector('[data-id="runner"]').click()`);
    await page.until(`() => document.querySelector('.terminal-tabs')`);
    await page.call(`() => { window.__fake.app.handlers['terminal.list'] = () => Array.from({length:8}, (_, i) => ({id:String(300+i),owner:'runner',title:'run '+(i+1),program:'zsh',running:true,exit_code:null,cwd:'/p'})); window.__fake.emit({actor:{kind:'user',id:'you',parent:null},name:'terminal.changed'}); }`);
    await page.until(`() => document.querySelectorAll('.terminal-tab').length >= 8`);
    const r = await page.call<{ tabs: Box; host: Box; res: Box; reach: boolean }>(`() => {
      const box = (s) => { const r = document.querySelector(s).getBoundingClientRect(); return { l: r.x, r: r.right, t: r.y, b: r.bottom }; };
      const tabs = document.querySelector('.terminal-tabs');
      const last = [...tabs.querySelectorAll('.terminal-tab')].at(-1);
      last.scrollIntoView({ inline: 'nearest' });
      const l = last.getBoundingClientRect(), t = tabs.getBoundingClientRect();
      return { tabs: box('.terminal-tabs'), host: box('.terminal-tabs-host'), res: box('.resource-agent'), reach: l.left >= t.left - 1 && l.right <= t.right + 1 };
    }`);
    const { tabs, res } = r;

    expect(r.reach, `${width} last chip scrolls into the strip`).toBe(true);
    expect(tabs.r - tabs.l, `${width} the strip is wide enough to read a chip`).toBeGreaterThanOrEqual(120);
    expect(tabs.r <= res.l || tabs.b <= res.t || res.b <= tabs.t || res.r <= tabs.l, `${width} chips keep clear of the readout`).toBe(true);
  }
}, 120_000);
