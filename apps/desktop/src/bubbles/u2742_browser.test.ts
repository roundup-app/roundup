import { copy as appCopy } from "../app/copy";
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, expect, it } from "vitest";
import { appServer } from "../testing/appServer";
import type { AppServer } from "../testing/appServer";

const exec = promisify(execFile);

const profile = mkdtempSync(join(tmpdir(), "u2742-"));

const session = `u2742-${process.pid}`;

let server: AppServer;

let origin: string;

const browser = async (...args: string[]) => (await exec("agent-browser", ["--session", session, "--json", ...args], { maxBuffer: 8 * 1024 * 1024, timeout: 30_000 })).stdout;

const read = async <T,>(expression: string): Promise<T> => {
  // SAFETY: agent-browser owns this result envelope; expressions below are constant harness observations.
  const reply = JSON.parse(await browser("eval", expression)) as { success: boolean; data: { result: T }; error?: string };

  if (!reply.success) throw new Error(reply.error);

  return reply.data.result;
};

const wait = async (predicate: string) => { await browser("wait", "--fn", predicate); };

const focused = (id: string) => `document.activeElement?.closest('[data-bubble="${id}"]') !== null`;

const key = async () => { await browser("press", "Meta+b"); };

beforeAll(async () => {
  server = await appServer();
  origin = server.resolvedUrls.local[0]!;
  await browser("--profile", profile, "open", new URL("/harness.html?view=workstreams&items=1&tabs=1&seed=bubbles", origin).href);
  await browser("set", "viewport", "1512", "950");
}, 90_000);

