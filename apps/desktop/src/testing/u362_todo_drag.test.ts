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
  await page.until(`() => Boolean(document.querySelector('.shelf [role=tab]')) && Boolean(document.querySelector('.rail-row[aria-expanded]')) && Boolean(window.__fake)`);
  await page.call(`() => {
    [...document.querySelectorAll('.shelf [role=tab]')].find(t => t.textContent.startsWith('Todos')).click();
    document.querySelector('.rail-row[aria-expanded]').click();
  }`);
  await page.until(`() => Boolean(document.querySelector('.shelf button[aria-pressed]'))`);
  await page.call(`() => document.querySelector('.scope-control[aria-pressed="false"]').click()`);
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

run('u137 compound selected ground', () => {
  for (const scheme of ['light', 'dark'] as const) {
    const width = 1280;
    it(`u137_nested_rail_text_is_measured_on_the_full_size_wash ${scheme} ${width}`, async () => {
      await page.scheme(scheme);
      await setup(false, '', width, 800);
      await page.call(`() => {
        const row = document.querySelector('.rail-row[data-id="payments"]');
        row.click();
        row.focus();
      }`);
      await page.until(`() => Boolean(document.querySelector('.rail-row[data-selected="true"] .rail-add-label'))`);
      const checks = await page.call<Checks>(`() => window.__checks()`);
      expect(checks.D5?.status, JSON.stringify(checks.D5)).toBe('pass');
      expect(checks.D10?.status, JSON.stringify(checks.D10)).toBe('pass');
      await capture('U137', `${scheme}-${width}-selected`, {checks});
    }, 30_000);
  }

  for (const [coverage, scheme, width] of [
    ['full', 'light', 1280], ['full', 'dark', 1280],
    ['partial', 'light', 1280], ['overlapping', 'light', 1280], ['single', 'light', 1280], ['padded', 'light', 1280], ['focus', 'light', 1280], ['focus-inset', 'light', 1280],
  ] as const) {
    it(`u137_compound_ground_never_silently_ignores_${coverage}_coverage ${scheme} ${width}`, async () => {
      await page.scheme(scheme);
      await setup(false, '', width, 800);
      await page.call(`(coverage, scheme) => {
        document.body.innerHTML = '<div class="compound"><button><span>Nested Rail label</span></button></div>';
        const sheet = document.head.appendChild(document.createElement('style'));
        sheet.textContent = 'body {background: white} .compound {width: 200px; height: 32px; padding-left: 24px; background-color: white; background-image: linear-gradient(rgb(0, 0, 0), rgb(0, 0, 0)), linear-gradient(rgba(0, 0, 0, .1), rgba(0, 0, 0, .1)); background-size: 2px 100%, auto; background-repeat: no-repeat; background-position: left top} .compound button {background: transparent; color: rgb(112, 112, 112)}';
        if (scheme === 'dark') {
          document.body.style.backgroundColor = 'black';
          document.querySelector('.compound').style.backgroundColor = 'black';
          document.querySelector('.compound').style.backgroundImage = 'linear-gradient(rgb(255, 255, 255), rgb(255, 255, 255)), linear-gradient(rgba(255, 255, 255, .4), rgba(255, 255, 255, .4))';
          document.querySelector('.compound button').style.color = 'rgb(170, 170, 170)';
        }
        if (coverage === 'single') {
          document.querySelector('.compound').style.backgroundImage = 'linear-gradient(rgba(0, 0, 0, .1), rgba(0, 0, 0, .1))';
          document.querySelector('.compound').style.backgroundSize = 'auto';
        }
        if (coverage === 'padded') {
          document.querySelector('.compound').textContent = 'Padded Rail label';
          document.querySelector('.compound').style.color = 'rgb(112, 112, 112)';
        }
        if (coverage === 'focus' || coverage === 'focus-inset') {
          document.querySelector('.compound button').style.color = 'black';
          const row = document.querySelector('.compound');
          row.tabIndex = 0;
          row.style.outline = '2px solid rgb(238, 238, 238)';
          if (coverage === 'focus-inset') row.style.outlineOffset = '-4px';
          row.focus();
        }
        if (coverage === 'partial') document.querySelector('.compound').style.backgroundSize = '2px 100%, 50% 100%';
        if (coverage === 'overlapping') document.querySelector('.compound').style.backgroundSize = '100% 100%, auto';
      }`, coverage, scheme);
      const checks = await page.call<Checks>(`() => window.__checks()`);
      expect(checks.D5?.status).toBe('fail');
      expect(checks.D10?.status).toBe('fail');
      expect(checks.D10?.value).toEqual(expect.objectContaining({failing: expect.arrayContaining(['D5'])}));

      // WCAG: #707070 on RGB(229.5,229.5,229.5); #aaa on #666. The leading mark is outside the label.
      if (coverage === 'full' || coverage === 'single' || coverage === 'padded') expect(checks.D5?.value).toEqual({text: expect.closeTo(scheme === 'dark' ? 2.471602 : 3.949511, 5)});
      else if (coverage === 'focus-inset') expect(checks.D5?.value).toEqual({focusRing: expect.closeTo(1.080701, 5)});
      else if (coverage === 'focus') expect(checks.D5?.value).toEqual({focusRing: expect.closeTo(1.16023, 5)});
      else expect(checks.D5?.value).toBe('not measurable');
    }, 30_000);
  }
});

