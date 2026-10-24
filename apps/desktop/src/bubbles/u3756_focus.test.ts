import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { captureDir } from "../testing/captures";
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

it.each(["empty", "dense"])("u3756a_late_door_terminal_keeps_the_newer_bubble_and_input_%s", async seed => {
  const dir = captureDir("U3756a");

  if (dir) { mkdirSync(dir, { recursive: true }); await browser("record", "start", join(dir, `${seed}.webm`)); }

  try {
  await browser("set", "viewport", "1512", "950");
  await browser("set", "media", "dark");

  if (seed === "dense") await loadDense();
  else await load();
  await browser("press", "Meta+t");
  await wait(`!!document.activeElement?.closest('.bubble') && !!window.__terminals.get('101')`);
  await read(`window.selectedWorkstream = document.querySelector('.rail-row[data-selected=true]').dataset.id`);
  await browser("keyboard", "type", "before");
  await wait(`window.__fake.app.calls.some(c => c.method === 'terminal.write')`);
  await wait(`window.__fake.app.outputSubscriptions.some(s => s.id === "101" && !s.released)`);
  await read(`window.__fake.writeOutput('101', 'BEFORE SUPERVISOR\\r\\n')`);
  await wait(`document.querySelector('.bubble[data-bubble="101"] .xterm-rows').textContent.includes('BEFORE SUPERVISOR')`);
  await capture("U3756a", `${seed}-before`);
  await read(`window.bubbleFocus = document.activeElement; window.arrive()`);
  await wait(`!!document.querySelector('.pane-screen .xterm')`);
  expect(await read(`document.activeElement === window.bubbleFocus`)).toBe(true);
  expect(await read(`document.querySelector('.rail-row[data-selected=true]').dataset.id === window.selectedWorkstream`)).toBe(true);
  expect(await read(`window.__fake.app.outputSubscriptions.some(s => s.id === "101" && !s.released)`)).toBe(true);
  expect(await read(`window.__fake.app.calls.filter(c => c.method === "terminal.close").length`)).toBe(0);
  expect(await read(`document.querySelector('.terminal-tab[data-bubble="101"]').getAttribute('aria-pressed')`)).toBe("true");
  await browser("keyboard", "type", "after");
  await wait(`window.__fake.app.calls.filter(c => c.method === 'terminal.write').map(c => atob(c.params.data)).join('') === 'beforeafter'`);
  expect(await read(`window.__fake.app.calls.filter(c => c.method === 'terminal.write').every(c => c.params.id === '101')`)).toBe(true);
  await read(`window.__fake.writeOutput('101', 'DRAWING AFTER ARRIVAL\\r\\n')`);
  await wait(`document.querySelector('.bubble[data-bubble="101"] .xterm-rows').textContent.includes('DRAWING AFTER ARRIVAL')`);
  expect(await read(`document.activeElement === window.bubbleFocus && document.activeElement.checkVisibility()`)).toBe(true);

  if (seed === "dense") await read(`window.__fake.app.handlers["terminal.write"] = () => { throw new Error("Write refused: reconnect and retry in this Terminal."); };`);

  if (seed === "dense") await browser("keyboard", "type", "!");

  if (seed === "dense") await wait(`!!document.querySelector('.bubble [role=alert]')`);
  await capture("U3756a", `${seed}-after`);

  } finally { if (dir) await browser("record", "stop"); }
}, 90_000);

const choose = async (surface: string) => {
  if (surface === "bubble") {
    await browser("press", "Meta+t");
    await wait(`!!document.activeElement?.closest('.bubble')`);
  } else if (surface === "ask") {
    await browser("press", "Meta+/");
    await wait(`document.activeElement?.matches('.ask-bar textarea')`);
    await browser("keyboard", "type", "keep this destination");
  } else if (surface === "drawer") {
    await read(`document.querySelector('.todo-row-button').click()`);
    await wait(`!!document.querySelector('.drawer[data-open=true] .todo-detail-body p[tabindex]')`);
    await browser("focus", ".todo-detail-body p[tabindex]");
    await browser("press", "Enter");
    await wait(`document.activeElement?.matches('.todo-detail-body textarea')`);
    await browser("keyboard", "type", "keep this destination");
  } else {
    await read(`document.querySelector('.rail-row[data-selected=true]').focus()`);
  }

  await read(`window.newFocus = document.activeElement; window.newText = window.newFocus.value;`);
};

