import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromePath, openPage } from "./chromePage";
import type { ChromePage } from "./chromePage";
import { captureDir } from "./captures";

const found = chromePath();

const run = found || process.env.CI ? describe : describe.skip;

let page: ChromePage;

beforeAll(async () => {
  if (!found) throw new Error("U362 needs Chromium");
  page = await openPage(found);
}, 90_000);

afterAll(async () => { await page?.close(); });

type Point = {x: number; y: number};

type Checks = Record<string, {status: string; value: unknown}>;

type Row = {width: number; listWidth: number; tick: number; tickHeight: number; left: number; right: number; top: number; waitsLeft: number | null; titleLeft: number; padding: number};

type Evidence = {base?: Checks; checks: Checks; rows?: Row[]; movedHome?: string; calls?: {method: string; params: {id: number; home: string | null}}[]};

const setup = async (worst = false, origin = "", width = 1280, height = 820) => {
  await page.load(`${origin}/harness.html?seed=tree-40${worst ? '&todos=worst' : ''}`, width, height);
  await page.until(`() => Boolean(document.querySelector('.shelf [role=tab]')) && Boolean(window.__fake)`);
  await page.call(`() => {
    [...document.querySelectorAll('.shelf [role=tab]')].find(t => t.textContent.startsWith('Todos')).click();
    document.querySelector('.rail-row[aria-expanded]').click();
  }`);
  await page.until(`() => Boolean(document.querySelector('.shelf button[aria-pressed]'))`);
  await page.call(`() => [...document.querySelectorAll('.shelf button')].find(b => b.textContent === 'All').click()`);
  await page.until(`() => Boolean(document.querySelector('.shelf .todo-row-button'))`);
};

const point = (selector: string) => page.call<Point>(`selector => {
  const el = document.querySelector(selector);
  el.scrollIntoView({block: 'nearest'});
  const b = el.getBoundingClientRect();
  return {x: b.left + b.width / 2, y: b.top + b.height / 2};
}`, selector);

const capture = async (id: string, name: string, evidence: Evidence) => {
  const dir = captureDir(id);

  if (!dir) return;
  mkdirSync(dir, {recursive: true});
  writeFileSync(resolve(dir, `${name}.png`), Buffer.from(await page.shot(), 'base64'));
  writeFileSync(resolve(dir, `${name}.checks.json`), JSON.stringify(evidence) + '\n');
};

run('u362 Checks against main', () => {
  for (const scheme of ['light', 'dark'] as const) for (const [width, height] of [[1280, 800], [1440, 800]]) {
    it(`u362_no_check_passing_on_main_regresses ${scheme} ${width}`, async () => {
      await page.scheme(scheme);
      await setup(false, process.env.ROUNDUP_U362_BASE_ORIGIN ?? '', width, height);
      const base = await page.call<Checks>(`() => window.__checks()`);
      await capture('U362', `${scheme}-${width}-before`, {checks: base});
      await setup(false, '', width, height);
      const checks = await page.call<Checks>(`() => window.__checks()`);

      for (const [id, result] of Object.entries(base)) if (result.status === 'pass') expect(checks[id]?.status, id).toBe('pass');
      await capture('U362', `${scheme}-${width}-after`, {base, checks});
    }, 30_000);
  }
});