afterAll(async () => {
  try { await browser("close"); } finally { await server?.close(); rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
}, 60_000);

const start = async () => {
  await browser("open", new URL("/harness.html?view=workstreams&items=1&tabs=1&seed=bubbles", origin).href);
  await wait(`!!window.__fake && !!document.querySelector('[data-id="runner"]')`);
  await read(`document.querySelector('[data-id="runner"]').click()`);
  await wait(`!!document.querySelector('.pane-screen .xterm-helper-textarea') && !!document.querySelector('.terminal-tab[data-bubble="101"]')`);
  await read(`document.querySelector('.pane-screen .xterm-helper-textarea').focus()`);
  await read(`window.__switchStart = window.__fake.app.calls.length`);
};

it("u2742c_round_trips_type_only_into_the_focused_terminal", async () => {
  await start();

  for (let round = 0; round < 3; round++) {
    await key();
    await wait(focused("103"));
    await browser("keyboard", "type", "bubble");
    await wait(`window.__fake.app.calls.some(c => c.method === 'terminal.write' && c.params.id === '103')`);
    await key();
    await wait(`!!document.activeElement?.closest('.pane-screen') && !document.querySelector('.bubble:not([hidden])')`);
    await browser("keyboard", "type", "agent");
    await wait(`window.__fake.app.calls.some(c => c.method === 'terminal.write' && c.params.id === 't-runner')`);
  }

  expect(await read(`(() => {
    const calls = window.__fake.app.calls.slice(window.__switchStart);
    const text = id => calls.filter(c => c.method === 'terminal.write' && c.params.id === id).map(c => atob(c.params.data)).join('');
    return { bubble: text('103'), agent: text('t-runner'), lifecycle: calls.filter(c => ['terminal.open','terminal.close'].includes(c.method)), selected: document.querySelector('.rail-row[aria-selected=true]')?.dataset.id };
  })()`)).toEqual({ bubble: "bubblebubblebubble", agent: "agentagentagent", lifecycle: [], selected: "runner" });
}, 120_000);

it("u2742c_targets_stay_eligible_in_the_current_project", async () => {
  await start();
  // A focused tab takes precedence over the newest-started fallback (103).
  await read(`document.querySelector('button.terminal-tab[data-bubble="101"]').focus()`);
  await key();
  await wait(focused("101"));
  await key();
  await wait(`!!document.activeElement?.closest('.pane-screen')`);
  await key();
  await wait(focused("101"));
  // Removing the last-used target leaves the newest eligible Terminal as fallback.
  await read(`window.__fake.app.rpc('terminal.close', {id:'101'})`);
  await wait(`!document.querySelector('button.terminal-tab[data-bubble="101"]')`);
  await read(`document.querySelector('.pane-screen textarea').focus()`);
  await key();
  await wait(focused("103"));
  // The dense sibling has eight private Terminals; none is eligible from runner.
  expect(await read(`([...document.querySelectorAll('.terminal-tab')].map(e => e.dataset.bubble))`)).toEqual(["102", "103"]);
  await read(`window.__fake.app.exitDaemon({code:1})`);
  await wait(`document.body.textContent.includes(${JSON.stringify(appCopy.daemonExit("exited 1"))})`);
  const before = await read(`window.__fake.app.calls.length`);
  await key();
  expect(await read(`window.__fake.app.calls.length`)).toBe(before);
}, 120_000);

it("u2742d_switch_respects_repeat_modifiers_and_focus_ownership", async () => {
  await start();
  await key();
  await wait(focused("103"));
  // Repeats may arrive after focus moved; they must not switch it back or reach xterm.
  await read(`(() => {
    const press = init => document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'b',code:'KeyB',metaKey:true,bubbles:true,cancelable:true,...init}));
    window.__repeatTaken = !press({repeat:true});
    window.__extraTaken = [press({shiftKey:true}),press({ctrlKey:true}),press({altKey:true})];
  })()`);
  expect(await read(`({taken:window.__repeatTaken, extra:window.__extraTaken, bubble:document.activeElement.closest('.bubble')?.dataset.bubble})`)).toEqual({ taken: true, extra: [true, true, true], bubble: "103" });
  await read(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'B',code:'KeyB',metaKey:true,modifierCapsLock:true,bubbles:true,cancelable:true}))`);
  await wait(`!!document.activeElement?.closest('.pane-screen')`);
  await key();
  await wait(focused("103"));
  await browser("press", "Escape");
  await wait(`window.__fake.app.calls.some(c => c.method === 'terminal.write' && c.params.id === '103' && atob(c.params.data) === '\\x1b')`);

  // Requested navigation and the window title still receive an outside press.
  for (const target of [".window-title", ".project-tab[data-selected] .tab-name-button"]) {

    await read(`(() => {
      window.__outsidePresses = 0;
      document.querySelector('${target}').addEventListener('pointerdown', () => window.__outsidePresses++, {once:true});
      window.__outsideStart = window.__fake.app.calls.length;
    })()`);
    const at = await read<{ x: number; y: number }>(`(() => { const r = document.querySelector('${target}').getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);

    await browser("mouse", "move", String(Math.round(at.x)), String(Math.round(at.y)));
    await browser("mouse", "down", "left");
    await browser("mouse", "up", "left");
    await wait(`!document.querySelector('.bubble:not([hidden])')`);
    expect(await read(`({presses:window.__outsidePresses, mutations:window.__fake.app.calls.slice(window.__outsideStart).filter(c => ['terminal.open','terminal.close','terminal.write','agent.prompt'].includes(c.method))})`), target).toEqual({ presses: 1, mutations: [] });
    await browser("click", '.terminal-tab[data-bubble="103"]');
    await wait(focused("103"));
  }

  // The real tab rename field owns ⌘B; it must never be mistaken for a Terminal tab.
  await read(`document.querySelector('.terminal-tab[data-bubble="103"] .terminal-tab-name').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))`);
  await wait(`!!document.querySelector('.terminal-tab-editor input')`);
  await key();
  expect(await read(`!!document.activeElement?.closest('.terminal-tab-editor')`)).toBe(true);
  await browser("press", "Escape");
  await read(`document.querySelector('[data-id="runner"]').focus()`);
  await read(`window.__helpReturn = document.activeElement; window.__helpStart = window.__fake.app.calls.length`);
  await browser("press", "?");
  await wait(`!!document.querySelector('.help')`);
  await key();
  expect(await read(`!!document.activeElement?.closest('.help')`)).toBe(true);
  await browser("press", "Escape");
  await wait(`!document.querySelector('.help') && document.activeElement === window.__helpReturn`);
  expect(await read(`window.__fake.app.calls.slice(window.__helpStart).filter(c => ['terminal.open','terminal.close','terminal.write','agent.prompt'].includes(c.method))`)).toEqual([]);
  await browser("open", new URL("/harness.html?view=workstreams&items=1&tabs=1&seed=tree-40", origin).href);
  await wait(`!!document.querySelector('#shelf-tab-pads')`);
  await browser("click", "#shelf-tab-pads");
  await wait(`document.querySelectorAll('[data-shelf-row] .pad-name').length === 4`);
  await read(`[...document.querySelectorAll('[data-shelf-row] .pad-name')].find(row => row.textContent === "pad-3").focus()`);
  await browser("wait", "--fn", "document.activeElement?.matches('.pad-name')");
  await browser("press", "Enter");
  await wait(`!!document.querySelector('.ProseMirror[contenteditable=true]')`);
  await browser("focus", ".ProseMirror");
  await key();
  expect(await read(`!!document.activeElement?.closest('.ProseMirror')`)).toBe(true);
}, 120_000);

