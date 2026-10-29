import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "vitest";
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
  writeFileSync(clock, "Date.now = () => 1793304000000;");
  const browser = async (...args: string[]) => {
    const reply = JSON.parse((await exec("agent-browser", ["--session", session, "--json", ...args], { timeout: 30_000, maxBuffer: 8 * 1024 * 1024 })).stdout);
    if (!reply.success) throw new Error(reply.error);
    return reply.data;
  };
  const read = async (expression: string) => (await browser("eval", expression)).result;
  const wait = (expression: string) => browser("wait", "--fn", expression);
  const snap = async (name: string) => {
    await browser("screenshot", join(dir, `${name}.png`));
    writeFileSync(join(dir, `${name}.checks.json`), JSON.stringify(await read("window.__checks()"), null, 2));
  };
  const load = async (seed: string, extra = "") => {
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
    await load("tree-40");
    await wait("!!document.querySelector('.shelf-done-line')");
    await states("todo-summary-rail", ".shelf-done-line button[data-button=quiet]");
    await browser("click", '.todos-tab .section-head');
    await wait("!!document.querySelector('.todo-row .todo-row-button') && document.querySelector('.todo-row').getBoundingClientRect().height > 0");
    await states("wrapped-todos", '.todo-row .todo-row-button');
    await browser("click", '.todo-row .todo-row-button');
    await snap("todo-selected");
    await browser("click", '.todo-open');
    await wait("!!document.querySelector('.todo-drawer')");
    await snap("todo-drawer");
    const pickers = await read("[...document.querySelectorAll('.todo-drawer button[aria-haspopup]')].map((el, i) => {el.dataset.u86Picker=String(i);return String(i)})");
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
    await browser("click", '.rail-row[data-id="agent-1"]', "--button", "right");
    await wait("!!document.querySelector('[role=menu]')");
    await snap("rail-menu");
    await browser("press", "Escape");
    await load("tree-40", "&view=ask-history");
    await read(`(async () => { const asks = [{key:'u86',text:'Review icon alignment',created_at:Date.now(),pending:false,parts:[{text:'Review icon alignment',placement:{kind:'workstream',id:'backend'},state:'typed',workstream:'backend',agent:'backend',reason:null}]}]; window.__fake.app.handlers['ask.list']=()=>asks; window.__fake.emit({actor:{kind:'user',id:'you',parent:null},name:'ask.changed'}); })()`);
    await snap("ask-history");
    await load("conflict");
    await browser("click", '[aria-label="Add Workstream"]');
    await wait("!!document.querySelector('[role=alert]')");
    await snap("conflict-failure");
    await load("tabs-8");
    await snap("project-tabs");
    await load("bubbles");
    await browser("click", '.rail-row[data-id="bubble-agent"]');
    await snap("floating-terminal");
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
  } finally {
    try { await browser("close"); } finally { await server.close(); rmSync(profile, { recursive: true, force: true }); }
  }
}, 240_000);
