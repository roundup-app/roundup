import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { captureDir } from "../testing/captures";
import { expect, it } from "vitest";
import { browser, read, wait } from "../ui/tabsBrowser";
import { capture, load, openTodo } from "./u3756_support";

it.each(["empty-project", "tree-40"])("u3756a_late_door_terminal_keeps_the_newer_bubble_and_input_%s", async seed => {
  const dir = captureDir("U3756a");

  const recording = dir && !process.env.U3756_BASELINE;

  if (recording) await mkdir(dir, { recursive: true });
  await load(seed, recording ? join(dir, `${seed}.webm`) : undefined);

  try {

  await browser("press", "Meta+t");
  await wait(`!!document.activeElement?.closest('.bubble') && !!window.__terminals.get('101')`);
  await read(`window.selectedWorkstream = document.querySelector('.rail-row[data-selected]').dataset.id`);
  await browser("keyboard", "type", "before");
  await wait(`window.__fake.app.calls.some(c => c.method === 'terminal.write')`);
  await read(`window.__fake.writeOutput('101', 'DRAWING BEFORE ARRIVAL' + String.fromCharCode(13, 10))`);
  await wait(`document.querySelector('.bubble[data-bubble="101"] .xterm-rows').textContent.includes('DRAWING BEFORE ARRIVAL')`);
  await capture("U3756a", `${seed}-before`);
  await read(`window.bubbleFocus = document.activeElement; window.arrive()`);
  await wait(`!!document.querySelector('.pane-screen .xterm')`);
  await capture("U3756a", `${seed}-arrived`);
  expect(await read(`document.activeElement === window.bubbleFocus`)).toBe(true);
  expect(await read(`document.querySelector('.rail-row[data-selected]').dataset.id === window.selectedWorkstream`)).toBe(true);
  expect(await read(`window.__fake.app.outputSubscriptions.some(s => s.id === '101' && !s.released)`)).toBe(true);
  expect(await read(`window.__fake.app.calls.filter(c => c.method === 'terminal.close')`)).toEqual([]);
  expect(await read(`document.querySelector('.terminal-tab[data-bubble="101"]').getAttribute('aria-pressed')`)).toBe("true");
  await browser("keyboard", "type", "after");
  await wait(`window.__fake.app.calls.filter(c => c.method === 'terminal.write').map(c => atob(c.params.data)).join('') === 'beforeafter'`);
  expect(await read(`window.__fake.app.calls.filter(c => c.method === 'terminal.write').every(c => c.params.id === '101')`)).toBe(true);
  await read(`window.__fake.writeOutput('101', 'DRAWING AFTER ARRIVAL' + String.fromCharCode(13, 10))`);
  await wait(`document.querySelector('.bubble[data-bubble="101"] .xterm-rows').textContent.includes('DRAWING AFTER ARRIVAL')`);
  expect(await read(`document.activeElement === window.bubbleFocus && document.activeElement.checkVisibility()`)).toBe(true);
  await capture("U3756a", `${seed}-after`);

  if (seed === "tree-40") {
    await read(`document.querySelector('.terminal-tab[data-bubble="101"]').click()`);
    await wait(`document.querySelector('.terminal-tab[data-bubble="101"]').getAttribute('aria-pressed') === 'false'`);
    await read(`window.__fake.app.handlers['terminal.open'] = () => { throw new Error('Terminal could not open: retry New Terminal'); }`);
    await browser("press", "Meta+t");
    await wait(`document.querySelector('.bubbles [role=alert]')?.textContent.includes('Terminal could not open: retry New Terminal')`);
    await capture("U3756a", "tree-40-failure");
  }
  } finally { if (recording) await browser("record", "stop"); }
}, 90_000);

it("u3756c_a_new_drawer_editor_mount_keeps_body_unclaimed_by_the_older_terminal", async () => {
  await load();
  await openTodo("Mounted editor");
  await read(`(() => {
    const queue = window.queueMicrotask, queued = [];
    window.queueMicrotask = task => queued.push(task);
    document.querySelector('.drawer .todo-detail-title p[tabindex]').focus();
    document.querySelector('.drawer .todo-detail-title p[tabindex]').dispatchEvent(new MouseEvent('dblclick', {bubbles:true}));
    window.__flush();
    window.queueMicrotask = queue;
    window.editorMounted = document.querySelector('.drawer textarea');
    window.restoreEditor = () => queued.forEach(task => queue(task));
  })()`);
  expect(await read(`!!window.editorMounted && document.activeElement === document.body`)).toBe(true);
  await read(`window.arrive()`);
  await wait(`!!document.querySelector('.pane-screen .xterm')`);
  expect(await read(`document.activeElement === document.body`)).toBe(true);
  await read(`window.restoreEditor()`);
  await wait(`document.activeElement === window.editorMounted`);
  expect(await read(`window.__fake.app.calls.filter(c => c.method === 'terminal.write')`)).toEqual([]);
}, 90_000);
