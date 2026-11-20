import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { agentBrowserExecutable, chromePath } from "../testing/chromePage";
import { appServer, startAppServer } from "../testing/appServer";
import { captureDir } from "../testing/captures";

const exec = promisify(execFile);

let baseline: Awaited<ReturnType<typeof startAppServer>> | undefined;

const profile = mkdtempSync(join(tmpdir(), "u2539b-profile-"));

const session = `u2539b-${process.pid}`;

const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("AGENT_BROWSER_")));

const browser = async (...args: string[]) => (await exec(agentBrowserExecutable, ["--executable-path", chromePath()!, "--args", "--no-sandbox", "--session", session, "--profile", profile, ...args], { env, timeout: 60_000 })).stdout;

// SAFETY: agent-browser serializes the JSON value returned by each page expression.
const evaluate = async <T,>(source: string): Promise<T> => JSON.parse(await browser("eval", source)) as T;

const until = (source: string) => browser("wait", "--fn", source);

let server: Awaited<ReturnType<typeof appServer>>;

beforeAll(async () => {
  server = await appServer();

  if (process.env.ROUNDUP_BASELINE_ROOT) baseline = await startAppServer({ root: process.env.ROUNDUP_BASELINE_ROOT });
}, 120_000);

afterEach(async () => { await evaluate("localStorage.clear()"); });

afterAll(async () => {
  try { await browser("close"); } finally {
    await server?.close();
    await baseline?.close();
    rmSync(profile, { recursive: true, force: true });
  }
});

it.each(["tree-40", "agents-10", "tabs-8", "empty-project", "resources"])("u2539b_rendered_landing_navigation_and_changed_files: %s", async seed => {
  const capture = async (lane: string, step: string) => {
    const directory = captureDir("U2539b");

    if (!directory) return;
    mkdirSync(join(directory, lane), { recursive: true });
    writeFileSync(join(directory, lane, `${step}.checks.json`), JSON.stringify(await evaluate("window.__checks()")) + "\n");
    await browser("screenshot", join(directory, lane, `${step}.png`));
  };

  await browser("set", "viewport", "1512", "950");
  await browser("set", "media", "dark");

  for (const [lane, served] of [["base", baseline], ["head", server]] as const) {
    if (!served) continue;
      await browser("open", `${served.resolvedUrls.local[0]}harness.html?seed=${seed}`);
      await until("!!document.querySelector('.rail-tree')");
      await capture(lane, `${seed}-landing`);

      if (lane === "head" && seed === "agents-10") {
        const asking = await evaluate<string>("window.__fake.app.handlers['rail.tree']().find(node => node.kind === 'agent' && node.status?.kind === 'needs-you').id");
        await browser("click", `.rail-row[data-id="${asking}"]`);
        await until("!!document.querySelector('.pane-screen')");
        await capture(lane, "agents-10-selected-agent");
        await evaluate("window.__select(null)");
        await until("!document.querySelector('.rail-row[data-selected]')");
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
        await browser("click", '[data-shelf-group="unassigned"] .shelf-group-control');
        await browser("click", '[data-todo="5"] .todo-row-button');
        await browser("press", "Enter");
        await until("!!document.querySelector('.drawer[data-open=true]')");
        await capture(lane, "tree-40-todo-drawer");
        await browser("press", "Escape");
        await until("!!document.querySelector('.drawer[data-open=false]')");
        // U3721a: with a Todo selected `⌘K` then `B` opens it again, so the Bench closes by its head's Close button.
        await evaluate("document.querySelector('.shelf [aria-label=\"Close the Bench\"]').click() ?? true");
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
          window.__fake.app.handlers['agent.ownedChanges'] = () => {throw new Error('Changed files unavailable: the Worktree directory could not be read. Retry to check it again.')};
          // An Agent's idle status reads what it owns again (U7186c); the failed read shows in the Toast region.
          window.__fake.setStatus(node.id, 'idle', 'ready');
          return node.id;
        })()`);

        // U7205c: hover overlays a row's end with its controls, so the click lands on the row's start (its state glyph), not its centre.
        await browser("click", `.rail-row[data-id="${selected}"] .row-state`);
        await until("!!document.querySelector('.app-toasts [role=alert]')");
        await capture(lane, "tree-40-failed-read");
      }

      if (seed !== "resources") continue;

      const icon = '.rail-row[data-id="worktree-agent"] .changes-icon';

      for (const count of [0, 1, 500]) {
        await evaluate(`window.__fake.app.handlers['agent.ownedChanges'] = () => ({groups: ${count === 0 ? "[]" : `[{repo: '/p/worktree-agent', branch: 'roundup/' + 'long-branch-'.repeat(20), base: 'main', files: Array.from({length:${count}}, (_, n) => ({path:'folder/' + 'p'.repeat(120) + n + '.ts', status:'modified', line:1, counts:{added:1, removed:0}}))}]`}})`);
        // An Agent's idle status reads what it owns again, including the empty→nonempty case.
        await evaluate("window.__fake.setStatus('worktree-agent', 'idle', 'ready')");
        await browser("click", '.rail-row[data-id="worktree-agent"] .row-state');

        if (count === 0) {
          await until(`!document.querySelector('${icon}')`);
          await capture(lane, "changes-0");
        } else {
          await until(`document.querySelector('${icon} .changes-count')?.textContent === '${count}'`);
          await browser("click", icon);
          await until("!!document.querySelector('.changes-view .changes-side file-tree-container')");
          await capture(lane, `changes-${count}`);
          await browser("click", ".changes-head button");
          await until("!document.querySelector('.changes-view')");
        }
      }

      await evaluate("window.__fake.app.handlers['agent.ownedChanges'] = () => { throw new Error('Changed files unavailable: the Worktree directory could not be read. Retry to check it again.') }");
      await evaluate("window.__fake.setStatus('worktree-agent', 'idle', 'ready')");
      await browser("click", '.rail-row[data-id="worktree-agent"] .row-state');
      await until("!!document.querySelector('.app-toasts [role=alert]')");
      await capture(lane, "failed-read");
  }
}, 120_000);
