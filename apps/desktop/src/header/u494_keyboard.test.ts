import { expect, it } from "vitest";
import { browser, read, wait, url } from "../ui/tabsBrowser";

/** The Drawer and Project tabs mounted together: `u496Fixture.tsx` through `u496.html`. */
const fixture = (query = "") => url(`${new URL("./u496Fixture.tsx", import.meta.url).pathname.replace("Fixture.tsx", ".html").replace(/^.*\/src\//, "/src/")}${query}`);

it("u495_tabs_preserve_project_actions", async () => {
  await browser("open", fixture());
  await wait(`document.querySelectorAll('[role=tab]').length === 8`);
  await browser("click", '[role=tab]');
  await browser("press", 'ArrowRight');
  await wait(`document.activeElement?.getAttribute('data-value') === '/project 1 雪'`);
  await browser("press", 'Enter');
  await wait(`document.querySelector('[role=tab][aria-selected=true]')?.getAttribute('data-value') === '/project 1 雪'`);
  expect(await read<boolean>(`(() => { const tab = document.querySelector('[role=tab][aria-selected=true]'); const panel = document.getElementById(tab.getAttribute('aria-controls')); return panel?.getAttribute('role') === 'tabpanel' && panel.getAttribute('aria-labelledby') === tab.id && panel.textContent.includes('Project number 1') && !document.querySelector('button button'); })()`)).toBe(true);
  await browser("press", 'F2');
  await wait(`!!document.querySelector('.tab-rename')`);
  await browser("fill", '.tab-rename', 'Authored 雪 name');
  await browser("press", 'Enter');
  await wait(`document.querySelector('[role=tab][aria-selected=true]')?.textContent.includes('Authored 雪 name')`);
  await browser("click", '[role=tab][data-value="/project 0 雪"]');
  await wait(`document.querySelector('[role=tab][data-value="/project 0 雪"]')?.getAttribute('aria-selected') === 'true'`);
  await browser("click", '[role=tab][aria-selected=false] .tab-mark');
  await wait(`document.querySelector('[data-marks]').textContent === '1'`);
  await browser("click", '[aria-label="Close Authored 雪 name"]');
  await wait(`!!window.__question.shown`);
  await browser("eval", "window.__question.answer(true)");
  await wait(`document.querySelectorAll('[role=tab]').length === 7`);
  expect(await read<boolean>(`!document.querySelector('[role=tab][data-value="/project 1 雪"]')`)).toBe(true);
}, 90_000);

for (const away of [false, true]) it(`u496_drawer_escape_and_return_${away}`, async () => {
  await browser("open", fixture());
  await wait(`!!document.querySelector('#origin')`);
  await browser("click", '#origin');
  await wait(`document.activeElement === document.querySelector('.drawer .close')`);

  if (away) await browser("eval", `document.querySelector('[role=tabpanel]:not([hidden])').tabIndex = 0; document.querySelector('[role=tabpanel]:not([hidden])').focus()`);
  await browser("press", 'Escape');
  await wait(`document.querySelector('.drawer').dataset.open === 'false'`);
  expect(await read<boolean>(away ? `document.activeElement.matches('[role=tabpanel]')` : `document.activeElement === document.querySelector('#origin')`)).toBe(true);
}, 60_000);

it("u497_no_native_titles", async () => {
  await browser("open", url('/harness.html?view=workstreams&items=1&tabs=1&seed=tabs-8'));
  await wait(`document.querySelectorAll('.project-tab').length === 8`);
  await browser("mouse", "move", "10", "750");
  await browser("hover", '.window-title');
  await wait(`(() => { const title = document.querySelector('.window-title'); return !!document.getElementById(title.getAttribute('aria-describedby')); })()`);
  await browser("mouse", "move", "10", "750");
  await wait(`document.querySelector('.window-title').dataset.state === 'closed'`);
  await browser("press", 'Tab');
  await browser("eval", `document.querySelector('.window-title').focus()`);
  await browser("press", "Shift+Tab");
  await browser("press", "Tab");
  await wait(`document.activeElement === document.querySelector('.window-title')`);
  await wait(`(() => { const title = document.querySelector('.window-title'); return !!document.getElementById(title.getAttribute('aria-describedby')); })()`);
  expect(await read<number>(`document.querySelectorAll('.header [title],.drawer [title]').length`)).toBe(0);
}, 60_000);


it("u494_removed_origin_is_safe", async () => {
  await browser("open", fixture());
  await wait(`document.querySelectorAll('[role=tab]').length === 8`);
  await browser("hover", ".project-tab");
  await browser("eval", `(() => { const button = document.querySelector('.tab-close'); button.focus(); button.click(); })()`);
  await wait(`!!window.__question.shown`);
  await browser("eval", `window.__removed = document.querySelector('.tab-close'); window.__removed.remove()`);
  await browser("eval", "window.__question.answer(false)");
  await wait(`!window.__question.shown`);
  expect(await read<boolean>(`document.activeElement.isConnected && document.activeElement !== window.__removed`)).toBe(true);
}, 60_000);
