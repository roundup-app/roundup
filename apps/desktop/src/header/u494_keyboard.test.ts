import { expect, it } from "vitest";
import { browser, read, wait, url } from "../ui/tabsBrowser";

const prepareModels = () => browser("eval", `(() => { for (const tab of document.querySelectorAll('.project-tab')) { const app = window.__fake.app.of(tab.dataset.path); app.handlers['project.get'] = () => ({worktrees:{on:false,check:null},models:{roles:[{role:'door',model:null,effort:null}],allowed:[]}}); app.handlers['models.list'] = () => ({models:[{id:'opus',label:'Opus'}],efforts:[{id:'high',label:'High'}]}); } })()`);

for (const surface of ["models", "confirmation"]) it(`u494_dialog_keyboard_wrap_escape_and_return_${surface}`, async () => {
  await browser("open", url("/harness.html?seed=tree-40"));
  await wait(`!!window.__fake && document.querySelectorAll('.rail-row').length > 2`);
  await prepareModels();
  await browser("eval", `document.querySelector('[role=tab]').focus()`);
  if (surface === "models") await browser("press", "Meta+,");
  else {
    await browser("hover", ".project-tab");
    await browser("eval", `(() => { const button = document.querySelector('.tab-close'); button.focus(); button.click(); })()`);
  }
  const role = surface === "models" ? "dialog" : "alertdialog";
  await wait(`!!document.querySelector('[role=${role}] select, [role=${role}] button')`);
  await browser("eval", `(() => { const panel = document.querySelector('[role=${role}]'); window.__origin = ${surface === "models" ? "document.querySelector('[role=tab]')" : "document.querySelector('.tab-close')"}; window.__fields = [...panel.querySelectorAll('select,input,button')]; window.__fields.at(-1).focus(); })()`);
  await browser("press", "Tab");
  await wait(`document.activeElement === window.__fields[0]`);
  await browser("press", "Shift+Tab");
  await wait(`document.activeElement === window.__fields.at(-1)`);
  await browser("press", "Escape");
  await wait(`!document.querySelector('[role=${role}]') && document.activeElement === window.__origin`);
  expect(await read<boolean>(`window.__origin.isConnected`)).toBe(true);
}, 90_000);

it("u494_modal_blocks_underlying_actions", async () => {
  await browser("open", url("/harness.html?seed=tabs-8"));
  await wait(`document.querySelectorAll('.project-tab').length === 8 && !!window.__fake`);
  await prepareModels();
  await browser("eval", `document.querySelector('[role=tab]').focus()`);
  await browser("press", "Meta+,");
  await wait(`!!document.querySelector('[role=dialog] select')`);
  const active = await read<string>(`document.querySelector('[role=tab][aria-selected=true]').closest('.project-tab').dataset.path`);
  await browser("eval", `document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {key:']',code:'BracketRight',metaKey:true,shiftKey:true,bubbles:true,cancelable:true}))`);
  expect(await read<string>(`document.querySelector('[role=tab][aria-selected=true]').closest('.project-tab').dataset.path`)).toBe(active);
}, 90_000);

it("u495_menu_pointer_keyboard_and_return", async () => {
  await browser("open", url("/harness.html?seed=tabs-8"));
  await wait(`document.querySelectorAll('.project-tab').length === 8 && !!window.__fake`);
  await prepareModels();
  await browser("eval", `document.querySelector('[role=tab]').focus()`);
  await browser("press", "Shift+F10");
  await wait(`!!document.querySelector('[role=menu]')`);
  await browser("press", "ArrowDown");
  await wait(`document.activeElement?.getAttribute('role') === 'menuitem' || document.querySelector('[role=menuitem][data-highlighted]')`);
  await browser("press", "Escape");
  await wait(`!document.querySelector('[role=menu]') && document.activeElement === document.querySelector('[role=tab]')`);
}, 60_000);

for (const reverse of [false, true]) for (const surface of ["models", "menu"]) it(`u496_top_layer_escape_is_order_independent_${surface}_${reverse}`, async () => {
  await browser("open", url(`/src/header/u496.html${reverse ? '?reverse' : ''}`));
  await wait(`!!document.querySelector('#origin')`);
  await browser("click", "#origin");
  await wait(`document.querySelector('.drawer').dataset.open === 'true'`);
  await browser("eval", `document.querySelector('[role=tab]').focus()`);
  await browser("press", "Shift+F10");
  await wait(`!!document.querySelector('[role=menu]')`);
  if (surface === "models") {
    await browser("press", "ArrowDown");
    await wait(`!!document.querySelector('[role=menuitem][data-highlighted]')`);
    await browser("press", "Enter");
    await wait(`!!document.querySelector('[role=dialog] select')`);
  }
  await browser("press", "Escape");
  await wait(`!document.querySelector('[role=${surface === 'models' ? 'dialog' : 'menu'}]')`);
  expect(await read<string>(`document.querySelector('.drawer').dataset.open`)).toBe("true");
  expect(await read<string>(`document.querySelector('.drawer p').textContent`)).toBe("Unchanged Drawer content");
}, 90_000);

for (const target of ["input", "textarea", "[contenteditable]", ".xterm"]) it(`u496_editor_and_terminal_keep_escape_${target}`, async () => {
  await browser("open", url('/src/header/u496.html'));
  await wait(`!!document.querySelector('#origin')`);
  await browser("click", "#origin");
  await wait(`document.querySelector('.drawer').dataset.open === 'true'`);
  await browser("eval", `document.querySelector(${JSON.stringify(target === '.xterm' ? target : '.drawer ' + target)}).focus()`);
  await browser("press", "Escape");
  expect(await read<string>(`document.querySelector('.drawer').dataset.open`)).toBe("true");
}, 60_000);
