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
    const observation = await read(`({ checks: window.__checks(), headings: [...document.querySelectorAll('.section-head,.overview-heading,.shelf-group-head')].filter(el => el.getClientRects().length).map(el => el.textContent), empty: [...document.querySelectorAll('.empty-state')].map(el => el.textContent), revision: ${JSON.stringify(execFileSync("git", ["rev-parse", "HEAD"], { cwd: process.env.U4644_ROOT ?? process.cwd(), encoding: "utf8" }).trim())} })`);
    writeFileSync(join(dir, `${name}.checks.json`), JSON.stringify(observation.checks, null, 2));
    writeFileSync(join(dir, `${name}.observation.json`), JSON.stringify(observation, null, 2));
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
      await read(`(async () => { const pads = await window.__fake.app.rpc('pad.list',{}); for (const pad of pads) await window.__fake.app.rpc('pad.delete',{name:pad.name}); })()`);
      await wait(`document.querySelectorAll('.pads-tab [data-incarnation]').length === 0 && !!document.querySelector('.pads-tab .empty-state')`);
      await snap(`${theme}-pads-last-removed`);
      await browser("click", '[role="tab"][data-value="todos"]');
      await wait(`!!document.querySelector('.todos-tab')`);
      await read(`(async () => { const todos = await window.__fake.app.rpc('todo.list',{}); await window.__fake.app.rpc('todo.delete',{ids:todos.map(todo => todo.id),operation:crypto.randomUUID()}); })()`);
      await wait(`document.querySelectorAll('.todos-tab [data-todo]').length === 0 && !!document.querySelector('.todos-tab .empty-state')`);
      await snap(`${theme}-todos-last-removed`);
    }

    await load("tree-40");
    await read(`window.__fake.failNext(-32003,'Creation rejected: choose another Workstream name'); document.querySelector('[aria-label="Create"]').click()`);
    await wait(`!!document.querySelector('[data-part="item"][data-value="workstream"]')`);
    await browser("click", '[data-part="item"][data-value="workstream"]');
    await wait(`document.querySelector('[role=alert]')?.textContent.includes('Creation rejected')`);
    await snap("dark-dense-creation-failure");

    if (phase === "head") {
      for (const activation of ["chord", "enter", "pointer"]) for (const shift of [false, true]) {
        await load("empty-project");

        if (activation === "chord") await browser("press", shift ? "Meta+Shift+n" : "Meta+n");
        else {
          const selector = `.empty-state-actions button[aria-label="${shift ? "New Workstream" : "New Agent"}"]`;

          if (activation === "pointer") await browser("click", selector);
          else { await browser("focus", selector); await wait(`document.activeElement.matches(${JSON.stringify(selector)})`); await browser("press", "Enter"); }
        }

        await wait(`window.__fake.app.calls.some(call => call.method === '${shift ? "rail.createWorkstream" : "agent.spawn"}')`);
        expect(await read(`window.__fake.app.calls.filter(call => call.method === '${shift ? "rail.createWorkstream" : "agent.spawn"}').length`)).toBe(1);
        
      }
    }
  } finally {
    try { await browser("close"); } finally { await server.close(); rmSync(profile, { recursive: true, force: true }); }
  }
}, 180_000);
