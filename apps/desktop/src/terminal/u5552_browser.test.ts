import type { RailNode } from "@contracts/agent/RailNode";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it, vi } from "vitest";
import { chromePath } from "../testing/chromePage";
import { startRealDaemon } from "../testing/realDaemonFixture";
import { createServedApp } from "../testing/realSeam";
import { captureDir } from "../testing/captures";

it("u5552a_restored_paste_reaches_only_the_focused_program", async () => {
  const execute = promisify(execFile);
  const profile = await mkdtemp(join(tmpdir(), "u5552-browser-"));
  const logs = await mkdtemp(join(tmpdir(), "u5552-input-"));
  const config = join(profile, "config.json");
  await writeFile(config, "{}");
  // The existing fake vendor starts a child with its settings environment. Each
  // raw PTY reader logs exact received bytes under its Agent identity.
  const program = `import os,tty,sys\ntty.setraw(0)\np=os.path.join(${JSON.stringify(logs)},os.environ['ROUNDUP_AGENT_ID'])\nopen(p,'wb').close()\nsys.stdout.write('\\x1b[?2004hREADY');sys.stdout.flush()\nwhile True:\n b=os.read(0,4096)\n if not b: break\n with open(p,'ab') as f: f.write(b);f.flush()\n`;
  const real = await startRealDaemon({ FAKE_CLAUDE_CHILD_PROCESS: JSON.stringify(["python3", "-u", "-c", program]) }, true);
  const app = createServedApp(real.base);
  const session = `u5552-${process.pid}`;
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("AGENT_BROWSER_")));

  const browser = async (...args: string[]) => {
    const { stdout } = await execute("agent-browser", ["--executable-path", chromePath()!, "--args", "--no-sandbox", "--config", config, "--profile", profile, "--session", session, "--json", ...args], { env, timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
    const reply = JSON.parse(stdout);

    if (!reply.success) throw new Error(reply.error);

    return reply.data;
  };

  const wait = (expression: string) => browser("wait", "--fn", expression);
  const read = async (expression: string) => (await browser("eval", expression)).result;
  const input = (id: string) => `document.activeElement?.closest('[data-terminal]')?.dataset.terminal === '${id}' && document.activeElement.matches('textarea')`;

  try {
    const agents: RailNode[] = [];

    for (const name of ["First", "Second"]) agents.push(await app.rpc("agent.spawn", { cwd: real.dir, parent: null, prompt: null, name, order: { kind: "work", ask: "inspect", limits: [] } }));

    for (const agent of agents) await vi.waitFor(async () => expect(await readFile(join(logs, agent.id))).toHaveLength(0), { timeout: 20_000 });
    await browser("open", `${real.base}/harness.html?daemon=1&view=workstreams&items=1&tabs=1`);
    await browser("set", "viewport", "1512", "950");
    await browser("set", "media", "dark");

    for (const agent of agents) {
      console.info("initial terminal", agent.id);
      await wait(`!!document.querySelector('.rail-row[data-id="${agent.id}"]')`);
      await browser("click", `.rail-row[data-id="${agent.id}"]`);
      await wait(`!!document.querySelector('[data-terminal="${agent.terminal_id}"] textarea')`);
      await browser("click", `[data-terminal="${agent.terminal_id}"] .xterm-screen`);
      await wait(input(agent.terminal_id!));
    }

    // Reload the webview only: both Daemon and fake-vendor PTYs stay alive.
    await browser("reload");
    await wait(`!!document.querySelector('.rail-row[data-id="${agents[0]!.id}"]')`);
    await read(`(() => { const fetch = window.fetch.bind(window); window.__writes = []; window.fetch = (url, options) => { if (String(url).endsWith('/__daemon/rpc')) { const call = JSON.parse(options.body); if (call.method === 'terminal.write') window.__writes.push(call.params); } return fetch(url, options); }; })()`);
    const received = ["", ""];

    for (const [step, index] of [0, 1, 0].entries()) {
      const agent = agents[index]!;
      console.info("restored paste", step, agent.id);

      if (step === 1) {
        // Existing Rail keyboard opening: focus the second row and Return.
        await browser("focus", `.rail-row[data-id="${agent.id}"]`);
        await browser("press", "Enter");
      } else {
        await browser("click", `.rail-row[data-id="${agent.id}"]`);
        await wait(`!!document.querySelector('[data-terminal="${agent.terminal_id}"] textarea')`);
        await browser("click", `[data-terminal="${agent.terminal_id}"] .xterm-screen`);
      }

      await wait(input(agent.terminal_id!));
      const payload = [`first 界\nline α`, `second λ\nline 二`, `third 雨\nline β`][step]!;
      await read(`(() => { const data = new DataTransfer(); data.setData('text/plain', ${JSON.stringify(payload)}); document.activeElement.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data })); })()`);
      const framed = `\x1b[200~${payload.replaceAll("\n", "\r")}\x1b[201~`;
      received[index] += framed;
      await vi.waitFor(async () => expect(await readFile(join(logs, agent.id), "utf8")).toBe(received[index]), { timeout: 20_000 });
      expect(await readFile(join(logs, agents[1 - index]!.id), "utf8")).toBe(received[1 - index]);
      expect(await read("window.__writes.map(call => ({id:call.id, data:call.data}))")).toEqual([...Array(step + 1)].map((_, n) => ({ id: agents[[0, 1, 0][n]!]!.terminal_id, data: Buffer.from(`\x1b[200~${[`first 界\nline α`, `second λ\nline 二`, `third 雨\nline β`][n]!.replaceAll("\n", "\r")}\x1b[201~`).toString("base64") })));
      const out = captureDir("U5552a");

      if (out) {
        await mkdir(out, { recursive: true });
        await browser("screenshot", join(out, `restored-paste-${step}.png`));
        await writeFile(join(out, `restored-paste-${step}.checks.json`), JSON.stringify(await read("window.__checks()"), null, 2));
      }
    }
  } catch (error) {
    console.error(await read("({active:document.activeElement.tagName+':'+document.activeElement.className,terminals:[...document.querySelectorAll('[data-terminal]')].map(el=>({id:el.dataset.terminal,hidden:el.closest('[hidden]')?.outerHTML.slice(0,200)})),body:document.body.innerText.slice(0,1500)})"));
    throw error;
  } finally {
    await browser("close");
    await real.stop();
    await rm(logs, { recursive: true, force: true });
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}, 180_000);
