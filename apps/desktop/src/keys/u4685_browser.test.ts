import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
  const browser = async (...args: string[]) => (await exec("agent-browser", ["--session", session, "--json", ...args], { timeout: 30_000, maxBuffer: 8 * 1024 * 1024 })).stdout;
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
    for (const dir of dirs) {
      await browser("screenshot", join(dir, `${name}.png`));
      writeFileSync(join(dir, `${name}.checks.json`), JSON.stringify(observation, null, 2));
    }
  };
  const tabTo = async (selector: string) => {
    for (let n = 0; n < 100; n++) {
      await browser("press", "Tab");
      if (await read(`!!document.activeElement.closest(${JSON.stringify(selector)})`)) return;
    }
    throw new Error(`Tab never entered ${selector}`);
  };
  try {
    await browser("--profile", profile, "--executable-path", "/opt/google/chrome/chrome", "--args", "--no-sandbox", "open", server.resolvedUrls.local[0]!);
    await browser("set", "viewport", "1512", "950");
    await browser("set", "media", "color-scheme", "dark");
    await browser("open", new URL('/harness.html?seed=tree-40&view=workstreams&items=1&tabs=1', server.resolvedUrls.local[0]!).href);
    await wait(`!!document.querySelector('.rail-row[data-id="agent-4"]')`);
    await browser("click", '.rail-row[data-id="agent-4"]');
    await wait(`!!document.querySelector('.pane .xterm-screen') && window.__terminals.size > 0`);
    await read(`(() => { window.__focusFits=0; for(const emulator of window.__terminals.values()){const fit=emulator.fit.bind(emulator);emulator.fit=(...args)=>{window.__focusFits++;return fit(...args)};} window.__fake.writeOutput('t-agent-4','\\x1b[2J\\x1b[HFirst visible line — focus leaves this text still\\r\\nInput stays with this Agent.\\x1b[999;1HLast visible line > '); })()`);
    await wait(`!!document.querySelector('.pane .xterm-helper-textarea')`);
    if (dirs.length) await browser("record", "start", join(dirs[0]!, "focus.webm"));
    await snap("01-unfocused-terminal");
    await browser("click", ".pane .xterm-screen");
    await wait(`document.activeElement.matches('.pane textarea')`);
    await snap("02-pointer-terminal");
    const writes = await read(`window.__fake.app.calls.filter(c=>c.method==='terminal.write').length`);
    await browser("press", "j");
    await wait(`window.__fake.app.calls.filter(c=>c.method==='terminal.write').length > ${writes}`);
    expect(await read(`window.__fake.app.calls.filter(c=>c.method==='terminal.write').slice(${writes}).map(c=>c.params)`)).toEqual([{id:"t-agent-4",data:"ag=="}]);
    const counts = await read(`({fits:window.__focusFits,resizes:window.__fake.app.calls.filter(c=>c.method==='terminal.resize').length})`);
    await tabTo(".rail");
    await snap("03-keyboard-rail");
    await browser("press", "Shift+?");
    await wait(`!!document.querySelector('.help')?.contains(document.activeElement)`);
    await snap("04-help-blurs-regions");
    await browser("press", "Escape");
    await wait(`!document.querySelector('.help') && !!document.activeElement.closest('.rail')`);
    await snap("05-help-return");
    await tabTo(".shelf-tabs,.shelf");
    await snap("06-keyboard-shelf");
    await browser("press", "Tab");
    await snap("07-within-shelf");
    await tabTo(".pane textarea");
    await snap("08-keyboard-terminal");
    expect(await read(`({fits:window.__focusFits,resizes:window.__fake.app.calls.filter(c=>c.method==='terminal.resize').length})`)).toEqual(counts);
    expect(await read(`window.__fake.app.calls.filter(c=>c.method==='terminal.write').length`)).toBe(writes + 1);
    // Drawer hides Shelf in production; settle its opening before counting focus-only resizes.
    await browser("click", '.shelf [data-todo] .todo-row-button');
    await wait(`!!document.querySelector('.drawer[data-open="true"]')`);
    await tabTo(".drawer");
    await snap("09-keyboard-drawer");
    await browser("press", "Tab");
    await snap("10-within-drawer");
    await browser("click", ".pane .xterm-screen");
    await wait(`document.activeElement.matches('.pane textarea')`);
    await snap("11-terminal-drawer-blur");
    if (dirs.length) await browser("record", "stop");
  } finally {
    try { await browser("close"); } finally { await server.close(); rmSync(profile, { recursive: true, force: true }); }
  }
}, 120_000);