it("u2742d_round_trip_preserves_work", async () => {
  await start();
  await key();
  await wait(focused("103"));
  await read(`(() => {
    window.__keptEmulator = window.__terminals.get('103');
    window.__fake.writeOutput('103', Array.from({length:180},(_,i) => 'running command line '+i+'\\r\\n').join(''));
    window.__fake.app.handlers['terminal.write'] = ({id,data}) => { window.__fake.writeOutput(id, atob(data)); return null; };
  })()`);
  await browser("keyboard", "type", "unfinished-input");
  await wait(`window.__fake.app.calls.some(c => c.method === 'terminal.write' && c.params.id === '103')`);
  await read(`new Promise(resolve => window.__terminals.get('103').write(new Uint8Array(), resolve))`);
  await browser("press", "Shift+PageUp");
  await wait(`!window.__terminals.get('103').isAtBottom()`);
  await read(`(() => {
    window.__keptPlace = JSON.parse(sessionStorage.getItem('roundup:bubble-places:/Users/you/harness'))['103'];
    window.__keptCalls = window.__fake.app.calls.length;
    window.__keptTerminal = window.__fake.app.handlers['terminal.list'](null).find(t => t.id === '103');
    window.__keptScreen = document.querySelector('.bubble[data-bubble="103"] .xterm-screen');
  })()`);
  await key();
  await wait(`!!document.activeElement?.closest('.pane-screen')`);
  await key();
  await wait(focused("103"));
  expect(await read(`(() => {
    const terminal = window.__fake.app.handlers['terminal.list'](null).find(t => t.id === '103');
    const place = JSON.parse(sessionStorage.getItem('roundup:bubble-places:/Users/you/harness'))['103'];
    return {emulator:window.__keptEmulator === window.__terminals.get('103'), screen:window.__keptScreen === document.querySelector('.bubble[data-bubble="103"] .xterm-screen'), scrolled:!window.__terminals.get('103').isAtBottom(), place:JSON.stringify(place) === JSON.stringify(window.__keptPlace), terminal:JSON.stringify(terminal) === JSON.stringify(window.__keptTerminal), mutations:window.__fake.app.calls.slice(window.__keptCalls).filter(c => ['terminal.open','terminal.close','terminal.write'].includes(c.method))};
  })()`)).toEqual({ emulator: true, screen: true, scrolled: true, place: true, terminal: true, mutations: [] });
  await browser("press", "Enter");
  await wait(`window.__fake.app.calls.slice(window.__keptCalls).some(c => c.method === 'terminal.write' && atob(c.params.data) === '\\r')`);
}, 120_000);