run('u362 rendered Todo drag', () => {
  for (const scheme of ['light', 'dark'] as const) {
    it(`u362_a_drop_moves_to_the_workstream_then_project_root ${scheme}`, async () => {
      await page.scheme(scheme);
      await setup();
      const base = await page.call<Checks>(`() => window.__checks()`);
      const id = await page.call<string>(`() => document.querySelector('.shelf .todo-row').dataset.todo`);
      const home = await page.call<string>(`() => document.querySelector('.rail-row[aria-expanded]').dataset.id`);
      const from = await point(`.shelf [data-todo="${id}"] .todo-row-button`);
      const to = await point('.rail-row[aria-expanded]');
      await page.pointer('down', from.x, from.y);
      await page.pointer('move', to.x, to.y);
      expect(await page.call<string>(`() => document.querySelector('[data-todo-drop]')?.dataset.id`)).toBe(home);

      const paint = await page.call<{image: string; wash: string; colour: string}>(`() => {
        const css = getComputedStyle(document.querySelector('[data-todo-drop]'));
        return {image: css.backgroundImage, wash: css.getPropertyValue('--hover').trim(), colour: css.backgroundColor};
      }`);

      expect(paint.image.endsWith(`linear-gradient(${paint.wash}, ${paint.wash})`)).toBe(true);
      expect(paint.colour).toBe('rgba(0, 0, 0, 0)');
      await capture('U362', `${scheme}-over-workstream`, {base, checks: await page.call(`() => window.__checks()`)});
      await page.pointer('up', to.x, to.y);
      await page.until(`() => window.__fake.app.calls.some(c => c.method === 'todo.move')`);
      expect(await page.call(`() => window.__fake.app.calls.filter(c => c.method === 'todo.move').at(-1).params`)).toEqual({id: Number(id), home});
      expect(await page.call(`() => window.__fake.app.calls.filter(c => c.method === 'todo.reorder').length`)).toBe(0);
      await page.call(`id => document.querySelector('.shelf [data-todo="' + id + '"] .todo-row-button').click()`, id);
      await page.until(`() => Boolean(document.querySelector('[aria-label="Drawer"] [aria-label^="Move #"]'))`);
      const movedHome = await page.call<string>(`() => document.querySelector('[aria-label="Drawer"] [aria-label^="Move #"]').closest('div.light').textContent`);
      expect(movedHome).toContain('backend');
      await page.press('Escape', 'Escape');
      const back = await point(`.shelf [data-todo="${id}"] .todo-row-button`);
      const root = await point('[data-todo-root]');
      await page.pointer('down', back.x, back.y);
      await page.pointer('move', root.x, root.y);
      await page.pointer('up', root.x, root.y);
      await page.until(`() => window.__fake.app.calls.filter(c => c.method === 'todo.move').length === 2`);
      expect(await page.call(`() => window.__fake.app.calls.filter(c => c.method === 'todo.move').at(-1).params`)).toEqual({id: Number(id), home: null});
      expect(await page.call(`() => document.activeElement === document.body`)).toBe(false);
      await page.call(`id => document.querySelector('.shelf [data-todo="' + id + '"] .todo-row-button').click()`, id);
      await page.until(`() => document.querySelector('[aria-label="Drawer"] [aria-label^="Move #"]')?.closest('div.light').textContent.includes('Project root')`);
      await capture('U362', `${scheme}-root-home`, {base, checks: await page.call(`() => window.__checks()`), movedHome, calls: await page.call(`() => window.__fake.app.calls.filter(c => c.method === 'todo.move')`)});
    }, 60_000);
  }
});

run('u362 keyboard Move', () => {
  it('u362_the_drawer_move_still_works_by_keyboard', async () => {
    await setup();
    const id = await page.call<string>(`() => document.querySelector('.shelf .todo-row').dataset.todo`);
    await page.call(`() => document.querySelector('.shelf .todo-row-button').focus()`);
    await page.press('Enter', 'Enter');
    await page.until(`() => Boolean(document.querySelector('[aria-label="Drawer"] [aria-label^="Move #"]'))`);

    for (let n = 0; n < 30; n++) {
      if (await page.call<boolean>(`() => document.activeElement?.getAttribute('aria-label')?.startsWith('Move #') === true`)) break;
      await page.press('Tab', 'Tab');
    }

    expect(await page.call(`() => document.activeElement.getAttribute('aria-label')`)).toBe(`Move #${id}`);
    await page.press('Enter', 'Enter');
    await page.press('Tab', 'Tab');
    await page.press('Enter', 'Enter');
    await page.until(`() => window.__fake.app.calls.some(c => c.method === 'todo.move')`);
    expect(await page.call(`() => window.__fake.app.calls.filter(c => c.method === 'todo.move')`)).toEqual([{method: 'todo.move', params: {id: Number(id), home: 'backend'}}]);
    expect(await page.call(`() => document.activeElement.getAttribute('aria-label')`)).toBe(`Move #${id}`);
  }, 30_000);
});