it.each(["bubble", "ask", "drawer", "rail"])("u3756b_older_appearance_cannot_replace_a_newer_focus_choice_%s", async surface => {
  await loadDense();
  await choose(surface);
  await read(`window.arrive()`);
  await wait(`!!document.querySelector('.pane-screen .xterm')`);
  expect(await read(`document.activeElement === window.newFocus`)).toBe(true);
  expect(await read(`window.newFocus.value === window.newText`)).toBe(true);
  await capture("U3756b", `pane-${surface}`);
  expect(await read(`window.__fake.app.calls.filter(c => c.method === 'terminal.write').length`)).toBe(0);
}, 90_000);

const loadDense = async () => {
  await browser("open", url("/harness.html?seed=tree-40&renderer=dom"));
  await wait(`!!window.__fake && !!document.querySelector('.rail-row') && !!document.querySelector('#shelf-tab-todos')`);
  await read(`(() => {
    const app = window.__fake.app;
    const start = app.handlers['rail.startDoor'];
    app.handlers['rail.startDoor'] = params => new Promise(resolve => { window.arrive = () => resolve(start(params)); });
    const tab = document.querySelector('#shelf-tab-todos'); if (tab.getAttribute('aria-expanded') !== 'true') tab.click();
    document.querySelector('.rail-actions button').click();
  })()`);
  await wait(`!!window.arrive`);
  await read(`window.__fake.app.rpc('todo.move', { id: 1, home: document.querySelector('.rail-row[data-selected=true]').dataset.id })`);
  await wait(`!!document.querySelector('.todo-row-button')`);
};

it.each(["reply-first", "list-first"])("u3756b_a_late_user_terminal_open_keeps_the_newer_drawer_%s", async order => {
  await loadDense();
  await read(`(() => {
    const app = window.__fake.app;
    const open = app.handlers['terminal.open'];
    app.handlers['terminal.open'] = params => {
      ${order === "list-first" ? "const result = open(params);" : ""}
      return new Promise(resolve => { window.opened = () => resolve(${order === "list-first" ? "result" : "open(params)"}); });
    };
  })()`);
  await browser("press", "Meta+t");
  await wait(`!!window.opened`);
  await choose("drawer");
  await read(`window.opened()`);
  await wait(`!!document.querySelector('.terminal-tab[data-bubble="101"]')`);
  expect(await read(`document.activeElement === window.newFocus && window.newFocus.value === window.newText`)).toBe(true);
  expect(await read(`document.querySelector('.terminal-tab[data-bubble="101"]').getAttribute('aria-pressed')`)).toBe("false");
  await read(`document.querySelector('.terminal-tab[data-bubble="101"]').click()`);
  await wait(`!!document.activeElement?.closest('.bubble[data-bubble="101"]')`);
  await browser("keyboard", "type", "restored");
  await wait(`window.__fake.app.calls.filter(c => c.method === 'terminal.write').map(c => atob(c.params.data)).join('') === 'restored'`);
  expect(await read(`window.__fake.app.calls.filter(c => c.method === 'terminal.write').every(c => c.params.id === '101')`)).toBe(true);
}, 90_000);

it.each(["origin", "body"])("u3756c_returning_to_origin_or_body_does_not_rearm_old_focus_%s", async ending => {
  await load();
  await read(`window.originFocus = document.querySelector('.rail-row[data-selected=true]'); window.originFocus.focus()`);
  await choose("bubble");
  await read(`${ending === "origin" ? "window.originFocus.focus()" : "document.activeElement.blur()"}; window.expectedFocus = document.activeElement; window.arrive()`);
  await wait(`!!document.querySelector('.pane-screen .xterm')`);
  expect(await read(`document.activeElement === window.expectedFocus`)).toBe(true);
  await capture("U3756c", ending);
  expect(await read(`window.__fake.app.calls.filter(c => c.method === 'terminal.write').length`)).toBe(0);
}, 90_000);

