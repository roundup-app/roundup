import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { chromePath, openPage } from "../testing/chromePage";
import type { ChromePage } from "../testing/chromePage";
import { captureDir } from "../testing/captures";

let page: ChromePage;

beforeAll(async () => {
  const chrome = chromePath();

  if (!chrome) throw new Error("U426 requires isolated Chromium");
  page = await openPage(chrome);
}, 90_000);

afterAll(async () => { await page?.close(); });

const load = async (seed: string, width: number, scheme: "light" | "dark", base = false) => {
  await page.scheme(scheme);
  const path = `/harness.html?seed=${seed}`;
  await page.load(base ? `${process.env.ROUNDUP_RAIL_BASELINE}${path}` : path, width, 800);
  await page.until(`() => document.querySelectorAll('.rail-row').length >= 9 && typeof window.__checks === 'function'`, 60_000);
};

const capture = async (id: string, name: string) => {
  const dir = captureDir(id);

  if (!dir) return;
  mkdirSync(join(dir, name.includes('/') ? name.split('/')[0]! : '.'), { recursive: true });
  writeFileSync(join(dir, `${name}.png`), Buffer.from(await page.shot(), "base64"));
  writeFileSync(join(dir, `${name}.checks.json`), JSON.stringify(await page.call(`() => window.__checks()`)) + "\n");
};

const geometry = `() => [...document.querySelectorAll('.rail-row')].map(r => { const b=r.getBoundingClientRect(); return [r.dataset.id,b.top,b.height]; })`;

type Checks = Record<string, { status: string }>;

for (const seed of ["agents-10", "tree-40"]) {
  for (const width of [1280, 700]) {
    for (const scheme of ["light", "dark"] as const) {
      it(`u426_showing_the_icons_moves_no_row ${seed} ${width} ${scheme}`, async () => {
        const label = `${seed}-${width}x800-${scheme}`;
        let baseline: Checks | null = null;

        if (process.env.ROUNDUP_RAIL_BASELINE) {
          await load(seed, width, scheme, true);
          await page.hover(600, 10);
          baseline = await page.call<Checks>(`() => window.__checks()`);
          await capture("U426", `base/${label}-hidden`);
          const basePoint = await page.call<{ x: number; y: number }>(`() => { const b=document.querySelector('.rail-row').getBoundingClientRect(); return {x:b.left+10,y:b.top+10}; }`);

          await page.hover(basePoint.x, basePoint.y);
          await page.until(`() => document.querySelector('.rail-row').matches(':hover')`);
          await capture("U426", `base/${label}-shown`);
        }

        await load(seed, width, scheme);
        await page.hover(600, 10);
        const before = await page.call(geometry);
        await capture("U426", `head/${label}-hidden`);
        const point = await page.call<{ x: number; y: number }>(`() => { const b=document.querySelector('.rail-row').getBoundingClientRect(); return {x:b.left+10,y:b.top+10}; }`);
        await page.hover(point.x, point.y);
        await page.until(`() => getComputedStyle(document.querySelector('.row-icons')).opacity === '1'`);
        expect(await page.call(geometry)).toEqual(before);
        const checks = await page.call<Checks>(`() => window.__checks()`);

        if (baseline) {
          for (const [id, check] of Object.entries(baseline)) {
            if (check.status === "pass") expect(checks[id]?.status, `${label} ${id}`).toBe("pass");
          }
        }

        await capture("U426", `head/${label}-shown`);
        await capture("U427", `${label}-workstream`);
        const agentPoint = await page.call<{ x: number; y: number }>(`() => { const r=[...document.querySelectorAll('.rail-row')].find(r=>r.querySelector('[aria-label="Stop"]')); const b=r.getBoundingClientRect(); return {x:b.left+10,y:b.top+10}; }`);
        await page.hover(agentPoint.x, agentPoint.y);
        await page.until(`() => [...document.querySelectorAll('.rail-row')].some(r=>r.querySelector('[aria-label="Stop"]') && r.dataset.near === 'true')`);
        expect(await page.call(geometry)).toEqual(before);
        await capture("U428", `${label}-agent`);
      }, 90_000);
    }
  }
}

it("u426_a_long_name_never_wraps_beside_the_icons", async () => {
  await load("tree-40", 1280, "light");
  await page.call(`() => { const row=document.querySelector('.rail-row'); document.querySelector('.rail').style.width='163px'; row.querySelector('.name').textContent='x'.repeat(60); row.focus(); }`);
  await page.until(`() => document.querySelector('.rail-row').dataset.near === 'true'`);

  const read = await page.call<{ nameWidth: number; clipped: boolean; endsBefore: boolean; height: number; fits: boolean; overflow: string; whiteSpace: string }>(`() => {
    const row=document.querySelector('.rail-row'), name=row.querySelector('.name'), icons=row.querySelector('.row-icons');
    const n=name.getBoundingClientRect(), i=icons.getBoundingClientRect(), s=getComputedStyle(name);
    return {nameWidth:n.width,clipped:name.scrollWidth>name.clientWidth,endsBefore:n.right<=i.left,height:row.getBoundingClientRect().height,fits:i.right<=row.getBoundingClientRect().right,overflow:s.textOverflow,whiteSpace:s.whiteSpace};
  }`);

  expect(read.nameWidth).toBeGreaterThanOrEqual(16);
  expect(read.fits).toBe(true);
  expect([read.clipped, read.endsBefore, read.height, read.overflow, read.whiteSpace]).toEqual([true, true, 28, "ellipsis", "pre"]);
  await capture("U426", "long-name-163");
}, 60_000);

