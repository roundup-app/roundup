import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { chromePath } from "../testing/chromePage";
import { appServer, startAppServer } from "../testing/appServer";
import { captureDir } from "../testing/captures";

const exec = promisify(execFile);

let baseline: Awaited<ReturnType<typeof startAppServer>> | undefined;

beforeAll(async () => {
  if (process.env.ROUNDUP_BASELINE_ROOT) baseline = await startAppServer({ root: process.env.ROUNDUP_BASELINE_ROOT });
}, 120_000);

afterAll(async () => { await baseline?.close(); });

it.each(["tree-40", "agents-10", "tabs-8", "empty-project", "resources"])("u2539b_rendered_landing_navigation_and_changed_files: %s", async seed => {
  const profile = mkdtempSync(join(tmpdir(), "u2539b-profile-"));
  const session = `u2539b-${process.pid}`;
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("AGENT_BROWSER_")));
  const browser = async (...args: string[]) => (await exec("agent-browser", ["--executable-path", chromePath()!, "--args", "--no-sandbox", "--session", session, "--profile", profile, ...args], { env, timeout: 60_000 })).stdout;
  // SAFETY: agent-browser serializes the JSON value returned by each page expression.
  const evaluate = async <T,>(source: string): Promise<T> => JSON.parse(await browser("eval", source)) as T;
  const until = (source: string) => browser("wait", "--fn", source);
  const server = await appServer();

  const capture = async (lane: string, step: string) => {
    const directory = captureDir("U2539b");

    if (!directory) return;
    mkdirSync(join(directory, lane), { recursive: true });
    writeFileSync(join(directory, lane, `${step}.checks.json`), JSON.stringify(await evaluate("window.__checks()")) + "\n");
    await browser("screenshot", join(directory, lane, `${step}.png`));
  };

  try {
    await browser("set", "viewport", "1512", "950");
    await browser("set", "media", "dark");

    for (const [lane, served] of [["base", baseline], ["head", server]] as const) {
      if (!served) continue;
        await browser("open", `${served.resolvedUrls.local[0]}harness.html?seed=${seed}`);
        await until("!!document.querySelector('.ask-input, .rail-tree')");
        await capture(lane, `${seed}-landing`);

        if (lane === "head" && seed === "agents-10") {
          await browser("click", ".overview-entry");
          await until("!!document.querySelector('.pane-screen')");
          await capture(lane, "agents-10-selected-agent");
          await browser("click", ".todo-project-root");
          await until("!!document.querySelector('.ask-input')");
        }

        if (lane === "head" && seed === "tree-40") {
          await browser("press", "Meta+Shift+t");
          await until("document.activeElement === document.querySelector('.capture-field')");
          await capture(lane, "tree-40-quick-add");
          await browser("press", "Escape");
          await until("!document.querySelector('.capture-field')");
          await browser("press", "Meta+k");
          await browser("press", "b");
          await until("!!document.querySelector('[data-shelf-group=unassigned]')");
          await browser("click", '[data-shelf-group="unassigned"] [data-part="branch-control"]');
          await browser("click", '[data-todo="5"] .todo-row-button');
          await browser("press", "Enter");
          await until("!!document.querySelector('.drawer[data-open=true]')");
          await capture(lane, "tree-40-todo-drawer");
          await browser("press", "Escape");
          await until("!!document.querySelector('.drawer[data-open=false]')");
          await browser("press", "Meta+k");
          await browser("press", "b");
          await until("document.querySelector('.window').dataset.shelf === 'closed'");
        }

        // U4274b: the Rail and Terminal bar are primary navigation and stay mounted; secondary surfaces open on request.
        if (lane === "head") {
          expect(await evaluate("document.querySelectorAll('.todos-tab, .resource-value, .ask-rows').length")).toBe(0);
          await evaluate("window.__fake.app.projects().then(list => window.dispatchEvent(new CustomEvent('open-project-page', {detail:{path: JSON.parse(localStorage.getItem('roundup:open-tab') ?? 'null') ?? list.at(-1).path,command:'view:workstreams'}})))");
          await until("!!document.querySelector('.rail-tree')");
        }

        await capture(lane, `${seed}-navigation`);

        if (seed === "tree-40") {
          const selected = await evaluate<string>(`(() => {
            const nodes = window.__fake.app.handlers['rail.tree']();
            const node = nodes.find(node => node.kind === 'agent');
            node.worktree = {path:'/p/observer-worktree', branch:'roundup/' + 'long-branch-'.repeat(20), base:'main'};
            window.__fake.app.handlers['rail.tree'] = () => nodes;
            window.__fake.app.handlers['agent.changedFiles'] = () => {throw new Error('Changed files unavailable: the Worktree directory could not be read. Retry to check it again.')};
            window.__fake.emit({actor:{kind:'user',id:'you',parent:null},name:'rail.changed'});
            return node.id;
          })()`);

          await browser("click", `.rail-row[data-id="${selected}"]`);

          if (lane === "base") await browser("click", ".worktree-control");
          await until("!!document.querySelector('[role=alert]')");
          await capture(lane, "tree-40-failed-read");
        }

        if (seed !== "resources") continue;

        await evaluate(`(() => {const nodes = window.__fake.app.handlers['rail.tree'](); nodes.find(node => node.id === 'worktree-agent').worktree.branch = 'roundup/' + 'long-branch-'.repeat(20); window.__fake.app.handlers['rail.tree'] = () => nodes; window.__fake.emit({actor:{kind:'user',id:'you',parent:null},name:'rail.changed'});})()`);

        for (const count of [0, 1, 500]) {
          await evaluate(`window.__fake.app.handlers['agent.changedFiles'] = () => ({files: Array.from({length:${count}}, (_, n) => ({path:'folder/' + 'p'.repeat(120) + n + '.ts', status:'modified', line:1}))})`);
          await browser("click", '.rail-row[data-id="worktree-agent"]');

          if (lane === "head" && count === 0) {
            await until("!document.querySelector('.worktree-control')");
            await capture(lane, "changes-0");
          } else {
            await until("!!document.querySelector('.worktree-control')");
            await browser("click", ".worktree-control");
            await until("!!document.querySelector('.worktree-panel')");

            if (count > 0) await until("!!document.querySelector('file-tree-container')");
            await capture(lane, `changes-${count}`);
            await browser("press", "Escape");
          }

          // A new selection forces the next authoritative read, including the empty→nonempty case.
          await evaluate("document.querySelector('[data-todo-root]').click()");
        }

        await evaluate("window.__fake.app.handlers['agent.changedFiles'] = () => { throw new Error('Changed files unavailable: the Worktree directory could not be read. Retry to check it again.') }");
        await browser("click", '.rail-row[data-id="worktree-agent"]');

        if (lane === "base") await browser("click", ".worktree-control");
        await until("!!document.querySelector('[role=alert]')");
        await capture(lane, "failed-read");
    }
  } finally {
    await browser("close");
    await server.close();
    rmSync(profile, { recursive: true, force: true });
  }
}, 120_000);