it("u3756d_initial_and_explicit_terminal_focus_still_work", async () => {
  await load();
  await read(`window.arrive()`);
  await wait(`!!document.activeElement?.closest('.pane-screen')`);
  await browser("keyboard", "type", "initial");
  await wait(`window.__fake.app.calls.filter(c => c.method === 'terminal.write').map(c => atob(c.params.data)).join('') === 'initial'`);
  expect(await read(`window.__fake.app.calls.filter(c => c.method === 'terminal.write').every(c => c.params.id === 't-n1-1')`)).toBe(true);
  await choose("bubble");
  await browser("press", "Meta+b");
  await wait(`!!document.activeElement?.closest('.pane-screen')`);
  await browser("keyboard", "type", "selected");
  await wait(`window.__fake.app.calls.filter(c => c.method === 'terminal.write').map(c => atob(c.params.data)).join('') === 'initialselected'`);
  await capture("U3756d", "explicit-selection");
  expect(await read(`window.__fake.app.calls.filter(c => c.method === 'terminal.write').every(c => c.params.id === 't-n1-1')`)).toBe(true);
}, 90_000);

const capture = async (id: string, step: string) => {
  const dir = captureDir(id);

  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await browser("screenshot", join(dir, `${step}.png`));
  writeFileSync(join(dir, `${step}.checks.json`), JSON.stringify(await read(`window.__checks()`), null, 2));
};

it.each(["bubble", "ask", "rail", "uninterrupted"])("u3756b_older_appearance_cannot_replace_a_newer_focus_choice_rich_pad_%s", async surface => {
  await browser("open", url("/harness.html?seed=tree-40&renderer=dom"));
  await wait(`!!window.__fake && !!document.querySelector('#shelf-tab-pads')`);
  await read(`(async () => {
    const source = await (await fetch('/src/pads/PadRichEditor.tsx')).text();
    const module = source.match(/from "([^" ]*milkdown_kit_core[^" ]*)"/)[1];
    const { Editor } = await import(module);
    const make = Editor.make;
    Editor.make = () => {
      const editor = make();
      const create = editor.create;
      editor.create = () => create().then(value => new Promise(resolve => {
        window.editorReady = () => { Editor.make = make; resolve(value); };
      }));
      return editor;
    };
    const tab = document.querySelector('#shelf-tab-pads');
    if (tab.getAttribute('aria-expanded') !== 'true') tab.click();
  })()`);
  await wait(`!![...document.querySelectorAll('.pad-name')].find(e => e.textContent === 'pad-3')`);
  await read(`[...document.querySelectorAll('.pad-name')].find(e => e.textContent === 'pad-3').click()`);
  await wait(`!!window.editorReady`);

  if (surface !== "uninterrupted") {
    if (surface === "rail") await read(`document.querySelector('.rail-row').focus()`);
    else await choose(surface);
  }

  await read(`window.newFocus = document.activeElement; window.newText = window.newFocus.value; window.editorReady()`);
  // onReady installs the Pad's editor handle after the same completion that performs initial focus.
  await wait(`!!document.querySelector('.ProseMirror[contenteditable=true][aria-label="Pad body"]')`);

  if (surface === "uninterrupted") expect(await read(`document.activeElement.matches('.ProseMirror')`)).toBe(true);
  else expect(await read(`document.activeElement === window.newFocus && window.newFocus.value === window.newText`)).toBe(true);
  expect(await read(`window.__fake.app.calls.filter(c => ['pad.write','terminal.write'].includes(c.method)).length`)).toBe(0);
  await capture("U3756b", `pad-${surface}`);
}, 90_000);