it("u426_every_icon_is_reached_by_tab_and_enter_or_space_runs_without_selecting", async () => {
  await load("tree-40", 1280, "light");
  await page.call(`() => document.querySelector('.rail-row').focus()`);
  await page.press("Tab", "Tab");
  await page.until(`() => document.activeElement.getAttribute('aria-label') === 'Collapse'`);
  // The stopped Door's existing Start Door action precedes the new icons.
  await page.press("Tab", "Tab");
  await page.until(`() => document.activeElement.title === 'Start Door'`);

  const labels = ["Add Agent", "Clear", "Open folder", "Open in editor"];

  for (const label of labels) {
    await page.press("Tab", "Tab");
    await page.until(`() => document.activeElement.getAttribute('aria-label') === ${JSON.stringify(label)}`);
  }

  const selected = await page.call(`() => document.querySelector('.rail-row[data-selected="true"]')?.dataset.id ?? null`);
  await page.press("Enter", "Enter");
  await page.until(`() => window.__fake.app.editorOpened.length === 1`);
  expect(await page.call(`() => document.querySelector('.rail-row[data-selected="true"]')?.dataset.id ?? null`)).toBe(selected);
  await page.call(`() => document.querySelector('.rail-row [aria-label="Open folder"]').focus()`);
  await page.press(" ", "Space");
  await page.until(`() => window.__fake.app.openedTargets.length === 1`);
  expect(await page.call(`() => document.querySelector('.rail-row[data-selected="true"]')?.dataset.id ?? null`)).toBe(selected);
}, 60_000);

it("u427_the_clear_icon_opens_a_visible_reason_prompt_without_selecting", async () => {
  await load("tree-40", 1280, "light");
  await page.call(`() => document.querySelector('[data-id="backend"]').click()`);
  await page.until(`() => document.querySelector('[data-id="backend"]').dataset.selected === 'true'`);
  await page.call(`() => document.querySelector('[data-id="auth"] [aria-label="Clear"]').click()`);
  await page.until(`() => Boolean(document.querySelector('[role="dialog"] [data-clear-prompt] textarea'))`);
  expect(await page.call(`() => document.querySelector('.rail-row[data-selected="true"]').dataset.id`)).toBe("backend");
  expect(await page.call(`() => document.activeElement === document.querySelector('[role="dialog"] textarea')`)).toBe(true);
  expect(await page.call(`() => {
    const dialog=document.querySelector('[role="dialog"]'), box=dialog.getBoundingClientRect();
    return box.left>=0 && box.right<=innerWidth && box.top>=0 && box.bottom<=innerHeight && document.elementFromPoint(box.left+box.width/2,box.top+box.height/2)?.closest('[role="dialog"]')===dialog;
  }`)).toBe(true);
  expect(await page.call(`() => window.__fake.app.calls.filter(c=>c.method==='workstream.clear').length`)).toBe(0);
  await capture("U427", "unselected-workstream-reason");
  await page.call(`() => [...document.querySelectorAll('[role="dialog"] button')].find(b=>b.textContent.trim()==='keep').click()`);
  await page.until(`() => !document.querySelector('[role="dialog"] [data-clear-prompt]')`);
}, 60_000);

it("u429_the_rail_shows_a_missing_editor_in_one_failure_line", async () => {
  await load("tree-40", 1280, "light");
  await page.call(`() => {
    window.__fake.app.editorFailure = new Error('no code editor found; install VS Code or Cursor, or set ROUNDUP_EDITOR');
    document.querySelector('.rail-row [aria-label="Open in editor"]').click();
  }`);
  await page.until(`() => document.querySelector('.rail > .ink')?.textContent.includes('no code editor found')`);
  expect(await page.call(`() => document.querySelectorAll('.rail > .ink').length`)).toBe(1);
  await capture("U429", "missing-editor");
}, 60_000);

it("u426_only_workstream_and_agent_rows_carry_icons", async () => {
  await load("tree-40", 1280, "dark");
  await page.call(`() => document.querySelector('.rail-pads-control').click()`);
  await page.until(`() => document.querySelectorAll('.rail-leaf').length > 0`);

  const read = await page.call<{projectTabs:number; leaves:number; rowGroups:number[]; otherGroups:number}>(`() => ({
    projectTabs:document.querySelectorAll('.project-tab').length,
    leaves:document.querySelectorAll('.rail-leaf').length,
    rowGroups:[...document.querySelectorAll('.rail-row')].map(r=>r.querySelectorAll('.row-icons').length),
    otherGroups:document.querySelectorAll('.project-tab .row-icons, .rail-leaf .row-icons, .rail-fold .row-icons').length
  })`);

  expect(read.projectTabs).toBeGreaterThan(0);
  expect(read.leaves).toBeGreaterThan(0);
  expect(read.rowGroups.every(count=>count===1)).toBe(true);
  expect(read.otherGroups).toBe(0);
}, 60_000);
