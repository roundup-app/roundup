import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { captureDir } from "./captures";
import type { Checks } from "./checks";
import { startRealDaemon } from "./realDaemonFixture";
import { createServedApp } from "./realSeam";

const execute = promisify(execFile);
const ART = captureDir("U463");

for (const width of [1280, 1440]) for (const input of ["keyboard", "pointer"] as const) {
  it(`u463_first_run_chooses_the_configured_project_and_reaches_its_real_thread ${width} ${input}`, async () => {
    const real = await startRealDaemon({ FAKE_CLAUDE_ON_PROMPT: JSON.stringify({ name: "todo_create", arguments: { title: "$prompt" } }) }, true);
    const profile = await mkdtemp(join(tmpdir(), "u463-browser-"));
    const session = `u463-${process.pid}-${width}-${input}`;
    const browser = async (...args: string[]) => {
      const { stdout } = await execute("agent-browser", ["--session", session, "--profile", profile, "--json", ...args], { timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
      const reply = JSON.parse(stdout);

      expect(reply.success, stdout).toBe(true);

      return reply.data;
    };
    const wait = (expression: string) => browser("wait", "--fn", expression);
    const observe = async (step: string): Promise<Checks> => {
      const checks: Checks = (await browser("eval", "window.__checks()")).result;

      if (ART) {
        await mkdir(ART, { recursive: true });
        const name = `${width}-${input}-${step}`;

        await browser("screenshot", join(ART, `${name}.png`));
        await writeFile(join(ART, `${name}.checks.json`), JSON.stringify(checks, null, 2));
      }

      return checks;
    };
    const activate = async (selector: string) => {
      if (input === "pointer") await browser("click", selector);
      else {
        await browser("focus", selector);
        await browser("press", "Enter");
      }
    };

    try {
      await browser("open", `${real.base}/harness.html?daemon=1&seed=first-run`);
      await browser("set", "viewport", String(width), "800");
      await wait(`document.body.textContent.includes('open a folder to start')`);
      const before = await observe("first-run");

      await activate('[role="region"][aria-label="centre"] button');
      await wait(`document.body.textContent.includes('New Workstream')`);
      const app = createServedApp(real.base);

      expect((await app.projects())[0]?.path).toBe(real.dir);
      await observe("project");
      await activate(".pane-action");
      await wait(`!!document.querySelector('[aria-label="Start Door"]')`);
      await observe("workstream");
      await activate('[aria-label="Start Door"]');
      await wait(`!!document.querySelector('[data-thread-input]') && !!document.querySelector('[role="treeitem"][data-kind="idle"]')`);
      const tree = await app.rpc("rail.tree", null);
      const workstream = tree.find((node) => node.kind === "workstream")!;
      const rendered = (await browser("eval", `({id: document.querySelector('[role="treeitem"][data-id]').dataset.id, terminal: document.querySelector('[data-terminal-id]')?.dataset.terminalId})`)).result;

      expect(rendered.id).toBe(workstream.id);
      expect((await app.rpc("terminal.list", null)).map((terminal) => terminal.id)).toContain(workstream.terminal_id);
      await browser("fill", "[data-thread-input]", "u463 real request");
      await wait(`!document.querySelector('.thread-send').hasAttribute('aria-disabled')`);
      if (input === "keyboard") await browser("press", "Enter");
      else await browser("click", ".thread-send");
      await wait(`document.querySelector('[data-todo]')?.textContent.includes('u463 real request')`);
      expect((await app.rpc("message.list", { to: null, status: null })).map((message) => [message.body, message.status])).toContainEqual(["u463 real request", "delivered"]);
      expect((await app.rpc("todo.list", null)).map((todo) => todo.title)).toContain("u463 real request");
      const after = await observe("thread");

      for (const [id, check] of Object.entries(before)) if (check.status === "pass") expect(after[id as keyof Checks].status, id).toBe("pass");
      for (const id of ["D2", "D5", "D6"] as const) expect(after[id].status, id).toBe("pass");
      expect((await browser("eval", "typeof window.__fake")).result).toBe("undefined");
    } finally {
      await browser("close");
      await real.stop();
      await rm(profile, { recursive: true, force: true });
    }
  }, 180_000);
}
