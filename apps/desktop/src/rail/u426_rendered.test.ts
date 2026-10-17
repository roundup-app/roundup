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

const geometry = `() => [...document.querySelectorAll('.rail-row')].map(r => { const b=r.getBoundingClientRect(); return [r.dataset.id,b.top,b.height,r.querySelector(".name").getBoundingClientRect().left]; })`;

type Checks = Record<string, { status: string }>;

// Row geometry does not change with scheme; the Check comparison reads dark once, on tree-40.
for (const [seed, scheme] of [["agents-10", "light"], ["tree-40", "light"], ["tree-40", "dark"]] as const) {
  const width = 1280;

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
  expect([read.clipped, read.endsBefore, read.height, read.overflow, read.whiteSpace]).toEqual([true, true, 32, "ellipsis", "pre"]);
  const checks = await page.call<Checks>(`() => window.__checks()`);

  for (const id of ["D1", "D2", "D5", "D6"]) expect(checks[id]?.status, id).toBe("pass");
  await capture("U426", "long-name-163");
}, 60_000);

// Tab and Enter or Space reach the same icons at any Rail width; the default width stands for the rest.
for (const railWidth of [288]) {
  it(`u426_every_icon_is_reached_by_tab_and_enter_or_space_runs_without_selecting ${railWidth}`, async () => {
    await load("tree-40", 1280, "light");
    await page.call(`width => { document.querySelector('.rail').style.width=width+'px'; document.querySelector('.rail-row').focus(); }`, railWidth);
    await page.press("Tab", "Tab");
    await page.until(`() => document.activeElement.getAttribute('aria-label') === 'Collapse'`);
    const labels = ["Add Agent", "Start supervisor", "Clear", "Open folder", "Open in editor"];

    for (const label of labels) {
      await page.press("Tab", "Tab");
      await page.until(`() => document.activeElement.getAttribute('aria-label')?.startsWith(${JSON.stringify(label)})`);
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
}

it("u427_the_clear_icon_opens_a_visible_reason_prompt_without_selecting", async () => {
  await load("tree-40", 1280, "light");
  await page.call(`() => document.querySelector('.rail-row[data-id="backend"]').click()`);
  await page.until(`() => document.querySelector('.rail-row[data-id="backend"]').dataset.selected === 'true'`);
  await page.call(`() => document.querySelector('.rail-row[data-id="auth"] [aria-label^="Clear"]').click()`);
  await page.until(`() => Boolean(document.querySelector('[role="dialog"] [data-clear-prompt] textarea'))`);
  expect(await page.call(`() => document.querySelector('.rail-row[data-selected="true"]').dataset.id`)).toBe("backend");
  expect(await page.call(`() => document.activeElement === document.querySelector('[role="dialog"] textarea')`)).toBe(true);
  expect(await page.call(`() => {
    const dialog=document.querySelector('[role="dialog"]'), box=dialog.getBoundingClientRect();
    return box.left>=0 && box.right<=innerWidth && box.top>=0 && box.bottom<=innerHeight && document.elementFromPoint(box.left+box.width/2,box.top+box.height/2)?.closest('[role="dialog"]')===dialog;
  }`)).toBe(true);
  expect(await page.call(`() => {
    const row=document.querySelector('.rail-row[data-id="auth"]').getBoundingClientRect();
    const prompt=document.querySelector('[role="dialog"]').getBoundingClientRect();
    return Math.abs(prompt.left-row.left)<=16 && Math.abs(prompt.top-row.bottom)<=1;
  }`)).toBe(true);
  expect(await page.call(`() => window.__fake.app.calls.filter(c=>c.method==='workstream.clear').length`)).toBe(0);
  const checks = await page.call<Checks>(`() => window.__checks()`);

  for (const id of ["D1", "D2", "D5", "D6", "D8"]) expect(checks[id]?.status, id).toBe("pass");
  await capture("U427", "unselected-workstream-reason");
  await page.resize(1280, 260);
  await page.until(`() => {
    const box=document.querySelector('[role="dialog"]').getBoundingClientRect();
    return box.left>=0 && box.right<=innerWidth && box.top>=0 && box.bottom<=innerHeight;
  }`);
  await capture("U427", "unselected-workstream-reason-clamped");
  await page.resize(1280, 800);
  await page.until(`() => {
    const row=document.querySelector('.rail-row[data-id="auth"]').getBoundingClientRect();
    return Math.abs(document.querySelector('[role="dialog"]').getBoundingClientRect().top-row.bottom)<=1;
  }`);
  await page.call(`() => [...document.querySelectorAll('[role="dialog"] button')].find(b=>b.textContent.trim()==='Keep').click()`);
  await page.until(`() => !document.querySelector('[role="dialog"] [data-clear-prompt]')`);
}, 60_000);

for (const scheme of ["light", "dark"] as const) {
  it(`u427_clear_flips_above_its_row_near_the_viewport_bottom ${scheme}`, async () => {
    await load("tree-40", 1440, scheme);
    await page.resize(1440, 400);
    await page.call(`() => document.querySelector('.rail-row[data-id="payments"] [aria-label^="Clear"]').click()`);
    await page.until(`() => {
      const row=document.querySelector('.rail-row[data-id="payments"]').getBoundingClientRect();
      const prompt=document.querySelector('.rail-clear')?.getBoundingClientRect();
      return prompt && Math.abs(prompt.bottom-row.top)<=1;
    }`);
    expect(await page.call(`() => {
      const box=document.querySelector('.rail-clear').getBoundingClientRect();
      return box.left>=0 && box.right<=innerWidth && box.top>=0 && box.bottom<=innerHeight;
    }`)).toBe(true);
    const checks = await page.call<Checks>(`() => window.__checks()`);

    for (const id of ["D1", "D2", "D5", "D6", "D8"]) expect(checks[id]?.status, id).toBe("pass");
    await capture("U427", `clear-flipped-${scheme}`);
  }, 60_000);
}

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

// The Door control's box, label and icon do not change with scheme.
for (const scheme of ["light"] as const) {
  for (const railWidth of [288, 252]) {
    it(`u426_the_stopped_door_keeps_a_readable_control_beside_the_group ${scheme} ${railWidth}`, async () => {
      if (process.env.ROUNDUP_RAIL_BASELINE) {
        await load("tree-40", 1280, scheme, true);
        await page.call(`() => { document.querySelector(".rail").style.width="${railWidth}px"; document.querySelector('.rail-row[data-id="auth"]').focus(); }`);
        await capture("U426", `base/auth-focused-${scheme}${railWidth === 288 ? "-default" : ""}`);
      }

      await load("tree-40", 1280, scheme);
      await page.call(`() => { document.querySelector(".rail").style.width="${railWidth}px"; document.querySelector('.rail-row[data-id="auth"]').focus(); }`);
      await page.until(`() => document.querySelector('.rail-row[data-id="auth"]').dataset.near === 'true'`);

      const read = await page.call<{width:number; height:number; nameWidth:number; fits:boolean; label:string}>(`() => {
        const row=document.querySelector('.rail-row[data-id="auth"]'), button=row.querySelector('.door-action');
        const b=button.getBoundingClientRect(), n=row.querySelector('.name').getBoundingClientRect(), icons=row.querySelector('.row-icons').getBoundingClientRect();
        return {width:b.width,height:b.height,nameWidth:n.width,fits:n.right<=b.left && b.left>=icons.left && b.right<=icons.right && icons.right<=row.getBoundingClientRect().right,label:button.getAttribute('aria-label')};
      }`);

      expect(read.width).toBe(24);
      expect(read.height).toBeGreaterThanOrEqual(24);
      expect(read.nameWidth).toBeGreaterThanOrEqual(16);
      expect(read.fits).toBe(true);
      expect(read.label).toBe("Start supervisor");
      expect(await page.call(`() => Boolean(document.querySelector('.rail-row[data-id="auth"] .door-action svg.lucide-play'))`)).toBe(true);
      await capture("U426", `head/auth-focused-${scheme}${railWidth === 288 ? "-default" : ""}`);
    }, 60_000);
  }
}

// The group's box does not change with scheme; the Check comparison reads dark once, selected.
for (const [scheme, states] of [["light", ["hovered", "selected"]], ["dark", ["selected"]]] as const) {
  for (const state of states) {
    it(`u426_agent_actions_replace_the_pads_count_at_the_right_edge ${state} ${scheme}`, async () => {
      await load("tree-40", 1280, scheme);
      await page.hover(600, 10);
      await page.call(`() => document.querySelector('.rail-row[data-id="backend"]').click()`);
      await page.until(`() => document.querySelector('.rail-row[data-id="tokens"]').dataset.near === 'false' && document.querySelector('.rail-row[data-id="tokens"] .rail-pads-control')?.getBoundingClientRect().width > 0`);
      expect(await page.call(`() => document.querySelector('.rail-row[data-id="tokens"] .rail-pads-control').getBoundingClientRect().width`)).toBeGreaterThan(0);

      const before = await page.call<Checks>(`() => window.__checks()`);
      const point = await page.call<{x:number; y:number}>(`() => { const r=document.querySelector('.rail-row[data-id="tokens"]'), b=r.getBoundingClientRect(); return {x:b.left+10,y:b.top+10}; }`);

      if (state === "selected") await page.call(`() => document.querySelector('.rail-row[data-id="tokens"]').click()`);
      else await page.hover(point.x, point.y);
      await page.until(`() => document.querySelector('.rail-row[data-id="tokens"]').dataset.near === 'true'`);

      const read = await page.call<{nameWidth:number; edge:number; overlaps:boolean; padsShown:boolean; ellipsis:string}>(`() => {
        const r=document.querySelector('.rail-row[data-id="tokens"]'), n=r.querySelector('.name').getBoundingClientRect(), i=r.querySelector('.row-icons').getBoundingClientRect();
        return {ellipsis:getComputedStyle(r.querySelector(".name")).textOverflow,nameWidth:n.width,edge:r.getBoundingClientRect().right-i.right,overlaps:n.right>i.left,padsShown:r.querySelector('.rail-pads-control').getBoundingClientRect().width>0};
      }`);

      expect(read.nameWidth).toBeGreaterThanOrEqual(72);
      expect(read.ellipsis).toBe("ellipsis");
      expect(read.edge).toBeCloseTo(16, 0);
      expect(read.overlaps).toBe(false);
      expect(read.padsShown).toBe(false);
      const after = await page.call<Checks>(`() => window.__checks()`);

      for (const [id, check] of Object.entries(before)) {
        if (check.status === "pass") expect(after[id]?.status, id).toBe("pass");
      }

      await capture("U426", `tokens-${state}-${scheme}-1280`);
    }, 60_000);
  }
}

// Count insets do not change with scheme.
for (const scheme of ["light"] as const) {
  for (const railWidth of [288, 252]) {
    it(`u426_resting_counts_align_with_the_icon_marks ${scheme} ${railWidth}`, async () => {
      await load("tree-40", 1280, scheme);
      await page.hover(600, 10);
      await page.call(`() => { document.querySelector('.rail').style.width='${railWidth}px'; if (document.querySelector('[data-id="payments"]').getAttribute('aria-expanded') === 'true') document.querySelector('[data-id="payments"] .rail-chevron').click(); }`);
      await page.until(`() => document.querySelector('[data-id="payments"]').getAttribute('aria-expanded') === 'false'`);
      await page.call(`() => document.querySelector('.rail-row[data-id="auth"]').click()`);
      await page.until(`() => document.querySelector('.rail-row[data-id="tokens"]').dataset.near === 'false' && document.querySelector('.rail-row[data-id="payments"] .folded-agents')?.getBoundingClientRect().width > 0`);
      const insets = await page.call<number[]>(`() => [...document.querySelectorAll('.rail-row .rail-pads-control')].filter(e => e.getBoundingClientRect().width > 0).flatMap(e => { const edge=e.closest('.rail-row').getBoundingClientRect().right, text=document.createRange(); text.selectNodeContents(e.lastChild); return [edge-e.getBoundingClientRect().right, edge-text.getBoundingClientRect().right]; })`);

      expect(insets.length).toBeGreaterThanOrEqual(2);

      for (const inset of insets) expect(inset).toBeCloseTo(20, 0);
      await capture("U426", `counts-resting-${scheme}-${railWidth}`);
    }, 60_000);
  }
}