it.each(["reply-first", "list-first"])("u3756d_a_delayed_user_terminal_takes_focus_without_newer_navigation_%s", async order => {
  await load();
  await read(`(() => {
    const app = window.__fake.app;
    const open = app.handlers['terminal.open'];
    app.handlers['terminal.open'] = params => {
      ${order === "list-first" ? "const result = open(params);" : ""}
      return new Promise(resolve => { window.opened = () => resolve(${order === "list-first" ? "result" : "open(params)"}); });
    };
  })()`);
  await browser("press", "Meta+t");
  await wait(`!!window.opened`);
  await read(`window.opened()`);
  await wait(`!!document.activeElement?.closest('.bubble[data-bubble="101"]')`);
  await browser("keyboard", "type", "initial bubble");
  await wait(`window.__fake.app.calls.filter(c => c.method === 'terminal.write').map(c => atob(c.params.data)).join('') === 'initial bubble'`);
  expect(await read(`window.__fake.app.calls.filter(c => c.method === 'terminal.write').every(c => c.params.id === '101')`)).toBe(true);
}, 90_000);

// Hold the native microtask boundary after the actual App action; the test replaces no focus owner.
it.each(["timeline", "agent-editor", "ask"])("u3756b_a_queued_appearance_yields_to_a_newer_rail_choice_%s", async appearance => {
  await loadDense();
  await read(`window.arrive()`);
  await wait(`!!document.querySelector('.pane-screen .xterm')`);

  if (appearance === "switcher") {
    await browser("press", "Meta+k");
    await wait(`!!document.querySelector('.leader')`);
  }

  await read(`(() => {
    const queued = [];
    const queue = window.queueMicrotask;
    window.queueMicrotask = task => queued.push(task);
    try {
      ${appearance === "timeline" ? "document.querySelectorAll('.measurement-action button')[1].click();" : appearance === "agent-editor" ? "document.querySelector('.rail-row[data-selected=true]').dispatchEvent(new KeyboardEvent('keydown', { key: 'N', code: 'KeyN', metaKey: true, shiftKey: true, bubbles: true }));" : appearance === "switcher" ? "document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', bubbles: true }));" : "document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: '/', code: 'Slash', metaKey: true, bubbles: true }));"}
    } finally { window.queueMicrotask = queue; }
    window.queuedCount = queued.length;
    const chosen = document.querySelector('.rail-row[data-selected=true]');
    chosen.focus();
    window.newFocus = chosen;
    queued.forEach(task => queue(task));
  })()`);
  // The App's queued callbacks run before this browser evaluation, after its input task ends.
  expect(await read(`window.queuedCount`)).toBeGreaterThan(0);
  expect(await read(`!!document.querySelector(${JSON.stringify(appearance === "timeline" ? ".timeline-view" : appearance === "agent-editor" ? ".spawn-prompt-field" : appearance === "switcher" ? ".switcher" : '.ask-bar[data-mode="over"]')})`)).toBe(true);
  expect(await read(`document.activeElement === window.newFocus`)).toBe(true);
  expect(await read(`window.__fake.app.calls.filter(c => c.method === 'terminal.write').length`)).toBe(0);
}, 90_000);

it("u3756d_explicit_start_focuses_the_selected_supervisor_terminal", async () => {
  await browser("open", url("/harness.html?seed=tree-40&renderer=dom"));
  await wait(`!!document.querySelector('.rail-row[data-id=backend]')`);
  await browser("click", ".rail-row[data-id=backend]");
  await wait(`!!document.querySelector('.pane-action')`);
  await browser("click", ".pane-action");
  await wait(`!!document.querySelector('.pane-screen .xterm')`);
  expect(await read(`!!document.activeElement.closest('.pane-screen')`)).toBe(true);
  await browser("keyboard", "type", "started");
  await wait(`window.__fake.app.calls.filter(c => c.method === 'terminal.write').map(c => atob(c.params.data)).join('') === 'started'`);
  expect(await read(`window.__fake.app.calls.filter(c => c.method === 'terminal.write').every(c => c.params.id === 't-backend-1')`)).toBe(true);
}, 90_000);