run('u363 Todo rows in the worst case', () => {
  for (const scheme of ['light', 'dark'] as const) for (const width of [163, 480]) {
    it(`u363_the_worst_case_keeps_the_row_design ${scheme} ${width}`, async () => {
      await page.scheme(scheme);
      await setup(true);
      const base = await page.call<Checks>(`() => window.__checks()`);
      await page.call(`width => {
        document.querySelector('.shelf').style.width = width + 'px';
        document.querySelector('[aria-label="Todo fixture"] button').click();
      }`, width);
      await page.until(`() => document.querySelector('[aria-label="Todo fixture"] button').getAttribute('aria-pressed') === 'true'`, 30_000);
      await page.until(`() => document.querySelectorAll('.shelf .todo-row').length === 200`);
      await page.call(`async () => {
        await document.fonts.ready;
        await Promise.all([...document.querySelectorAll('.shelf .todo-row')].flatMap(row => row.getAnimations()).map(animation => animation.finished));
      }`);

      const rows = await page.call<Row[]>(`() => [...document.querySelectorAll('.shelf .todo-row')].map(row => {
        const b = row.getBoundingClientRect();
        const list = row.parentElement.getBoundingClientRect();
        const tick = row.querySelector('input').getBoundingClientRect();
        const title = row.querySelector('.shelf-title').getBoundingClientRect();
        const waits = row.querySelector('[data-todo-waits]')?.getBoundingClientRect();
        return {width: b.width, listWidth: list.width, tick: tick.width, tickHeight: tick.height, left: tick.left - b.left, right: b.right - title.right, top: tick.top - b.top, waitsLeft: waits?.left ?? null, titleLeft: title.left, padding: parseFloat(getComputedStyle(row).paddingLeft)};
      })`);

      expect(rows).toHaveLength(200);

      for (const row of rows) {
        expect(row.width).toBeLessThanOrEqual(row.listWidth);
        expect(row.tick).toBeGreaterThanOrEqual(24);
        expect(row.tickHeight).toBeGreaterThanOrEqual(24);
        expect(row.left).toBe(row.padding);
        expect(row.right).toBeGreaterThanOrEqual(row.padding - 1);
        expect(row.top).toBeGreaterThanOrEqual(4);

        if (row.waitsLeft !== null) expect(row.waitsLeft).toBe(row.titleLeft);
      }

      const from = await point('.shelf .todo-row-button');
      const to = await point('.rail-row[aria-expanded]');
      await page.pointer('down', from.x, from.y);
      await page.pointer('move', to.x, to.y);
      expect(await page.call(`() => Boolean(document.querySelector('[data-todo-drop]'))`)).toBe(true);
      await capture('U363', `${scheme}-${width}-drag`, {rows, base, checks: await page.call(`() => window.__checks()`)});
      await page.pointer('up', to.x, to.y);
      await page.until(`() => window.__fake.app.calls.some(c => c.method === 'todo.move')`);
      const checks = await page.call<Checks>(`() => window.__checks()`);

      for (const id of ['D2', 'D5', 'D6', 'D12', 'D14']) if (base[id]?.status === 'pass') expect(checks[id]?.status, id).toBe('pass');
      await page.call(`() => {
        document.querySelector('[aria-label="Todo count"]').click();
      }`);
      await page.until(`() => !document.querySelector('[aria-label="Todo fixture"] button').disabled && document.querySelectorAll('.shelf .todo-row').length === 0`);
      await capture('U363', `${scheme}-${width}-empty`, {checks: await page.call(`() => window.__checks()`)});
    }, 90_000);
  }
});

run('u362 rendered move failure', () => {
  for (const scheme of ['light', 'dark'] as const) {
    it(`u362_a_failed_move_stays_visible_on_the_densest_seed ${scheme}`, async () => {
      await page.scheme(scheme);
      await setup(true);
      await page.call(`() => {
        document.querySelector('.shelf').style.width = '163px';
        document.querySelector('[aria-label="Todo fixture"] button').click();
      }`);
      await page.until(`() => document.querySelector('[aria-label="Todo fixture"] button').getAttribute('aria-pressed') === 'true'`);
      await page.until(`() => document.querySelectorAll('.shelf .todo-row').length === 200`);
      await page.call(`async () => {
        await document.fonts.ready;
        await Promise.all([...document.querySelectorAll('.shelf .todo-row')].flatMap(row => row.getAnimations()).map(animation => animation.finished));
      }`);
      const from = await point('.shelf .todo-row-button');
      const to = await point('.rail-row[aria-expanded]');
      await page.pointer('down', from.x, from.y);
      await page.pointer('move', to.x, to.y);
      expect(await page.call(`() => Boolean(document.querySelector('[data-todo-drop]'))`)).toBe(true);
      await page.call(`() => window.__fake.failNext(-32000, 'Cannot move this Todo')`);
      await page.pointer('up', to.x, to.y);
      await page.until(`() => document.querySelector('.shelf [role="alert"]')?.textContent.includes('Cannot move this Todo')`);
      await page.call(`async () => {
        await Promise.all([...document.querySelectorAll('.shelf .todo-row')].flatMap(row => row.getAnimations()).map(animation => animation.finished));
      }`);
      const checks = await page.call<Checks>(`() => window.__checks()`);

      for (const [id, result] of Object.entries(checks)) expect(result.status, `${id}: ${JSON.stringify(result.value)}`).toBe('pass');
      await capture('U362', `${scheme}-163-failure`, {checks});
    }, 30_000);
  }
});
