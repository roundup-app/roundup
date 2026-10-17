import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromePath, openPage } from "./chromePage";
import type { ChromePage } from "./chromePage";
import { captureDir } from "./captures";

const found = chromePath();

const run = found || process.env.CI ? describe : describe.skip;

let page: ChromePage;

const art = captureDir("U361");

// The run may serve a detached main checkout to capture the same interaction
// before the change. CI's ordinary test run requires no second server.
const baseOrigin = process.env.ROUNDUP_U361_BASE_ORIGIN;

beforeAll(async () => {
  if (!found) throw new Error("U361 needs Chromium");
  page = await openPage(found);
}, 90_000);

afterAll(async () => { await page?.close(); });

const FIXTURE = `async () => {
  const tab = [...document.querySelectorAll('.shelf [role=tab]')].find(t => t.textContent.startsWith('Todos'));
  tab.click();
  window.__fake.actAs({kind: 'agent', id: 'agent-1', parent: null});
  const rpc = window.__fake.app.rpc;
  const create = (title, blockers = null) => rpc('todo.create', {title, body: null, blockers});
  await create('w'.repeat(300));
  const blockers = [];
  for (let n = 0; n < 10; n++) blockers.push((await create('blocker ' + n)).id);
  await create('blocked by ten', blockers);
  const blocker = await create('b'.repeat(40));
  await create('t'.repeat(40), [blocker.id]);
  const done = await create('finished');
  await rpc('todo.complete', {id: done.id});

  return done.id;
}`;

// Containers hold their title by design; test the independently painted content of
// sibling controls and lines, not the containing row, text column or title button.
const READ = `() => [...document.querySelectorAll('.shelf .todo-row')].map(row => {
  const box = row.getBoundingClientRect();
  const title = row.querySelector('.shelf-title');
  const text = title.getBoundingClientRect();
  const tick = row.querySelector('input[type=checkbox]');
  const hit = tick.getBoundingClientRect();
  const css = getComputedStyle(row);
  const drawing = getComputedStyle(tick, '::before');
  const blocked = row.querySelector('.shelf-glyph .glyph');
  const blockerLinks = [...row.querySelectorAll('.todo-blocker')].map(link => {
    const b = link.getBoundingClientRect();
    const c = getComputedStyle(link);
    const range = document.createRange();
    range.selectNodeContents(link);
    const naturalWidth = range.getBoundingClientRect().width;
    return {text: link.textContent, width: b.width, naturalWidth, overflow: c.overflow, ellipsis: c.textOverflow, baseline: c.verticalAlign};
  });
  const overlap = [...row.querySelectorAll('*')].filter(el =>
    el !== title && !el.contains(title) && !title.contains(el)
  ).filter(el => {
    const b = el.getBoundingClientRect();
    return b.width > 0 && b.height > 0 && b.left < text.right - 0.5 && b.right > text.left + 0.5 && b.top < text.bottom - 0.5 && b.bottom > text.top + 0.5;
  }).map(el => el.className || el.tagName);
  const waits = row.querySelector('[data-todo-waits]');
  return {id: row.dataset.todo, group: [...document.querySelectorAll('.shelf-list')].indexOf(row.parentElement), top: box.top, height: box.height, titleHeight: text.height,
    overlap, leftInset: hit.left - box.left, rightInset: box.right - text.right,
    topInset: Math.min(text.top, hit.top) - box.top, bottomInset: box.bottom - Math.max(text.bottom, row.querySelector('.shelf-text').getBoundingClientRect().bottom),
    padding: [css.paddingLeft, css.paddingRight, css.paddingTop, css.paddingBottom],
    tick: {width: hit.width, height: hit.height, checked: tick.checked, disabled: tick.disabled,
      borderWidth: drawing.borderWidth, tone: drawing.backgroundColor, grey: css.getPropertyValue("--grey").trim(),
      visibleWidth: hit.width - parseFloat(drawing.left) - parseFloat(drawing.right),
      gap: text.left - (hit.left + hit.width - parseFloat(drawing.right))},
    blocked: blocked ? {left: blocked.getBoundingClientRect().left, tickLeft: hit.left} : null, blockerLinks,
    waits: waits ? {title: waits.title, text: waits.textContent.trim(), css: [getComputedStyle(waits.parentElement).whiteSpace, getComputedStyle(waits.parentElement).overflow, getComputedStyle(waits.parentElement).textOverflow]} : null,
    words: row.textContent, home: Boolean(row.querySelector('[data-todo-home]'))};
})`;

