import { expect, it } from "vitest";
import { browser, read, wait, url } from "../ui/tabsBrowser";

/** The Drawer and Project tabs mounted together: `u496Fixture.tsx` through `u496.html`. */
const fixture = (query = "") => url(`${new URL("./u496Fixture.tsx", import.meta.url).pathname.replace("Fixture.tsx", ".html").replace(/^.*\/src\//, "/src/")}${query}`);

it("u494_dialog_keyboard_wrap_escape_and_return_confirmation", async () => {
  await browser("open", url("/harness.html?seed=tree-40"));
  await wait(`!!window.__fake && document.querySelectorAll('.rail-row').length > 2`);
  await browser("eval", `document.querySelector('[role=tab]').focus()`);
  await browser("hover", ".project-tab");
  await browser("eval", `(() => { const button = document.querySelector('.tab-close'); button.focus(); button.click(); })()`);

  const role = "alertdialog";
  await wait(`!!document.querySelector('[role=${role}] select, [role=${role}] button')`);
  await browser("eval", `(() => { const panel = document.querySelector('[role=${role}]'); window.__origin = document.querySelector('.tab-close'); window.__fields = [...panel.querySelectorAll('select,input,button')]; window.__fields.at(-1).focus(); })()`);
  await browser("press", "Tab");
  await wait(`document.activeElement === window.__fields[0]`);
  await browser("press", "Shift+Tab");
  await wait(`document.activeElement === window.__fields.at(-1)`);
  await browser("press", "Escape");
  await wait(`!document.querySelector('[role=${role}]') && document.activeElement === window.__origin`);
  expect(await read<boolean>(`window.__origin.isConnected`)).toBe(true);
}, 90_000);

it("u494_modal_blocks_underlying_actions_confirmation", async () => {
  await browser("open", url("/harness.html?seed=tabs-8"));
  await wait(`document.querySelectorAll('.project-tab').length === 8 && !!window.__fake`);
  await browser("eval", `document.querySelector('[role=tab]').focus()`);
  await browser("eval", `document.querySelector('.project-tab:nth-child(2) .tab-close').click()`);
  await wait(`!!document.querySelector('[role=alertdialog]')`);
  const writes = await read<number>(`[...document.querySelectorAll('.project-tab')].flatMap(t=>window.__fake.app.of(t.dataset.path).calls).filter(c=>c.method==='terminal.write').length`);
  await browser("press", "x");
  expect(await read<number>(`[...document.querySelectorAll('.project-tab')].flatMap(t=>window.__fake.app.of(t.dataset.path).calls).filter(c=>c.method==='terminal.write').length`)).toBe(writes);
}, 90_000);

for (const target of ["input", "textarea", "[contenteditable]", ".xterm"]) it(`u496_editor_and_terminal_keep_escape_${target}`, async () => {
  await browser("open", fixture());
  await wait(`!!document.querySelector('#origin')`);
  await browser("click", "#origin");
  await wait(`document.querySelector('.drawer').dataset.open === 'true'`);
  await browser("eval", `document.querySelector(${JSON.stringify(target === '.xterm' ? target : '.drawer ' + target)}).focus()`);
  await browser("press", "Escape");
  expect(await read<string>(`document.querySelector('.drawer').dataset.open`)).toBe("true");
}, 60_000);

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
  await browser("click", '[role=tab][aria-selected=true] .tab-mark');
  await wait(`document.querySelector('[data-marks]').textContent === '1'`);
  await browser("click", '[aria-label="Close Authored 雪 name"]');
  await wait(`!!document.querySelector('[role=alertdialog]')`);
  await browser("find", "role", "button", "click", "--name", "Stop and close", "--exact");
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