run('u362 rendered Todo drag', () => {
  // The drop target and calls do not change with scheme; the wash reads its own Token.
  for (const scheme of ['light'] as const) {
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
      const movedHome = await page.call<string>(`async id => (await window.__fake.app.rpc('todo.list', {})).find(todo => todo.id === Number(id)).home`, id);
      expect(movedHome).toBe(home);
      const back = await point(`.shelf [data-todo="${id}"] .todo-row-button`);
      const root = await point('[data-todo-root]');
      await page.pointer('down', back.x, back.y);
      await page.pointer('move', root.x, root.y);
      await page.pointer('up', root.x, root.y);
      await page.until(`() => window.__fake.app.calls.filter(c => c.method === 'todo.move').length === 2`);
      expect(await page.call(`() => window.__fake.app.calls.filter(c => c.method === 'todo.move').at(-1).params`)).toEqual({id: Number(id), home: null});
      expect(await page.call(`() => document.activeElement === document.body`)).toBe(false);
      expect(await page.call(`async id => (await window.__fake.app.rpc('todo.list', {})).find(todo => todo.id === Number(id)).home`, id)).toBeNull();
      await capture('U362', `${scheme}-root-home`, {base, checks: await page.call(`() => window.__checks()`), movedHome, calls: await page.call(`() => window.__fake.app.calls.filter(c => c.method === 'todo.move')`)});
    }, 60_000);
  }
});

run('u362 rendered Todo drag that moves nothing', () => {
  it('u362_a_drop_elsewhere_escape_or_on_an_agent_calls_nothing', async () => {
    await page.scheme('light');
    await setup();
    const id = await page.call<string>(`() => document.querySelector('.shelf .todo-row').dataset.todo`);
    const from = await point(`.shelf [data-todo="${id}"] .todo-row-button`);
    const home = await point('.rail-row[aria-expanded]');
    const elsewhere = await point('.shelf-head, .shelf');
    const calls = () => page.call<string[]>(`() => window.__fake.app.calls.filter(c => c.method === 'todo.move' || c.method === 'todo.reorder').map(c => c.method)`);

    // Escape over a Home.
    await page.pointer('down', from.x, from.y);
    await page.pointer('move', home.x, home.y);
    expect(await page.call(`() => Boolean(document.querySelector('[data-todo-drop]'))`)).toBe(true);
    await page.press('Escape', 'Escape');
    await page.pointer('up', home.x, home.y);
    expect(await page.call(`() => document.querySelector('[data-todo-drop]')`)).toBeNull();
    // Over a Home, then back out of the Rail and released there.
    await page.pointer('down', from.x, from.y);
    await page.pointer('move', home.x, home.y);
    await page.pointer('move', elsewhere.x + 10, elsewhere.y);
    expect(await page.call(`() => document.querySelector('[data-todo-drop]')`)).toBeNull();
    await page.pointer('up', elsewhere.x + 10, elsewhere.y);
    // An Agent row is no Home.
    const agent = await point('.rail-row[data-id]:not([aria-expanded])');
    await page.pointer('down', from.x, from.y);
    await page.pointer('move', agent.x, agent.y);
    expect(await page.call(`() => document.querySelector('[data-todo-drop]')`)).toBeNull();
    await page.pointer('up', agent.x, agent.y);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await calls()).toEqual([]);
  }, 60_000);
});

run('u363 Todo rows in the worst case', () => {
  // Row geometry reads both Shelf widths in light; D5 reads dark once, at the narrowest.
  for (const [scheme, shelfWidth] of [['light', 163], ['light', 480], ['dark', 163]] as const) {
    it(`u363_the_worst_case_keeps_the_row_design ${scheme} ${shelfWidth}`, async () => {
      await page.scheme(scheme);
      await setup(true);
      const base = await page.call<Checks>(`() => window.__checks()`);
      await page.call(`shelfWidth => {
        document.querySelector('.shelf').style.width = shelfWidth + 'px';
        document.querySelector('[aria-label="Todo fixture"] button').click();
      }`, shelfWidth);
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
      await capture('U363', `${scheme}-${shelfWidth}-drag`, {rows, base, checks: await page.call(`() => window.__checks()`)});
      await page.pointer('up', to.x, to.y);
      await page.until(`() => window.__fake.app.calls.some(c => c.method === 'todo.move')`);
      const checks = await page.call<Checks>(`() => window.__checks()`);

      for (const id of ['D2', 'D5', 'D6', 'D10', 'D12', 'D14']) expect(checks[id]?.status, id).toBe('pass');
      await page.call(`() => {
        document.querySelector('[aria-label="Todo count"]').click();
      }`);
      await page.until(`() => !document.querySelector('[aria-label="Todo fixture"] button').disabled && document.querySelectorAll('.shelf .todo-row').length === 0`);
      await capture('U363', `${scheme}-${shelfWidth}-empty`, {checks: await page.call(`() => window.__checks()`)});
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