it("u2742c_project_switches_do_not_reuse_a_previous_projects_target", async () => {
  await browser("open", new URL("/harness.html?view=workstreams&items=1&tabs=1&seed=tabs-8", origin).href);
  await wait(`!!document.querySelector('.project-tab[data-path="/Users/you/project-number-2"] .tab-name-button')`);
  await read(`document.querySelector('.project-tab[data-path="/Users/you/project-number-2"] .tab-name-button').click()`);
  await wait(`!!document.querySelector('.rail-row[data-id="p2-agent"]')`);
  await read(`document.querySelector('.rail-row[data-id="p2-agent"]').click()`);
  await wait(`!!document.querySelector('.pane-screen textarea')`);
  await read(`(() => {
    const app = window.__fake.app;
    app.handlers['terminal.list'] = () => [{id:'103',incarnation:'fixture-p2-103',cwd:'/p',program:'zsh',title:'first project',running:true,exit_code:null,owner:'p2-agent'}];
    app.handlers['terminal.snapshot'] = () => ({cols:80,rows:24,after:0,data:''});
    app.emit({actor:{kind:'user',id:'you',parent:null},name:'terminal.changed'});
  })()`);
  await wait(`!!document.querySelector('.terminal-tab[data-bubble="103"]')`);
  await read(`document.querySelector('.pane-screen textarea').focus()`);
  await key();
  await wait(focused("103"));
  await read(`document.querySelector('.project-tab[data-path="/Users/you/project-number-3"] .tab-name-button').click()`);
  await wait(`!!document.querySelector('.rail-row[data-id="p3-agent"]')`);
  await read(`document.querySelector('.rail-row[data-id="p3-agent"]').click()`);
  await wait(`!!document.querySelector('.pane-screen textarea')`);
  await read(`document.querySelector('.pane-screen textarea').focus(); window.__oldCalls = window.__fake.app.calls.length; window.__other = window.__fake.app.of('/Users/you/project-number-3'); window.__otherCalls = window.__other.calls.length`);
  await key();
  expect(await read(`({pane:!!document.activeElement?.closest('.pane-screen'), bubble:!!document.querySelector('.bubble:not([hidden])'), old:window.__fake.app.calls.slice(window.__oldCalls), other:window.__other.calls.slice(window.__otherCalls)})`)).toEqual({ pane: true, bubble: false, old: [], other: [] });
  await read(`(() => {
    window.__other.handlers['terminal.list'] = () => [{id:'103',incarnation:'fixture-p3-103',cwd:'/other',program:'zsh',title:'second project',running:true,exit_code:null,owner:'p3-agent'}];
    window.__other.handlers['terminal.snapshot'] = () => ({cols:80,rows:24,after:0,data:''});
    window.__other.handlers['terminal.write'] = () => null;
    window.__other.emit({actor:{kind:'user',id:'you',parent:null},name:'terminal.changed'});
  })()`);
  await wait(`!!document.querySelector('.terminal-tab[data-bubble="103"]')`);
  await key();
  await wait(focused("103"));
  await browser("keyboard", "type", "other-project");
  await wait(`window.__other.calls.some(c => c.method === 'terminal.write')`);
  expect(await read(`({old:window.__fake.app.calls.slice(window.__oldCalls).filter(c => c.method === 'terminal.write'), text:window.__other.calls.filter(c => c.method === 'terminal.write').map(c => atob(c.params.data)).join(''), selected:window.__terminals.has('t-p3-agent')})`)).toEqual({ old: [], text: "other-project", selected: true });
}, 120_000);

it("u2742c_a_terminal_tab_without_a_main_agent_has_no_switch_pair", async () => {
  await start();
  await read(`document.querySelector('.rail-row[data-id="first-workstream"]').click()`);
  await wait(`!!document.querySelector('.terminal-tab[data-bubble="103"]') && document.querySelector('.rail-row[data-selected=true]')?.dataset.id === 'first-workstream'`);
  await read(`document.querySelector('.terminal-tab[data-bubble="103"]').focus(); window.__beforeNoPair = window.__fake.app.calls.length`);
  await key();
  expect(await read(`({tab:!!document.activeElement?.matches('.terminal-tab[data-bubble="103"]'), calls:window.__fake.app.calls.slice(window.__beforeNoPair).filter(c => ['terminal.open','terminal.close','terminal.write'].includes(c.method))})`)).toEqual({ tab: true, calls: [] });
  await read(`(() => {const bubble=document.querySelector('.bubble[data-bubble="103"]');if(bubble.hidden)document.querySelector('.terminal-tab[data-bubble="103"]').click();else bubble.querySelector('textarea').focus();})()`);
  await wait(focused("103"));
  expect(await read(`(() => {const event=new KeyboardEvent('keydown',{key:'b',code:'KeyB',metaKey:true,bubbles:true,cancelable:true});document.activeElement.dispatchEvent(event);return event.defaultPrevented;})()`)).toBe(true);
  expect(await read(`window.__fake.app.calls.slice(window.__beforeNoPair).filter(c => ['terminal.open','terminal.close','terminal.write'].includes(c.method))`)).toEqual([]);
}, 90_000);