it("u3756c_a_new_drawer_editor_mount_leaves_body_focus_unclaimed_by_the_older_terminal", async () => {
  await loadDense();
  await read(`document.querySelector('.todo-row-button').click()`);
  await wait(`!!document.querySelector('.todo-detail-body p[tabindex]')`);
  await browser("focus", ".todo-detail-body p[tabindex]");
  await read(`(() => {
    const queued = [];
    const queue = window.queueMicrotask;
    window.queueMicrotask = task => queued.push(task);
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
    window.queueMicrotask = queue;
    window.editorMounted = document.querySelector('.todo-detail-body textarea');
    window.restoreEditor = () => queued.forEach(task => queue(task));
  })()`);
  expect(await read(`!!window.editorMounted && document.activeElement === document.body`)).toBe(true);
  const body = await read(`window.editorMounted.value`);
  await read(`window.arrive()`);
  await wait(`!!document.querySelector('.pane-screen .xterm')`);
  expect(await read(`document.activeElement === document.body && document.querySelector('.drawer').dataset.open === 'true'`)).toBe(true);
  await read(`window.restoreEditor()`);
  await wait(`document.activeElement === window.editorMounted`);
  expect(await read(`window.editorMounted.value`)).toBe(body);
  expect(await read(`window.__fake.app.calls.filter(c => c.method === 'terminal.write').length`)).toBe(0);
}, 90_000);

it.each(["rail", "bubble", "uninterrupted"])("u3756b_a_deferred_changed_file_tree_keeps_the_newer_focus_choice_%s", async surface => {
  await browser("open", url("/harness.html?seed=tree-40&renderer=dom"));
  await wait(`!!window.__fake && !!document.querySelector('.rail-row[data-id=migrate]')`);
  await read(`(() => {
    const app = window.__fake.app;
    const tree = app.handlers['rail.tree'];
    app.handlers['rail.tree'] = () => tree().map(row => row.id === 'migrate' ? { ...row, worktree: { path: '/project/worktree', branch: 'roundup/test', base: 'main' } } : row);
    app.handlers['agent.worktreeState'] = () => ({ ahead: 1, behind: 0, dirty: true });
    app.handlers['agent.changedFiles'] = () => new Promise(resolve => { window.filesReady = () => resolve({ files: [{ path: 'changed.ts', status: 'modified', line: 1 }] }); });
    window.__fake.emit({ actor: { kind: 'user', id: 'you', parent: null }, name: 'rail.changed' });
  })()`);
  await browser("click", ".rail-row[data-id=migrate]");
  await wait(`!!document.querySelector('.worktree-control')`);
  await browser("click", ".worktree-control");
  await wait(`!!window.filesReady`);

  if (surface === "rail") await read(`document.querySelector('.rail-row[data-id=migrate]').focus()`);
  else if (surface === "bubble") await choose("bubble");
  await read(`window.newFocus = document.activeElement; window.filesReady()`);
  await wait(`!!document.querySelector('file-tree-container')?.shadowRoot?.querySelector('[data-item-path]')`);

  if (surface !== "uninterrupted") expect(await read(`document.activeElement === window.newFocus`)).toBe(true);
  else expect(await read(`document.activeElement === document.querySelector('file-tree-container')`)).toBe(true);
  expect(await read(`window.__fake.app.calls.filter(c => c.method === 'terminal.write').length`)).toBe(0);
}, 90_000);

it("u3756b_the_switcher_queued_focus_yields_after_its_mount", async () => {
  await loadDense();
  await read(`window.arrive()`);
  await wait(`!!document.querySelector('.pane-screen .xterm')`);
  await browser("press", "Meta+k");
  await wait(`!!document.querySelector('.leader')`);
  await read(`(() => {
    const queue = window.queueMicrotask;
    window.queueMicrotask = task => queue(() => {
      if (!window.newFocus && document.querySelector('.switcher input')) {
        window.newFocus = document.querySelector('.rail-row[data-selected=true]');
        window.newFocus.focus();
      }
      task();
    });
    window.restoreQueue = () => { window.queueMicrotask = queue; };
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', bubbles: true, cancelable: true }));
  })()`);
  await wait(`!!window.newFocus`);
  await read(`window.restoreQueue()`);
  expect(await read(`document.activeElement === window.newFocus`)).toBe(true);
  expect(await read(`window.__fake.app.calls.filter(c => c.method === 'terminal.write').length`)).toBe(0);
}, 90_000);

