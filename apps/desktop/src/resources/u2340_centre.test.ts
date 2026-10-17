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

type Box = { l: number; r: number; t: number; b: number; w: number; h: number };

const BOXES = `() => {
  const box = selector => { const e = document.querySelector(selector); if (!e) return null; const r = e.getBoundingClientRect(); return {l:r.left,r:r.right,t:r.top,b:r.bottom,w:r.width,h:r.height}; };
  return {centre:box('.centre'), pane:box('.pane'), bar:box('.resource-strip'), row:box('.terminal-tabs-host'), railRow:box('.rail-actions'), text:box('.pane-screen .xterm'),
    barRule:(s => ({h:parseFloat(s.height), colour:s.backgroundColor}))(getComputedStyle(document.querySelector('.resource-strip'), '::after')),
    railRule:(s => ({h:parseFloat(s.borderTopWidth), colour:s.borderTopColor}))(getComputedStyle(document.querySelector('.rail-actions'))), show:box('[aria-label="Show work items"]'), failure:box('.pane-failure'), body:box('.pane-body'),
    space2:parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--space-2')), space4:parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--space-4'))};
}`;

type Rule = { h: number; colour: string };

type Boxes = { centre: Box; pane: Box; bar: Box; row: Box; railRow: Box; text: Box; barRule: Rule; railRule: Rule; show: Box | null; failure: Box; body: Box; space2: number; space4: number };

const open = async (width = 1512): Promise<void> => {
  await page.load("/harness.html?seed=resources", width, 950);
  await page.until(`() => Boolean(window.__fake)`);
  await page.call(`() => { if (!document.querySelector('.content-actions [aria-label="Show work items"]')) document.querySelector('[aria-label="Hide work items"]')?.click(); document.querySelector('[data-id="worktree-agent"]').click(); }`);
  await page.until(`() => document.querySelector('.resource-agent .resource-num') && document.querySelector('[aria-label="Show work items"]')`);
};

const expectBarEdgeToEdgeAndTextInset = async (): Promise<void> => {
  const { centre, pane, bar, text, space2 } = await page.call<Boxes>(BOXES);

  for (const box of [pane, bar]) {
    expect(box.l).toBeCloseTo(centre.l, 0);
    expect(box.w).toBeCloseTo(centre.w, 0);
  }

  expect(text.l).toBeCloseTo(centre.l + space2, 0);
  expect(text.r).toBeLessThanOrEqual(centre.r - space2 + 1);
};

it("u2340a_the_bar_spans_the_centre_and_the_terminal_text_is_inset_one_space", async () => {
  for (const scheme of ["light", "dark"] as const) {
    await page.scheme(scheme);
    await open();
    await expectBarEdgeToEdgeAndTextInset();
  }
}, 120_000);

it("u2340d_the_tab_row_matches_the_rail_row_in_height_and_border", async () => {
  await open();
  const { row, railRow, barRule, railRule } = await page.call<Boxes>(BOXES);

  expect(row.h).toBeCloseTo(railRow.h, 0);
  expect(row.t).toBeCloseTo(railRow.t, 0);
  expect(row.b).toBeCloseTo(railRow.b, 0);
  expect(barRule).toEqual(railRule);
}, 60_000);

it("u2340a_the_show_button_floats_at_the_terminals_corner", async () => {
  await open();
  const { pane, bar, show, space2 } = await page.call<Boxes>(BOXES);

  expect(show).not.toBeNull();
  expect(show!.t).toBeCloseTo(pane.t, 0);
  expect(show!.r).toBeCloseTo(pane.r - space2, 0);
  expect(show!.l).toBeGreaterThanOrEqual(pane.l);
  expect(show!.b).toBeLessThanOrEqual(pane.b);
  expect(Math.abs(pane.r - bar.r)).toBeLessThanOrEqual(1);
  expect(Math.abs(pane.l - bar.l)).toBeLessThanOrEqual(1);
}, 60_000);

it("u2340a_overlay_and_closed_shelf_keep_the_same_alignment", async () => {
  for (const [width, shelf] of [[1512, "closed"], [900, "overlay"]] as const) {
    await open(width);

    if (shelf === "overlay") {
      await page.call(`() => document.querySelector('[aria-label="Show work items"]').click()`);
      await page.until(`() => document.querySelector(".window").dataset.shelf === "open"`);
      expect(await page.call<string>(`() => document.querySelector(".window").dataset.shelfMode`)).toBe("overlay");
    }

    await expectBarEdgeToEdgeAndTextInset();
  }
}, 120_000);

it("u2340b_no_failure_takes_no_height", async () => {
  await open();
  expect((await page.call<Boxes>(BOXES)).failure.h).toBe(0);
}, 60_000);

it("u2340c_the_bar_is_one_line_the_terminals_width", async () => {
  await open();
  const { pane, bar, railRow, space4 } = await page.call<Boxes>(BOXES);

  expect(bar.w).toBeCloseTo(pane.w, 0);
  expect(bar.h).toBeCloseTo(space4 + railRow.h, 0);
}, 60_000);

it("u2340b_a_failure_shortens_the_terminal_and_covers_nothing", async () => {
  await open();
  const before = await page.call<Boxes>(BOXES);
  await page.call(`() => { window.__u2340tree = window.__fake.app.handlers['rail.tree']; }`);
  const text = "daemon is gone ".repeat(40);

  await page.call(`(text) => { window.__fake.app.handlers['rail.tree'] = () => { throw new Error(text); }; window.__fake.emit({actor:{kind:'user',id:'you',parent:null},name:'rail.changed'}); }`, text);
  await page.until(`() => document.querySelector('.pane-failure [role="alert"]')`);

  const during = await page.call<Boxes>(BOXES);
  const lost = before.body.h - during.body.h;

  expect(during.failure.h).toBeGreaterThan(0);
  expect(lost).toBeCloseTo(during.failure.h, 0);
  expect(during.failure.t).toBeGreaterThanOrEqual(during.body.b - 1);
  expect(during.failure.b).toBeLessThanOrEqual(during.bar.t + 1);
  expect(await page.call<string>(`() => document.querySelector('.pane-failure [role="alert"]').textContent`)).toContain("daemon is gone");

  await page.call(`() => { window.__fake.app.handlers['rail.tree'] = window.__u2340tree; window.__fake.emit({actor:{kind:'user',id:'you',parent:null},name:'rail.changed'}); }`);
  await page.until(`() => !document.querySelector('.pane-failure [role="alert"]')`);
  expect((await page.call<Boxes>(BOXES)).body.h).toBeCloseTo(before.body.h, 0);
}, 60_000);

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

  const { pane, bar, railRow, space4 } = await page.call<Boxes>(BOXES);

  const read = await page.call<{ clipped: string[] }>(`() => {
    const bar = document.querySelector('.resource-strip').getBoundingClientRect();
    return {clipped: [...document.querySelectorAll('.resource-value,.resource-stale')].filter(e => { const r = e.getBoundingClientRect(); return r.width === 0 || r.right > bar.right || r.left < bar.left || r.top < bar.top - 1 || r.bottom > bar.bottom + 1; }).map(e => e.textContent)};
  }`);

  expect(bar.w).toBeCloseTo(pane.w, 0);
  expect(bar.h).toBeCloseTo(space4 + railRow.h, 0);
  expect(read.clipped).toEqual([]);

  const checks = await page.call<Record<string, { status: string }>>(`() => window.__checks()`);

  for (const id of ["D2", "D5", "D6"]) expect(checks[id]!.status, id).toBe("pass");
}, 60_000);
