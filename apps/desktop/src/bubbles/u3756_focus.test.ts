import { expect, it } from "vitest";
import { browser, read, url, wait } from "../ui/tabsBrowser";

const load = async () => {
  await browser("set", "viewport", "1512", "950");
  await browser("set", "media", "dark");
  await browser("open", url("/harness.html?seed=empty-project&renderer=dom"));
  await wait(`!!window.__fake && !!document.querySelector('.pane-action')`);
  await read(`(() => {
    const app = window.__fake.app;
    const start = app.handlers['rail.startDoor'];
    app.handlers['rail.startDoor'] = params => new Promise(resolve => { window.arrive = () => resolve(start(params)); });
    document.querySelector('.pane-action').click();
  })()`);
  await wait(`!!window.arrive && !!document.querySelector('.rail-row[data-selected=true]')`);
};

it("u3756a_late_door_terminal_keeps_the_newer_bubble_and_input", async () => {
  await load();
  await browser("press", "Meta+t");
  await wait(`!!document.activeElement?.closest('.bubble') && !!window.__terminals.get('101')`);
  await browser("keyboard", "type", "before");
  await wait(`window.__fake.app.calls.some(c => c.method === 'terminal.write')`);
  await read(`window.bubbleFocus = document.activeElement; window.arrive()`);
  await wait(`!!document.querySelector('.pane-screen .xterm')`);
  expect(await read(`document.activeElement === window.bubbleFocus`)).toBe(true);
  expect(await read(`document.querySelector('.terminal-tab[data-bubble="101"]').getAttribute('aria-pressed')`)).toBe("true");
  await browser("keyboard", "type", "after");
  await wait(`window.__fake.app.calls.filter(c => c.method === 'terminal.write').map(c => c.params.bytes).join('').length > 0`);
  expect(await read(`window.__fake.app.calls.filter(c => c.method === 'terminal.write').every(c => c.params.id === '101')`)).toBe(true);
  await read(`window.__fake.writeOutput('101', 'DRAWING AFTER ARRIVAL\\r\\n')`);
  await wait(`document.querySelector('.bubble[data-bubble="101"] .xterm-rows').textContent.includes('DRAWING AFTER ARRIVAL')`);
  expect(await read(`document.activeElement === window.bubbleFocus && document.activeElement.checkVisibility()`)).toBe(true);
}, 90_000);
