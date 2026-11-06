import { agentBrowserExecutable } from "../testing/chromePage";
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, expect, it } from "vitest";
import { appServer } from "../testing/appServer";
import type { AppServer } from "../testing/appServer";
import { captureDir } from "../testing/captures";

const execute = promisify(execFile);

const session = `p3557c-${process.pid}`;

let server: AppServer;

const browser = async (...args: string[]) => (await execute(agentBrowserExecutable, ["--session", session, ...args], { timeout: 60_000 })).stdout;

beforeAll(async () => {
  server = await appServer();
  await browser("set", "viewport", "1512", "950");
  await browser("set", "media", "dark");
}, 90_000);

afterAll(async () => {
  await browser("close");
  await server?.close();
});

const capture = async (step: string, id = "P3557c") => {
  const dir = captureDir(id);

  if (!dir) return;
  await mkdir(dir, { recursive: true });
  await browser("screenshot", join(dir, `${step}.png`));
  await writeFile(join(dir, `${step}.checks.json`), JSON.stringify(JSON.parse(await browser("eval", "window.__checks()"))) + "\n");
};

it("p3557c_rendered_failure_clears_with_its_deleted_todo", async () => {
  await browser("open", `${server.resolvedUrls.local[0]}harness.html?view=workstreams&items=1&tabs=1&seed=tree-40`);
  await browser("wait", "[role=tree]");
  const todo = JSON.parse(await browser("eval", "window.__fake.app.rpc('todo.list').then(list => list.find(todo => todo.creator.kind === 'user'))"));

  await browser("eval", `window.__fake.emit({ actor: { kind: 'agent', id: 'a', parent: null }, name: 'todo.updated', data: ${JSON.stringify(todo)} })`);
  await browser("wait", ".app-toast-action");
  await browser("eval", "window.__fake.app.handlers['todo.list'] = () => { throw new Error('Daemon unavailable') }");
  await browser("click", ".app-toast-action");
  await browser("wait", "[role=alert]");
  await capture("dark-failure-visible");
  await capture("dark-failure-visible", "U411");
  await browser("eval", "window.__fake.app.handlers['todo.list'] = () => []");
  await browser("eval", `window.__fake.emit({ actor: { kind: 'user', id: 'you', parent: null }, name: 'todo.deleted', data: { id: ${todo.id} } })`);
  await browser("wait", "--fn", "!document.querySelector('[role=alert]')");
  await capture("dark-failure-cleared");
  expect(JSON.parse(await browser("eval", "!!document.querySelector('[role=alert]')"))).toBe(false);
}, 60_000);

// U411's rendered observer is design policy: capture real notices without asserting layout.
it.skipIf(!captureDir("U411")).each(["needs-you", "error", "todo", "extension"])("u411_long_notice_rows: %s", async (kind) => {
    await browser("open", `${server.resolvedUrls.local[0]}harness.html?seed=tree-40`);
    await browser("wait", "[role=tree]");
    await browser("eval", `(async () => {
      const f = window.__fake;
      const nodes = await f.app.rpc('rail.tree', null);
      const agents = nodes.filter(node => node.kind === "agent" && node.status?.kind === "working").slice(0, 3);
      for (const node of agents) { node.name = 'writer-states-skill-goals-'.repeat(3).slice(0, 60); }
      f.app.handlers['rail.tree'] = () => structuredClone(nodes);
      f.emit({ actor: {kind:'user', id:'you', parent:null}, name:'rail.changed', data:null });
      window.noticeAgents = agents.map(node => node.id);
    })()`);
    await browser("wait", "--fn", "document.querySelector('[role=tree]').textContent.includes('writer-states')");
    await browser("eval", `(async () => {
      const f = window.__fake, ids = window.noticeAgents;
      f.setStatus(ids[1], 'needs-you', 'Needs you');
      f.setStatus(ids[2], 'needs-you', 'Needs you');
      const line = 'Review the requested workspace changes and preserve the current work before continuing. '.repeat(3).slice(0,160);
      if ('${kind}' === 'extension') f.emit({actor:{kind:'user', id:'you', parent:null},name:'extension.problem',data:{extension:'workspace-tools-extension-'.repeat(5).slice(0,120), cause:line}});
      else if ('${kind}' === 'todo') {
        const todo = (await f.app.rpc('todo.list',null)).find(todo => todo.creator.kind === 'user');
        f.emit({actor:{kind:'agent', id:ids[0], parent:null}, name:'todo.updated',data:{...todo,title:line}});
      } else f.setStatus(ids[0], '${kind}', line);
    })()`);
    await browser("wait", ".app-toast-action");
    await browser("focus", ".app-toast:not([data-sibling]) .app-toast-action");
    await browser("wait", "--fn", "document.querySelectorAll('.app-toast').length === 3 && !document.querySelector('.app-toast[data-overlap]')");
    await capture(`dark-${kind}-fanned`, "U411");
    await browser("eval", "document.activeElement.blur()");
    await browser("mouse", "move", "0", "0");
    await browser("wait", "--fn", "!!document.querySelector('.app-toast[data-overlap]')");
    await capture(`dark-${kind}-front`, "U411");
}, 60_000);