const holdFrames = async () => read(`(() => {
  const request = window.requestAnimationFrame;
  const cancel = window.cancelAnimationFrame;
  const frames = new Map();
  let next = -1;
  window.requestAnimationFrame = callback => { const id = next--; frames.set(id, callback); return id; };
  window.cancelAnimationFrame = id => { if (!frames.delete(id)) cancel(id); };
  window.releaseFrames = () => new Promise(resolve => {
    window.requestAnimationFrame = request;
    window.cancelAnimationFrame = cancel;
    request(time => { for (const callback of frames.values()) callback(time); resolve(frames.size); });
  });
})()`);

it.each(["initial", "return"])("u3756b_a_select_focus_frame_yields_to_the_newer_rail_choice_%s", async phase => {
  await browser("open", url("/harness.html?seed=tree-40&renderer=dom"));
  await wait(`!!window.__fake && !!document.querySelector('.rail-row')`);
  await browser("press", "Meta+Comma");
  await wait(`!!document.querySelector('.settings-view .app-select-trigger')`);

  if (phase === "return") {
    await read(`document.querySelector('.settings-view [role=combobox]').click()`);
    await wait(`!!document.activeElement?.closest('.app-select-list')`);
  }

  await holdFrames();
  await read(`${phase === "initial" ? "document.querySelector('.settings-view .app-select-trigger').click()" : "document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }))"}; document.querySelector('.rail-row').focus(); window.newFocus = document.activeElement;`);
  expect(await read<number>(`window.releaseFrames()`)).toBeGreaterThan(0);
  expect(await read(`document.activeElement === window.newFocus`)).toBe(true);
}, 90_000);

it.each(["owner", "home"])("u3756b_a_menu_focus_frame_yields_to_a_newer_rail_choice_%s", async kind => {
  if (kind === "owner") await loadDense();
  else {
    await browser("open", url("/harness.html?seed=agents-10&renderer=dom"));
    await wait(`!!window.__fake && !!document.querySelector('.rail [data-id="agent-1"]')`);
    await read(`(async () => {
      window.__fake.actAs({ kind: 'agent', id: 'agent-1', parent: null });
      await window.__fake.app.rpc('todo.create', { title: 'Move this Todo', body: null, blockers: null });
      window.__fake.actAs({ kind: 'user', id: 'you', parent: null });
    })()`);
    await wait(`!!document.querySelector('.rail [data-id="agent-1"] [data-pads-control]')`);
    await browser("click", '.rail [data-id="agent-1"] [data-pads-control]');
    await wait(`!!document.querySelector('.todo-move')`);
  }

  await browser("focus", ".todo-row-button");
  await holdFrames();
  await read(`${kind === "owner" ? "document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'o', code: 'KeyO', bubbles: true, cancelable: true }))" : "document.querySelector('.todo-move').click()"}; document.querySelector('.rail-row').focus(); window.newFocus = document.activeElement;`);
  expect(await read<number>(`window.releaseFrames()`)).toBeGreaterThan(0);
  expect(await read(`document.activeElement === window.newFocus`)).toBe(true);
}, 90_000);

it("u3756b_a_terminal_name_return_frame_yields_to_the_newer_ask_bar", async () => {
  await load();
  await choose("bubble");
  await browser("dblclick", '.terminal-tab[data-bubble="101"] .terminal-tab-name');
  await wait(`document.activeElement?.matches('.terminal-tab-editor input')`);
  await holdFrames();
  await read(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }))`);
  await choose("ask");
  expect(await read<number>(`window.releaseFrames()`)).toBeGreaterThan(0);
  expect(await read(`document.activeElement === window.newFocus && window.newFocus.value === window.newText`)).toBe(true);
}, 90_000);
