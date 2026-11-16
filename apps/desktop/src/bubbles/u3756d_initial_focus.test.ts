import { expect, it } from "vitest";
import { browser, read, url, wait } from "../ui/tabsBrowser";
import { capture, fresh, lateUserTerminalOpen, load, newer, richPadInitialization } from "./u3756_support";

for (const listFirst of [false, true]) {
  it(`u3756d_a_late_user_terminal_open_${listFirst ? "list" : "reply"}_first_takes_initial_focus`, () => lateUserTerminalOpen(listFirst, false), 90_000);
}

it("u3756d_initial_and_explicit_terminal_focus_still_work", async () => {
  await load();
  await read(`window.arrive()`);
  await wait(`!!document.activeElement?.closest('.pane-screen')`);
  await browser("keyboard", "type", "initial");
  await wait(`window.__fake.app.calls.some(c => c.method === 'terminal.write')`);
  expect(await read(`window.__fake.app.calls.filter(c => c.method === 'terminal.write').map(c => atob(c.params.data)).join('')`)).toBe("initial");
  await capture("U3756d", "initial");
  await newer("bubble");
  await read(`window.originalRow = document.querySelector('.rail-row[data-selected]')`);
  await browser("focus", `.rail-row[data-id="${await read<string>("window.originalRow.dataset.id")}"]`);
  await browser("press", "Enter");
  await wait(`!!document.activeElement?.closest('.pane-screen')`);
  await browser("keyboard", "type", "selected");
  await wait(`window.__fake.app.calls.filter(c => c.method === 'terminal.write').map(c => atob(c.params.data)).join('') === 'initialselected'`);
  expect(await read(`window.__fake.app.calls.filter(c => c.method === 'terminal.write').map(c => atob(c.params.data)).join('')`)).toBe("initialselected");
  await capture("U3756d", "explicit");
}, 90_000);

it("u3756d_rich_pad_initialization_focuses", () => richPadInitialization(false), 90_000);

it("u3756d_explicit_supervisor_start_owns_its_initial_terminal_focus", async () => {
  await fresh("door-stopped");
  await wait(`!!document.querySelector('.pane-action')`);
  await read(`document.querySelector('.pane-action').click()`);
  await wait(`!!document.activeElement?.closest('.pane-screen .xterm')`);
  await browser("keyboard", "type", "start");
  await wait(`window.__fake.app.calls.filter(c => c.method === 'terminal.write').map(c => atob(c.params.data)).join('') === 'start'`);
  expect(await read(`new Set(window.__fake.app.calls.filter(c => c.method === 'terminal.write').map(c => c.params.id)).size`)).toBe(1);
}, 90_000);

it.each(["Engine", "Model"])("u3756d_settings_picker_escape_returns_focus_%s", async label => {
  await browser("set", "viewport", "1512", "950");
  await browser("set", "media", "dark");
  await browser("open", url("/harness.html?seed=tree-40"));
  await wait("!!window.__fake && !!document.querySelector('.rail-row')");
  await browser("press", "Meta+Comma");
  await wait("!!document.querySelector('.settings-view')");
  await read(`window.pickerTrigger = [...document.querySelectorAll('.app-select-trigger')].find(button => button.getAttribute('aria-labelledby')?.split(' ').map(id => document.getElementById(id)?.textContent ?? '').join(' ').startsWith('${label}'))`);
  // A person opens the picker with the key on its focused trigger; ui-sdk returns a programmatic opening to whatever had focus before it.
  await read("window.pickerTrigger.focus()");
  await browser("press", "Enter");
  await wait("document.activeElement?.matches('.app-combobox-input')");
  await browser("fill", ".app-combobox-input", "One");
  await capture("U3756d", `${label.toLowerCase()}-open`);
  await browser("press", "Escape");
  await wait("!document.querySelector('.app-combobox')");
  expect(await read("document.activeElement === window.pickerTrigger")).toBe(true);
  expect(await read("!!document.querySelector('.settings-view')")).toBe(true);
  await capture("U3756d", `${label.toLowerCase()}-escaped`);
}, 60_000);