type Row = { id: string; group: number; top: number; height: number; titleHeight: number; overlap: string[]; leftInset: number; rightInset: number; topInset: number; bottomInset: number; padding: string[]; tick: {width: number; height: number; checked: boolean; disabled: boolean; visibleWidth: number; gap: number; borderWidth: string; tone: string; grey: string}; blocked: {left: number; tickLeft: number} | null; blockerLinks: {text: string; width: number; naturalWidth: number; overflow: string; ellipsis: string; baseline: string}[]; words: string; home: boolean; waits: {title: string; text: string; css: string[]} | null };

type Checks = Record<string, {status: string; value: unknown}>;

run("u361 the rendered Todo row", () => {
  for (const scheme of ["light", "dark"] as const) {
    it(`u361_the_open_tick_box_stays_outlined_on_hover_and_press ${scheme}`, async () => {
      await page.scheme(scheme);
      await page.load("/harness.html?seed=tree-40", 1280, 800);
      await page.until(`() => Boolean(document.querySelector('.shelf [role=tab]')) && Boolean(window.__fake)`);
      await page.call(FIXTURE);
      await page.until(`() => Boolean(document.querySelector('.shelf .todo-tick:not(:checked)'))`);

      const at = await page.call<{x: number; y: number}>(`() => {
        const tick = document.querySelector('.shelf .todo-tick:not(:checked)');
        tick.scrollIntoView({block: 'center'});
        const b = tick.getBoundingClientRect();
        return {x: b.left + 8, y: b.top + 12};
      }`);

      const read = `() => {
        const tick = document.querySelector('.shelf .todo-tick:not(:checked)');
        const inner = getComputedStyle(tick, '::after');
        return {fill: inner.backgroundColor, layer: inner.backgroundImage,
          edge: getComputedStyle(tick, '::before').backgroundColor};
      }`;

      const capture = async (state: string) => {
        if (!art) return;
        const name = `tree-40-${scheme}-1280x800-tick-${state}`;
        mkdirSync(art, {recursive: true});
        writeFileSync(resolve(art, `${name}.png`), Buffer.from(await page.shot(), "base64"));
        writeFileSync(resolve(art, `${name}.checks.json`), JSON.stringify(await page.call<Checks>(`() => window.__checks()`)) + "\n");
      };

      await page.hover(0, 0);
      const rest = await page.call<{fill: string; layer: string; edge: string}>(read);
      await page.hover(at.x, at.y);
      const hover = await page.call<typeof rest>(read);
      await capture("hover");
      await page.pointer("down", at.x, at.y);
      const pressed = await page.call<typeof rest>(read);
      await capture("pressed");
      // Release outside the box so observing press does not complete the Todo.
      await page.pointer("up", 0, 0);

      for (const state of [hover, pressed]) {
        expect(state.fill).toBe(rest.fill);
        expect(state.fill).toMatch(/^rgb\(/);
        expect(state.fill).not.toBe(state.edge);
        expect(state.edge).toBe(rest.edge);
        expect(state.layer).not.toBe("none");
      }

      expect(pressed.layer).not.toBe(hover.layer);
    }, 90_000);
  }

  // Rows are layout and every Check reads per scheme: both schemes stay, one window represents every supported one.
  const [width, height] = [1280, 800] as const;

  for (const seed of ["tree-40", "agents-10", "first-run"])
    for (const scheme of ["light", "dark"] as const) {
      it(`u361_the_rendered_row_keeps_its_geometry_at_rest_on_hover_and_on_focus ${seed} ${scheme} ${width}x${height}`, async () => {
        await page.scheme(scheme);

        if (art && baseOrigin) {
          await page.load(`${baseOrigin}/harness.html?seed=${seed}`, width, height);
          await page.until(`() => Boolean(window.__fake) && document.body.textContent.length > 0`);

          if (seed !== "first-run") {
            await page.until(`() => Boolean(document.querySelector('.shelf [role=tab]'))`);
            await page.call(FIXTURE);
            await page.until(`() => [...document.querySelectorAll('.shelf button')].some(b => /done$/.test(b.textContent.trim()))`);
            await page.call(`() => [...document.querySelectorAll('.shelf button')].find(b => /done$/.test(b.textContent.trim())).click()`);
            await page.until(`() => [...document.querySelectorAll('.shelf .shelf-title')].some(t => t.textContent === 'finished')`);
            await page.hover(0, 0);
          }

          const name = `${seed}-${scheme}-${width}x${height}`;

          mkdirSync(resolve(art, "base"), {recursive: true});
          writeFileSync(resolve(art, "base", `${name}.checks.json`), JSON.stringify(await page.call<Checks>(`() => window.__checks()`)) + "\n");
          writeFileSync(resolve(art, "base", `${name}.png`), Buffer.from(await page.shot(), "base64"));
        }

        await page.load(`/harness.html?seed=${seed}`, width, height);
        await page.until(`() => Boolean(window.__fake) && document.body.textContent.length > 0`);
        const name = `${seed}-${scheme}-${width}x${height}`;

        if (seed !== "first-run") {
          await page.until(`() => Boolean(document.querySelector('.shelf [role=tab]'))`);
          await page.call(FIXTURE);
          await page.until(`() => [...document.querySelectorAll('.shelf button')].some(b => /done$/.test(b.textContent.trim()))`);
          await page.call(`() => [...document.querySelectorAll('.shelf button')].find(b => /done$/.test(b.textContent.trim())).click()`);
          await page.until(`() => Boolean(document.querySelector('.shelf input:disabled'))`);
          await page.hover(0, 0);
          const resting = await page.call<Row[]>(READ);
          expect(resting.length).toBeGreaterThan(12);
          expect(resting.some(row => row.tick.checked && row.tick.disabled)).toBe(true);

          const foldCenter = await page.call<number>(`() => {
            const glyph = document.querySelector('.shelf .todo-inset:not(.todo-row) .shelf-glyph > .glyph');
            const mark = glyph.getBoundingClientRect();

            return mark.top + mark.height / 2 - glyph.closest('.shelf-row').getBoundingClientRect().top;
          }`);

          expect(foldCenter).toBe(16);

          const states = new Map<string, Row[]>([["rest", resting]]);

          for (const row of resting) {
            const at = await page.call<{x: number; y: number}>(`(id) => { const row = document.querySelector('.shelf [data-todo="' + id + '"]'); row.scrollIntoView({block:'center'}); const box = row.getBoundingClientRect(); return {x:box.left + 12,y:box.top + 12}; }`, row.id);
            const before = await page.call<Row[]>(READ);
            await page.hover(at.x, at.y);
            const hover = await page.call<Row[]>(READ);
            await page.call(`(id) => document.querySelector('.shelf [data-todo="' + id + '"] .todo-row-button').focus()`, row.id);

        const focus = await page.call<Row[]>(READ);

            for (const own of [hover, focus]) {
              expect(own.map(r => [r.top, r.height, r.titleHeight])).toEqual(before.map(r => [r.top, r.height, r.titleHeight]));

              for (const r of own) expect(r.overlap, `${name} #${r.id}`).toEqual([]);
            }

            states.set(`hover-${row.id}`, hover);
            states.set(`focus-${row.id}`, focus);
          }

          for (const [index, row] of resting.entries()) {
            const previous = resting[index - 1];

            if (previous?.group === row.group) expect(row.top - previous.top - previous.height).toBeCloseTo(0);
            expect(row.overlap).toEqual([]);
            expect(row.padding).toEqual(["8px", "8px", "4px", "4px"]);
            expect(row.leftInset).toBeCloseTo(8);
            expect(row.rightInset).toBeGreaterThanOrEqual(7.5);
            expect(row.topInset).toBeCloseTo(4);
            expect(row.bottomInset).toBeGreaterThanOrEqual(3.5);
            expect([row.tick.width, row.tick.height]).toEqual([24, 24]);
            expect(row.tick.checked).toBe(row.tick.disabled);
            expect(row.tick.visibleWidth).toBe(16);
            expect(row.tick.borderWidth).toBe("0px");

            if (!row.tick.checked) expect(row.tick.tone).toBe(await page.call<string>(`(tone) => { const el = document.createElement("span"); el.style.color = tone; document.body.append(el); const color = getComputedStyle(el).color; el.remove(); return color; }`, row.tick.grey));

            expect(row.tick.gap).toBe(8);

            if (row.blocked) expect(row.blocked.left).toBe(row.blocked.tickLeft);

            for (const link of row.blockerLinks) {
              expect(link.baseline).toBe("baseline");
              expect([link.overflow, link.ellipsis]).toEqual(['hidden', 'ellipsis']);

              if (/^blocker [0-9]$/.test(link.text)) expect(link.width).toBeGreaterThanOrEqual(link.naturalWidth);

              // A long title is painted inside a shrinking link, rather than
              // dropped as an indivisible inline box by its parent's ellipsis.
              if (link.text.length === 40) expect(link.width).toBeGreaterThan(16);
            }

            expect(row.words).not.toMatch(/#\d|\bcomplete\b|\bmove\b/);
            expect(row.home).toBe(false);

            if (row.waits) {
              expect(row.waits.title).toBe(row.waits.text);
              expect(row.waits.css).toEqual(["nowrap", "hidden", "ellipsis"]);
            }
          }

          if (art) {
            mkdirSync(art, {recursive: true});
            writeFileSync(resolve(art, `${name}.rows.json`), `{\n${[...states].map(([state, rows]) => `${JSON.stringify(state)}: ${JSON.stringify(rows)}`).join(",\n")}\n}\n`);
          }


        }

        if (seed === "first-run") expect(await page.call<boolean>(`() => document.querySelectorAll('.shelf [data-todo]').length === 0`)).toBe(true);

        const checks = await page.call<Checks>(`() => window.__checks()`);

        for (let n = 1; n <= 14; n++) expect(checks[`D${n}`], `${name} D${n} ${JSON.stringify(checks[`D${n}`])}`).toMatchObject({status: "pass"});

        if (art) {
          const png = Buffer.from(await page.shot(), "base64");

          for (const directory of [art, resolve(art, "head")]) {
            mkdirSync(directory, {recursive: true});
            writeFileSync(resolve(directory, `${name}.checks.json`), JSON.stringify(checks) + "\n");
            writeFileSync(resolve(directory, `${name}.png`), png);
          }
        }
      }, 90_000);

      if (seed !== "first-run") it(`u361_a_failed_tick_box_call_unchecks_it_and_keeps_visible_keyboard_focus ${seed} ${scheme} ${width}x${height}`, async () => {
        await page.scheme(scheme);
        await page.load(`/harness.html?seed=${seed}`, width, height);
        await page.until(`() => Boolean(document.querySelector('.shelf [role=tab]')) && Boolean(window.__fake)`);
        await page.call(FIXTURE);
        await page.until(`() => Boolean(document.querySelector('.shelf .todo-row-button'))`);
        // The real keyboard generates the native change event; Tab visits row then box.
        await page.call(`() => document.querySelector('.shelf [data-todo-waits]').closest('.shelf-row').querySelector('.todo-row-button').focus()`);
        // Tab visits row, Move up, Move down, then box.
        await page.press("Tab", "Tab");
        await page.press("Tab", "Tab");
        await page.press("Tab", "Tab");
        expect(await page.call<string>(`() => document.activeElement.type`)).toBe("checkbox");
        await page.call(`() => window.__fake.failNext(-32000, 'cannot complete this Todo')`);
        await page.press(" ", "Space");
        await page.until(`() => document.querySelector('.shelf .error')?.textContent.includes('cannot complete') || document.querySelector('.shelf').textContent.includes('cannot complete this Todo')`);
        expect(await page.call<boolean>(`() => document.activeElement.checked`)).toBe(false);

        const focus = await page.call<{width: string; style: string; offset: string; radius: string; parentOutlineWidth: string; right: number; titleLeft: number}>(`() => {
          const box = document.activeElement;
          const s = getComputedStyle(box, "::before");

          return {width: s.outlineWidth, style: s.outlineStyle, offset: s.outlineOffset, radius: s.borderRadius, parentOutlineWidth: getComputedStyle(box).outlineWidth,
            right: box.getBoundingClientRect().right - parseFloat(s.right) + parseFloat(s.outlineWidth) + parseFloat(s.outlineOffset),
            titleLeft: box.closest('.shelf-row').querySelector('.shelf-title').getBoundingClientRect().left};
        }`);

        expect(focus).toMatchObject({width: "2px", style: "solid", offset: "2px", radius: "4px", parentOutlineWidth: "0px"});
        expect(focus.right).toBeLessThanOrEqual(focus.titleLeft);

        if (art) {
          const name = `${seed}-${scheme}-${width}x${height}-failure`;

          writeFileSync(resolve(art, `${name}.focus.json`), JSON.stringify(focus) + "\n");
          writeFileSync(resolve(art, `${name}.png`), Buffer.from(await page.shot(), "base64"));
          writeFileSync(resolve(art, `${name}.checks.json`), JSON.stringify(await page.call<Checks>(`() => window.__checks()`)) + "\n");
        }

      }, 30_000);

    }
});
