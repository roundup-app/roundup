import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { appServer } from "../testing/appServer";
import { captureDir } from "../testing/captures";

const exec = promisify(execFile);

it.skipIf(!captureDir("U4644"))("u4644_rendered_starts_and_empty_heading_audit", async () => {
  const phase = process.env.ROUNDUP_CAPTURE_PHASE ?? "head";
  const server = await appServer(process.env.U4644_ROOT ? { root: process.env.U4644_ROOT } : {});
  const profile = mkdtempSync(join(tmpdir(), "u4644-"));
  const session = `u4644-${process.pid}`;
  const browser = async (...args: string[]) => (await exec("agent-browser", ["--session", session, "--json", ...args], { timeout: 30_000, maxBuffer: 8 * 1024 * 1024 })).stdout;
  const read = async (expression: string) => {
    const reply = JSON.parse(await browser("eval", expression));
    if (!reply.success) throw new Error(reply.error);
    return reply.data.result;
  };
  const wait = (expression: string) => browser("wait", "--fn", expression);
  const origin = server.resolvedUrls.local[0]!;
  const dir = join(captureDir("U4644")!, phase);
  mkdirSync(dir, { recursive: true });
  const snap = async (name: string) => {
    await browser("screenshot", join(dir, `${name}.png`));
    writeFileSync(join(dir, `${name}.checks.json`), JSON.stringify(await read(`({ checks: window.__checks(), headings: [...document.querySelectorAll('.section-head,.overview-heading,.shelf-group-head')].filter(el => el.getClientRects().length).map(el => el.textContent), empty: [...document.querySelectorAll('.empty-state')].map(el => el.textContent), revision: ${JSON.stringify(execFileSync("git", ["rev-parse", "HEAD"], { cwd: process.env.U4644_ROOT ?? process.cwd(), encoding: "utf8" }).trim())} })`), null, 2));
  };
  const load = async (seed: string) => {
    await browser("open", new URL(`/harness.html?seed=${seed}&items=1&view=workstreams`, origin).href);
    await wait(`!!window.__fake && !!document.querySelector('.rail-tree')`);
  };
  const emit = `window.__fake.emit({actor:{kind:'user',id:'you',parent:null},name:'rail.changed'})`;
  try {
    await browser("--profile", profile, "--executable-path", "/opt/google/chrome/chrome", "--args", "--no-sandbox", "open", origin);
    await browser("set", "viewport", "1512", "950");
    for (const theme of ["light", "dark"]) {
      await browser("set", "media", "color-scheme", theme);
      await load("empty-project");
      await snap(`${theme}-empty`);
      for (const kind of ["agent", "workstream"]) {
        await load("tree-40");
        await read(`(async () => { const nodes = await window.__fake.app.rpc('rail.tree',{}); const node = nodes.find(n => n.kind === '${kind}'); window.__fake.app.handlers['rail.tree'] = () => [{...node,parent:null,attempt:null}]; ${emit}; })()`);
        await wait(`document.querySelectorAll('.rail-row').length === 1`);
        await snap(`${theme}-${kind}`);
        await read(`window.__fake.app.handlers['rail.tree'] = () => []; ${emit}`);
        await wait(`document.querySelectorAll('.rail-row').length === 0`);
        await snap(`${theme}-${kind}-last-removed`);
      }
      await load("tree-40");
      await snap(`${theme}-mixed-todos`);
      await browser("click", '[role="tab"][data-value="pads"]');
      await wait(`!!document.querySelector('.pads-tab')`);
      await snap(`${theme}-mixed-pads`);
      await read(`window.__fake.app.handlers['pad.list'] = () => []; window.__fake.emit({actor:{kind:'user',id:'you',parent:null},name:'pad.changed'});`);
      await wait(`document.querySelectorAll('.pad-row').length === 0`);
      await snap(`${theme}-pads-last-removed`);
      await browser("click", '[role="tab"][data-value="todos"]');
      await wait(`!!document.querySelector('.todos-tab')`);
      await read(`window.__fake.app.handlers['todo.list'] = () => []; window.__fake.emit({actor:{kind:'user',id:'you',parent:null},name:'todo.changed'});`);
      await wait(`document.querySelectorAll('.todo-row').length === 0`);
      await snap(`${theme}-todos-last-removed`);
    }
    await load("tree-40");
    await read(`window.__fake.failNext(-32003,'Creation rejected: choose another Workstream name'); document.querySelector('[aria-label="Add Workstream"]').click()`);
    await wait(`document.querySelector('[role=alert]')?.textContent.includes('Creation rejected')`);
    await snap("dark-dense-creation-failure");
    if (phase === "head") {
      for (const shift of [false, true]) {
        await load("empty-project");
        await browser("press", shift ? "Meta+Shift+n" : "Meta+n");
        await wait(`window.__fake.app.calls.some(call => call.method === '${shift ? "rail.createWorkstream" : "agent.spawn"}')`);
        expect(await read(`window.__fake.app.calls.filter(call => call.method === '${shift ? "rail.createWorkstream" : "agent.spawn"}').length`)).toBe(1);
        await snap(`dark-${shift ? "workstream" : "agent"}-chord-result`);
      }
    }
  } finally {
    try { await browser("close"); } finally { await server.close(); rmSync(profile, { recursive: true, force: true }); }
  }
}, 180_000);