it("u497_control_names_and_tooltips", async () => {
  await browser("open", fixture());
  await wait(`document.querySelectorAll('[role=tab]').length === 8`);
  await browser("click", '#origin');
  await wait(`document.querySelector('.drawer').dataset.open === 'true'`);
  await browser("hover", '.drawer .close');
  await wait(`(() => { const el=document.querySelector('.drawer .close'); return document.getElementById(el.getAttribute('aria-describedby'))?.textContent === 'Close'; })()`);
  await browser("mouse", "move", "10", "750");
  await wait(`document.querySelector('.drawer .close').dataset.state === 'closed'`);
  await browser("press", 'Shift+Tab');
  await browser("press", 'Tab');
  await wait(`document.activeElement === document.querySelector('.drawer .close') && document.querySelector('.drawer .close').dataset.state === 'open'`);
  await browser("eval", `document.querySelector('.drawer .close').click()`);
  await wait(`document.querySelector('.drawer').dataset.open === 'false'`);

  for (let at = 0; at < 8; at++) {
    await browser("eval", `document.querySelectorAll('.project-tab')[${at}].querySelector('[role=tab]').click()`);
    await wait(`document.querySelectorAll('.project-tab')[${at}].dataset.selected === 'true'`);
    await browser("hover", `.project-tab:nth-child(${at + 1}) [role=tab]`);
    await wait(`document.querySelectorAll('.project-tab')[${at}].querySelector('.tab-close').checkVisibility({visibilityProperty:true})`);
    const selector = `.project-tab:nth-child(${at + 1}) .tab-close`;
    const name = await read<string>(`document.querySelector(${JSON.stringify(selector)}).getAttribute('aria-label')`);
    expect(name).toBe(`Close Project number ${at}`);
    await browser("hover", selector);
    await wait(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); return document.getElementById(el.getAttribute('aria-describedby'))?.textContent === ${JSON.stringify(name)}; })()`);
    await browser("hover", '#origin');
    await wait(`document.querySelector(${JSON.stringify(selector)}).dataset.state === 'closed'`);
    await browser("eval", `document.querySelectorAll('.project-tab')[${at}].querySelector('[role=tab]').focus()`);
    await wait(`document.querySelectorAll('.project-tab')[${at}].querySelector('.tab-close').checkVisibility({visibilityProperty:true})`);
    await browser("press", 'Tab');
    await wait(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); return document.getElementById(el.getAttribute('aria-describedby'))?.textContent === ${JSON.stringify(name)}; })()`);
  }

  await browser("eval", `document.querySelectorAll('.project-tab')[0].querySelector('[role=tab]').click()`);

  for (const selector of ['.strip-add', '.strip-edge-left', '.strip-edge-right']) {
    await browser("eval", `(() => { const list = document.querySelector('.tablist'); list.scrollLeft = ${selector.endsWith('left') ? 'list.scrollWidth' : '0'}; })()`);
    await wait(`!!document.querySelector(${JSON.stringify(selector)})`);
    await browser("hover", selector);
    await wait(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); return document.getElementById(el.getAttribute('aria-describedby'))?.textContent === el.getAttribute('aria-label'); })()`);
    await browser("mouse", "move", "10", "750");
    await wait(`document.querySelector(${JSON.stringify(selector)}).dataset.state === 'closed'`);
    await browser("eval", `document.querySelector('[role=tab][aria-selected=true]').focus({preventScroll:true})`);
    await browser("eval", `(() => { const target=document.querySelector(${JSON.stringify(selector)}); const stops=[...document.querySelectorAll('button,input,textarea,[tabindex="0"]')].filter(e=>e.tabIndex>=0 && e.checkVisibility({visibilityProperty:true})); stops[stops.indexOf(target)-1].focus(); })()`);
    await browser("press", 'Tab');
    await wait(`document.activeElement === document.querySelector(${JSON.stringify(selector)}) && document.querySelector(${JSON.stringify(selector)}).dataset.state === 'open'`);
  }

  expect(await read<number>(`document.querySelectorAll('.strip [title],.drawer [title]').length`)).toBe(0);
}, 180_000);

it("u497_no_native_titles", async () => {
  await browser("open", url('/harness.html?seed=tabs-8'));
  await wait(`document.querySelectorAll('.project-tab').length === 8`);
  await browser("hover", '.window-title');
  await wait(`(() => { const title = document.querySelector('.window-title'); return document.getElementById(title.getAttribute('aria-describedby'))?.textContent === title.textContent; })()`);
  await browser("mouse", "move", "10", "750");
  await wait(`document.querySelector('.window-title').dataset.state === 'closed'`);
  await browser("eval", `document.querySelector('.strip-add').focus()`);
  await browser("press", 'Tab');
  await wait(`document.activeElement === document.querySelector('.window-title')`);
  await wait(`(() => { const title = document.querySelector('.window-title'); return document.getElementById(title.getAttribute('aria-describedby'))?.textContent === title.textContent; })()`);
  expect(await read<number>(`document.querySelectorAll('.header [title],.drawer [title]').length`)).toBe(0);
}, 60_000);


it("u494_removed_origin_is_safe", async () => {
  await browser("open", fixture());
  await wait(`document.querySelectorAll('[role=tab]').length === 8`);
  await browser("hover", ".project-tab");
  await browser("eval", `(() => { const button = document.querySelector('.tab-close'); button.focus(); button.click(); })()`);
  await wait(`!!document.querySelector('[role=alertdialog]')`);
  await browser("eval", `window.__removed = document.querySelector('.tab-close'); window.__removed.remove()`);
  await browser("press", 'Escape');
  await wait(`!document.querySelector('[role=alertdialog]')`);
  expect(await read<boolean>(`document.activeElement.isConnected && document.activeElement !== window.__removed`)).toBe(true);
}, 60_000);
