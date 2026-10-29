import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { appServer } from "../testing/appServer";
import { captureDir } from "../testing/captures";

const exec = promisify(execFile);

it("u4685a_region_focus_keeps_input_and_shortcut_ownership", async () => {
  const server = await appServer({ root: process.env.U4685_ROOT ?? process.cwd() });
  const profile = mkdtempSync(join(tmpdir(), "u4685-"));
  const session = `u4685-${process.pid}`;
  const browser = async (...args: string[]) => (await exec("agent-browser", ["--session", session, "--json", ...args], { timeout: 30_000, maxBuffer: 8 * 1024 * 1024 }).catch(error => { throw new Error(error.stdout || error.stderr || error.message); })).stdout;

  const read = async (expression: string) => {
    const reply = JSON.parse(await browser("eval", expression));

    if (!reply.success) throw new Error(reply.error);

    return reply.data.result;
  };

  const wait = (expression: string) => browser("wait", "--fn", expression);
  const phase = process.env.ROUNDUP_CAPTURE_PHASE ?? "head";

  const dirs = ["U4685a", "U4685b"].flatMap(id => {
    const dir = captureDir(id);

    if (!dir) return [];
    const destination = join(dir, phase);
    mkdirSync(destination, { recursive: true });

    return [destination];
  });

  const revision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: process.env.U4685_ROOT ?? process.cwd(), encoding: "utf8" }).trim();

  const snap = async (name: string) => {
    if (!dirs.length) return;
    const observation = await read(`({revision:${JSON.stringify(revision)}, checks:window.__checks(), focus:document.activeElement.outerHTML, regions:[...document.querySelectorAll('.pane,.rail,.shelf,.drawer,.xterm-screen')].map(el=>({selector:el.className,rect:el.getBoundingClientRect().toJSON(),focused:el.contains(document.activeElement)})), fits:window.__focusFits, resizes:window.__fake.app.calls.filter(c=>c.method==='terminal.resize').length})`);

    const screenshot = join(dirs[0]!, `${name}.png`);
    await browser("screenshot", screenshot);

    for (const dir of dirs) {
      if (dir !== dirs[0]) copyFileSync(screenshot, join(dir, `${name}.png`));
      writeFileSync(join(dir, `${name}.checks.json`), JSON.stringify(observation, null, 2));
    }
  };

  const tabTo = async (selector: string) => {
    for (let n = 0; n < 30; n++) {
      await browser("press", "Tab");

      if (await read(`!!document.activeElement.closest(${JSON.stringify(selector)})`)) return;
    }

    throw new Error(`Tab never entered ${selector}`);
  };

  try {
    await browser("--profile", profile, "--executable-path", "/opt/google/chrome/chrome", "--args", "--no-sandbox", "open", server.resolvedUrls.local[0]!);
    await browser("set", "viewport", "1512", "950");

    if (dirs.length) await browser("record", "start", join(dirs[0]!, "focus.webm"));
    await browser("open", new URL('/harness.html?seed=tree-40&view=workstreams&items=1&tabs=1', server.resolvedUrls.local[0]!).href);
    await browser("set", "media", "color-scheme", "dark");
    await wait(`!!document.querySelector('.rail-row[data-id="agent-4"]')`);
    await read(`window.__fake.app.rpc('todo.assign',{id:5,owner:{kind:'agent',id:'agent-4',parent:null}})`);
    await browser("click", '.rail-row[data-id="agent-4"]');
    await wait(`!!document.querySelector('.pane .xterm-screen') && window.__terminals.size > 0`);
    await read(`(() => { window.__focusFits=0; for(const emulator of window.__terminals.values()){const fit=emulator.fit.bind(emulator);emulator.fit=(...args)=>{window.__focusFits++;return fit(...args)};} window.__fake.writeOutput('t-agent-4','\\x1b[2J\\x1b[HFirst visible line — focus leaves this text still\\r\\nInput stays with this Agent.\\x1b[999;1HLast visible line > '); })()`);
    await wait(`!!document.querySelector('.pane .xterm-helper-textarea')`);
    await snap("01-unfocused-terminal");
    await browser("click", ".pane .xterm-screen");
    await wait(`document.activeElement.matches('.pane textarea')`);
    await snap("02-pointer-terminal");
    const writes = await read(`window.__fake.app.calls.filter(c=>c.method==='terminal.write').length`);
    await browser("press", "j");
    await wait(`window.__fake.app.calls.filter(c=>c.method==='terminal.write').length > ${writes}`);
    expect(await read(`window.__fake.app.calls.filter(c=>c.method==='terminal.write').slice(${writes}).map(c=>c.params)`)).toEqual([{id:"t-agent-4",data:"ag=="}]);
    const counts = await read(`({fits:window.__focusFits,resizes:window.__fake.app.calls.filter(c=>c.method==='terminal.resize').length})`);
    await browser("click", '.rail-row[data-id="agent-4"]');
    await browser("press", "ArrowDown");
    await browser("press", "ArrowUp");
    await wait(`!!document.activeElement.closest(".rail")`);
    await snap("03-keyboard-rail");
    await browser("press", "Shift+?");
    await wait(`!!document.querySelector('.help')?.contains(document.activeElement)`);
    await snap("04-help-blurs-regions");
    await browser("press", "Escape");
    await wait(`!document.querySelector('.help') && !!document.activeElement.closest('.rail')`);
    await snap("05-help-return");
    expect(await read(`({fits:window.__focusFits,resizes:window.__fake.app.calls.filter(c=>c.method==='terminal.resize').length})`)).toEqual(counts);
    await browser("press", "Meta+k");
    await browser("press", "s");
    await wait(`document.querySelector('.window').dataset.shelf === 'closed'`);
    await browser("press", "Meta+k");
    await browser("press", "s");
    await wait(`!!document.activeElement.closest('.shelf-tabs')`);
    await snap("06-keyboard-shelf");
    await browser("press", "Tab");
    await snap("07-within-shelf");
    await browser("click", '.rail-row[data-id="agent-4"]');
    await browser("press", "Enter");
    await wait(`document.activeElement.matches(".pane textarea")`);
    await snap("08-keyboard-terminal");
    expect(await read(`window.__fake.app.calls.filter(c=>c.method==='terminal.write').length`)).toBe(writes + 1);
    // Drawer hides Shelf in production; settle its opening before counting focus-only resizes.
    await browser("click", '.shelf [data-todo] .todo-row-button');
    await browser("press", "Enter");
    await wait(`!!document.querySelector('.drawer[data-open="true"]')`);
    await tabTo(".drawer");
    // U4698a opens items across the centre; restore the narrow Drawer before moving back to the Terminal.
    await browser("click", '.drawer button[aria-label="Restore"]');
    await wait(`!!document.querySelector('.drawer[data-maximised="false"]') && [...document.querySelector('.drawer').getAnimations(), ...document.querySelector('.columns').getAnimations()].every(animation => animation.playState !== 'running')`);
    await snap("09-keyboard-drawer");
    const drawerCounts = await read(`({fits:window.__focusFits,resizes:window.__fake.app.calls.filter(c=>c.method==='terminal.resize').length})`);
    await browser("press", "Tab");
    await snap("10-within-drawer");
    await browser("click", ".pane .xterm-screen");
    await wait(`document.activeElement.matches('.pane textarea')`);
    await snap("11-terminal-drawer-blur");
    expect(await read(`({fits:window.__focusFits,resizes:window.__fake.app.calls.filter(c=>c.method==='terminal.resize').length})`)).toEqual(drawerCounts);
    expect(await read(`document.querySelector('.rail-row[data-selected=true]')?.dataset.id`)).toBe("agent-4");

    if (dirs.length) {
      await browser("record", "stop");
      await browser("click", ".drawer .close");
      await wait(`!document.querySelector('.drawer[data-open="true"]')`);
      await read(`window.__fake.failNext(-32003,'Focus observer failure')`);
      await browser("click", ".shelf .todo-tick");
      await wait(`document.body.textContent.includes('Focus observer failure')`);
      await snap("12-dense-failure");
      await browser("open", new URL('/harness.html?seed=conflict&view=workstreams&items=1&tabs=1', server.resolvedUrls.local[0]!).href);
      await wait(`!!document.querySelector('.rail-row[data-id="agent-4"]')`);
      await browser("click", '.rail-row[data-id="agent-4"]');
      await wait(`!!document.querySelector('.pane .xterm-screen')`);
      await browser("click", ".pane .xterm-screen");
      await snap("13-conflict-terminal");
    }
  } finally {
    try { await browser("close"); } finally { await server.close(); rmSync(profile, { recursive: true, force: true }); }
  }
}, 60_000);
