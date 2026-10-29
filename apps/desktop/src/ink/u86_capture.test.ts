import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { appServer } from "../testing/appServer";
import { captureDir } from "../testing/captures";

const exec = promisify(execFile);

// U86's optical observer records pixels for the critic; it asserts no layout.
it.skipIf(!captureDir("U86"))("u86_capture_icon_text_pairs", async () => {
  const server = await appServer();
  const profile = mkdtempSync(join(tmpdir(), "u86-profile-"));
  const session = `u86-${process.pid}`;
  const dir = join(captureDir("U86")!, process.env.ROUNDUP_CAPTURE_PHASE ?? "head");
  mkdirSync(dir, { recursive: true });
  const clock = join(profile, "clock.js");
  writeFileSync(clock, "Date.now = () => 1793304000000 + Math.floor(performance.now());");

  const browser = async (...args: string[]) => {
    const reply = JSON.parse((await exec("agent-browser", ["--session", session, "--json", ...args], { timeout: 30_000, maxBuffer: 8 * 1024 * 1024 })).stdout);

    if (!reply.success) throw new Error(reply.error);

    return reply.data;
  };

  const read = async (expression: string) => (await browser("eval", expression)).result;
  const wait = (expression: string) => browser("wait", "--fn", expression);

  const snap = async (name: string) => {
    console.info(`U86 ${name}`);
    await browser("screenshot", join(dir, `${name}.png`));
    writeFileSync(join(dir, `${name}.checks.json`), JSON.stringify(await read("window.__checks()"), null, 2));
  };

  const load = async (seed: string, extra = "") => {
    await read("localStorage.clear(); sessionStorage.clear()");
    await browser("open", `${server.resolvedUrls.local[0]}harness.html?seed=${seed}&items=1&menu=1${extra}`);
    await wait("!!window.__fake && !!document.querySelector('.rail-tree,.choose-project')");
  };

  const states = async (name: string, selector: string) => {
    await snap(`${name}-rest`);
    await browser("hover", selector);
    await snap(`${name}-hover`);
    await browser("focus", selector);
    await browser("press", "Tab");
    await browser("press", "Shift+Tab");
    await snap(`${name}-focus`);
  };

  try {
    await browser("--profile", profile, "--init-script", clock, "--executable-path", "/opt/google/chrome/chrome", "--args", "--no-sandbox", "open", server.resolvedUrls.local[0]!);
    await browser("set", "viewport", "1512", "950");
    await browser("set", "media", "color-scheme", "dark");

    if (!process.env.U86_EXTRA_ONLY) {
    await load("tree-40");
    await wait("!!document.querySelector('.shelf-done-line')");
    await states("todo-summary-rail", ".shelf-done-line button[data-button=quiet]");
    await browser("click", '.todos-tab .shelf-group-control');
    await wait("document.querySelector('.todos-tab [data-shelf-group]')?.getAttribute('data-state') === 'open'");
    await states("wrapped-todos", '.todo-row[data-todo="1"] .todo-row-button');
    await browser("click", '.todo-row[data-todo="1"] .todo-row-button');
    await snap("todo-selected");
    await browser("click", '.todo-row[data-todo="1"] .todo-open');
    await wait("!!document.querySelector('.todo-detail')");
    await snap("todo-drawer");
    const pickers = await read("[...document.querySelectorAll('.todo-detail button[aria-haspopup]')].map((el, i) => {el.dataset.u86Picker=String(i);return String(i)})");

    for (const id of pickers) {
      await browser("click", `[data-u86-picker="${id}"]`);
      await snap(`todo-picker-${id}`);
      await browser("press", "Escape");
    }

    await load("tree-40");
    await browser("click", '[role=tab][data-value=pads]');
    await wait("!!document.querySelector('.pads-tab')");
    await snap("pads-shelf");
    await load("agents-10");
    await states("all-kinds", '.rail-row[data-id="agent-1"]');
    await browser("click", '.rail-row[data-id="agent-1"]');
    await snap("rail-selected");
    await browser("focus", '.rail-row[data-id="agent-1"]');
    await browser("press", "Shift+F10");
    await wait("!!document.querySelector('[role=menu]')");
    await states("rail-menu", '[role="menuitem"]:first-child');
    await browser("press", "Escape");
    await load("tree-40", "&view=ask-history");
    await read(`window.__fake.emit({actor:{kind:'user',id:'you',parent:null},name:'ask.changed',data:{ask:{id:'u86',text:'Review icon alignment',at:'1793304000000',parts:[{text:'Review icon alignment',placement:{kind:'routed',workstream:'backend'},state:'typed'}]}}})`);
    await wait("!!document.querySelector('.ask-row')");
    await states("ask-history", ".ask-row .ask-line");
    await load("conflict");
    await browser("click", '[aria-label="Add Workstream"]');
    await wait("!!document.querySelector('[role=alert]')");
    expect(await read("document.querySelectorAll('[role=alert]').length")).toBe(1);
    await snap("conflict-failure");
    await load("tabs-8");
    await snap("project-tabs");
    await load("bubbles");
    await browser("click", '.rail-row[data-id="runner"]');
    await snap("floating-terminal");
    await load("resources", "&view=resources");
    await snap("resources");
    await browser("press", "Meta+k");
    await browser("press", "k");
    await wait("!!document.querySelector('.switcher')");
    await snap("switcher");
    await browser("press", "Escape");
    await browser("press", "Meta+k");
    await browser("press", "i");
    await wait("!!document.querySelector('.inbox')");
    await snap("inbox");
    await load("first-run");
    await snap("first-run");
    await load("agents-10");
    await browser("press", "Meta+Comma");
    await wait("!!document.querySelector('.app-select-trigger')");
    await snap("settings-controls");
    const settings = await read("[...document.querySelectorAll('.app-select-trigger')].map((el,i)=>{el.dataset.u86Select=String(i);return String(i)})");

    for (const id of settings) {
      await browser("click", `[data-u86-select="${id}"]`);
      await snap(`settings-menu-${id}`);
      await browser("press", "Escape");
    }
    }

    await load("tree-40");
    await browser("click", '.todos-tab .shelf-group-control');
    await browser("click", '.todo-row[data-todo="3"] .todo-open');
    await wait("!!document.querySelector('.todo-detail-title')");
    await snap("wrapped-todo-drawer");
    await load("tree-40");
    await browser("click", '[role=tab][data-value=pads]');

    if (await read("document.querySelector('.pads-tab .shelf-group-control').getAttribute('data-state') === 'closed'")) await browser("click", '.pads-tab .shelf-group-control');
    const pad = await read("document.querySelector('.pads-tab [data-pad]')?.getAttribute('data-pad')");
    await browser("focus", `[data-pad=${JSON.stringify(pad)}] .pad-name`);
    await browser("press", "Enter");
    await wait("!!document.querySelector('.pad-body')");
    await snap("pad-drawer");
    await load("resources", "&view=resources");
    await browser("click", '.rail-row[data-id="worktree-agent"]');
    await snap("worktree-control");
    await load("import-candidates");
    await read("(async () => { const {openProjectPage} = await import('/src/testing/menuProbe.ts'); openProjectPage('import-work', window.__fake.app.opened.project.path); })()");
    await wait("!!document.querySelector('.import-panel')");
    await snap("import-controls");
    await load("tree-40", "&view=made");
    await snap("made-controls");
    await load("tree-40", "&view=reactions");
    await snap("reaction-controls");
  } finally {
    try { await browser("close"); } finally { await server.close(); rmSync(profile, { recursive: true, force: true }); }
  }
}, 240_000);
