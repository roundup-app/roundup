import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { captureDir } from "../testing/captures";
import { expect } from "vitest";
import { browser, read, url, wait } from "../ui/tabsBrowser";

export const capture = async (id: string, step: string) => {
  const root = captureDir(id);
  const paired = id === "U3756a" && /-(before|arrived)$/.test(step);
  const dir = root && (paired ? join(root, process.env.U3756_BASELINE ? "base" : "head") : root);

  if (!dir) return;
  await mkdir(dir, { recursive: true });
  await browser("screenshot", join(dir, `${step}.png`));
  await writeFile(join(dir, `${step}.checks.json`), JSON.stringify(await read(`window.__checks()`), null, 2));
};

// One CLI connection for the three setup commands; each still runs in order and a failed one stops the batch.
const opened = (seed: string) => browser("batch", "--bail", "set viewport 1512 950", "set media dark", `open '${url(`/harness.html?seed=${seed}&renderer=dom`, process.env.U3756_BASELINE === "1")}'`);

export const load = async (seed = "empty-project", recording?: string) => {
  await opened(seed);

  // agent-browser start creates a new context and drops media emulation; restart records this dark context.
  if (recording) await browser("record", "restart", recording);

  await wait(`!!window.__fake && !!document.querySelector('.rail-actions [data-button="add"]')`);
  await read(`(() => {
    const app = window.__fake.app;
    const start = app.handlers['rail.startDoor'];
    app.handlers['rail.startDoor'] = params => new Promise(resolve => { window.arrive = () => resolve(start(params)); });
    document.querySelector('.rail-actions [data-button="add"]').click();
  })()`);

  if (!process.env.U3756_BASELINE) {
    await wait(`!!document.querySelector('[role=menuitem][data-value=workstream]')`);
    await browser("click", "[role=menuitem][data-value=workstream]");
  }

  await wait(`!!window.arrive && !!document.querySelector('.rail-row[data-selected]')`);
};

export const fresh = async (seed = "selection") => {
  await opened(seed);
  await wait(`!!window.__fake && !!document.querySelector('.terminal-new')`);
};

export const openTodo = async (title: string) => {
  await read(`(async () => {
    const app = window.__fake.app;
    const made = await app.rpc('todo.create', {title:${JSON.stringify(title)},body:null,blockers:null});
    app.handlers['link.read'] = () => ({kind:'todo',id:String(made.id),todo:made});
    app.nativeOpen({kind:'link',url:'roundup://todo/'+made.id+'?project=project-0000000000000000'});
  })()`);
  await wait(`!!document.querySelector('.drawer[data-open=true] .todo-detail-title p[tabindex]')`);
};

export const newer = async (choice: string) => {
  if (choice === "bubble") {
    await browser("press", "Meta+t");
    await wait(`!!document.activeElement?.closest('.bubble')`);
  } else if (choice === "ask") {
    await browser("press", "Meta+/");
    await wait(`document.activeElement?.matches('.ask-field') || !!document.activeElement?.closest('.ask-bar')`);
  } else if (choice === "drawer") {
    await openTodo("Newer Drawer");
    await wait(`!!document.querySelector('.drawer .todo-add-notes')`);
    await read(`document.querySelector('.drawer .todo-add-notes').click()`);
    await wait(`!!document.querySelector('.drawer textarea')`);
    await read(`document.querySelector('.drawer textarea').focus()`);
    await browser('keyboard', 'type', ' exact newer drawer é 😀 '); // taste-skill-ignore: Unicode draft probe, not interface decoration.
  } else {
    await read(`document.querySelector('.rail-row:not([data-selected])[tabindex], .rail-row[tabindex], .rail-row [tabindex], .rail [role=treeitem][tabindex]')?.focus()`);
    expect(await read(`!!document.activeElement?.closest('.rail') && document.activeElement.matches('[tabindex]')`)).toBe(true);
  }

  await read(`window.newerFocus = document.activeElement; window.newerText = document.activeElement.value ?? document.activeElement.textContent`);
};

export const lateUserTerminalOpen = async (listFirst: boolean, intervene: boolean) => {
  await fresh();
  await read(`(() => {
    const app = window.__fake.app, open = app.handlers['terminal.open'];
    app.handlers['terminal.open'] = params => new Promise(resolve => {
      ${listFirst ? "const result = open(params); window.finishOpen = () => resolve(result);" : "window.finishOpen = () => resolve(open(params));"}
    });
  })()`);
  await browser("press", "Meta+t");
  await wait(`!!window.finishOpen`);

  if (intervene) await newer("drawer");
  await read(`window.finishOpen()`);
  await wait(`!!document.querySelector('.terminal-tab[data-bubble="101"]')`);
  // The wanted effect queues Bubble focus after list reconciliation (Bubbles.tsx).
  await read(`new Promise(resolve => queueMicrotask(resolve))`);

  if (intervene) {
    expect(await read(`document.activeElement === window.newerFocus && (document.activeElement.value ?? document.activeElement.textContent) === window.newerText`)).toBe(true);
    await read(`document.querySelector('.terminal-tab[data-bubble="101"]').click()`);
    await wait(`!!document.activeElement?.closest('.bubble[data-bubble="101"]')`);
  } else await wait(`!!document.activeElement?.closest('.bubble[data-bubble="101"]')`);
  await browser("keyboard", "type", "one");
  await wait(`window.__fake.app.calls.filter(c => c.method === 'terminal.write').map(c => atob(c.params.data)).join('') === 'one'`);
  expect(await read(`({ text:window.__fake.app.calls.filter(c => c.method === 'terminal.write').map(c => atob(c.params.data)).join(''), same:window.__fake.app.calls.filter(c => c.method === 'terminal.write').every(c => c.params.id === '101') })`)).toEqual({text:"one",same:true});
};

export const richPadInitialization = async (intervene: boolean) => {
  await fresh();
  await read(`(() => {
    const app = window.__fake.app, read = app.handlers['pad.read'];
    app.handlers['pad.read'] = params => new Promise(resolve => { window.finishPad = () => resolve(read(params)); });
    const tab = document.querySelector('#shelf-tab-pads[role=tab]'); if (tab.getAttribute('aria-expanded') !== 'true') tab.click();
  })()`);
  await wait(`!!document.querySelector('.pad-name')`);
  await read(`document.querySelector('[data-pad="pad-3"] .pad-name').closest('.shelf-group-body[data-closed]')?.closest('[data-shelf-group]').querySelector('.shelf-group-control').click()`);
  await wait(`!document.querySelector('[data-pad="pad-3"] .pad-name').closest('.shelf-group-body[data-closed]')`);
  await browser("click", '[data-pad="pad-3"] .pad-name');
  await wait(`document.activeElement === document.querySelector('[data-pad="pad-3"] .pad-name')`);
  await browser("press", "Enter");
  await wait(`!!window.finishPad`);

  if (intervene) await newer("bubble");
  await read(`window.finishPad()`);
  await wait(`!!document.querySelector('.drawer .ProseMirror[contenteditable=true]')`);
  // Milkdown's onReady follows its create promise; the editor's toolbar is initialized before focus.
  await wait(`!!document.querySelector('.drawer .milkdown-toolbar') || !!document.querySelector('.drawer [aria-label="Pad body"]')`);

  if (intervene) expect(await read(`document.activeElement === window.newerFocus`)).toBe(true);
  else expect(await read(`!!document.activeElement?.closest('.ProseMirror')`)).toBe(true);
};
