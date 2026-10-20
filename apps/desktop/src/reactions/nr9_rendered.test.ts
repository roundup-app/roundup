import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it, vi } from "vitest";
import type { RailNode } from "@contracts/agent/RailNode";
import type { Reaction } from "@contracts/reaction/Reaction";
import { startRealDaemon } from "../testing/realDaemonFixture";
import { createServedApp } from "../testing/realSeam";
import { chromePath } from "../testing/chromePage";
import { captureDir } from "../testing/captures";

const execute = promisify(execFile);

it("nr9_cli_mcp_and_app_share_authority", async () => {
  const real = await startRealDaemon({}, true);
  const profile = await mkdtemp(join(tmpdir(), "nr9-browser-"));
  const config = join(profile, "config.json");
  await writeFile(config, "{}");
  const executable = chromePath();

  if (!executable) throw new Error("NR9 needs headless Chromium");
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("AGENT_BROWSER_")));
  const session = `nr9-${process.pid}`;

  const browser = async (...args: string[]) => {
    const { stdout } = await execute("agent-browser", ["--executable-path", executable, "--args", "--no-sandbox", "--config", config, "--session", session, "--profile", profile, "--json", ...args], { env, timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
    const answer = JSON.parse(stdout);

    if (!answer.success) throw new Error(stdout);

    return answer.data;
  };

  const evaluate = async (source: string) => (await browser("eval", source)).result;
  const wait = (source: string) => browser("wait", "--fn", source);
  const app = createServedApp(real.base);
  const socketEnv = { ...process.env, RUPD_SOCKET: join(real.dir, "rupd.sock") };
  const cli = (...args: string[]) => execute(resolve("../../target/debug/rup"), ["--json", ...args], { env: socketEnv });

  const capture = async (step: string, screenshot = true) => {
    const dir = captureDir("NR9");

    if (!dir) return;
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${step}.checks.json`), JSON.stringify(await evaluate("window.__checks()")));

    if (screenshot) await browser("screenshot", join(dir, `${step}.png`));
  };

  const activate = async (selector: string, keyboard = false) => {
    await wait(`!!document.querySelector(${JSON.stringify(selector)})`);

    if (keyboard) {
      await evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);
      await browser("press", "Enter");
    } else await browser("click", selector);
  };

  try {
    const agents: RailNode[] = [];

    for (let n = 0; n < 10; n += 1) agents.push(await app.rpc("agent.spawn", { cwd: real.dir, prompt: null, parent: null, name: `Same long Agent name ${n % 2}` }));
    const target = agents[0]!;
    await app.rpc("takeover.begin", { agent: target.id });
    const expires = new Date(Date.now() + 86_400_000).toISOString();
    const at = new Date(Date.now() + 43_200_000).toISOString();
    const resolved = await app.rpc("reaction.preview", { date: at.slice(0, 10), time: at.slice(11, 19), offset: "+00:00" });
    const created: Reaction = JSON.parse((await cli("--agent", target.id, "reaction", "create", "cli-create", "Saved reaction", target.id, "exact instruction\n retained ", expires, "--condition", JSON.stringify({ kind: "instant", at: resolved.at, late: "once-before-expiry" }))).stdout);

    // The MCP shim resolves the connection's Actor, rather than accepting the App user's authority.
    const mcp = spawn(resolve("../../target/debug/rup"), ["mcp", agents[1]!.id], { env: socketEnv, stdio: ["pipe", "pipe", "pipe"] });

    try {
      const reply = new Promise<string>((done, fail) => {
        let pending = "";
        mcp.stdout.on("data", chunk => {
          pending += String(chunk);

          for (let newline = pending.indexOf("\n"); newline >= 0; newline = pending.indexOf("\n")) {
            const message = JSON.parse(pending.slice(0, newline));
            pending = pending.slice(newline + 1);

            if (message.id === 2) done(JSON.stringify(message));
          }
        });
        mcp.on("error", fail);
        mcp.on("exit", () => fail(new Error("MCP ended before its reply")));
      });

      for (const message of [
        { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "NR9", version: "1" } } },
        { jsonrpc: "2.0", method: "notifications/initialized" },
        { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "reaction_stop", arguments: { id: created.id } } },
      ]) mcp.stdin.write(JSON.stringify(message) + "\n");
      const refused = await reply;
      expect(refused).toContain('"isError":true');
      expect(refused).toContain("-32002");
      expect((await app.rpc("reaction.get", { id: created.id })).state).toBe("active");
    } finally { mcp.kill(); }

    await browser("open", `${real.base}/harness.html?seed=agents-10`);
    await browser("set", "viewport", "1512", "950");
    await browser("set", "media", "dark");
    await activate('.rail [data-todo-root]');
    await wait("document.querySelector('.reaction-empty')?.textContent.includes('No named reactions')");
    await capture("empty");
    await browser("open", `${real.base}/harness.html?daemon=1`);
    await browser("set", "viewport", "1512", "950");
    await browser("set", "media", "dark");
    await activate('.rail [data-todo-root]');
    await wait("!!document.querySelector('.reaction-row')");
    await capture("list");
    await activate('.reaction-row', true);
    await wait("!!document.querySelector('.reaction-detail')");
    expect(await evaluate("document.querySelector('.reaction-detail').textContent")).toContain(target.id);
    expect((await app.rpc("reaction.get", { id: created.id })).firings).toEqual([]);
    await activate('.reaction-actions button:last-child', true);
    await wait("document.querySelector('.reaction-firings')?.textContent.includes('held')");
    const fired = await app.rpc("reaction.get", { id: created.id });
    expect(fired.firings).toHaveLength(1);
    expect((await app.rpc("message.get", { id: fired.firings[0]!.message })).body).toBe("exact instruction\n retained ");
    await capture("held-detail");
    await activate('[data-firing-message]', true);
    await wait("document.querySelector('.reaction-detail').textContent.includes('takeover')");
    await capture("message");
    await activate('.reaction-back', true);
    await wait("document.activeElement?.matches('.reaction-row')");
    await activate('[data-reaction-opener="create"]', true);
    await wait("!!document.querySelector('.reaction-form')");
    await activate('.reaction-form .app-select-trigger');
    await activate('.app-select-list [role="option"]:nth-child(2)');
    await wait("document.querySelector('.reaction-form .app-select-trigger').textContent.includes('(1)')");
    await evaluate(`(() => {
      const field = (label, value) => {
        const element = [...document.querySelectorAll('.reaction-field')].find(el => el.querySelector('span').textContent === label).querySelector('input,textarea');
        element.value = value; element.dispatchEvent(new Event('input', { bubbles: true }));
      };
      field('Name', 'Form reaction'); field('Instruction', ' exact newer\\n words 🧭 ');
      field('Date', ${JSON.stringify(expires.slice(0, 10))}); field('Time', ${JSON.stringify(expires.slice(11, 16))}); field('UTC offset', '+00:00');
    })()`);
    await evaluate("document.querySelector('.app-checkbox input').focus()");
    await browser("press", "Space");
    await browser("press", "Tab");
    await capture("form");
    await browser("set", "media", "light");
    await wait("matchMedia('(prefers-color-scheme: light)').matches");
    await capture("light-form", false);
    await browser("set", "media", "dark");
    await wait("matchMedia('(prefers-color-scheme: dark)').matches");

    await evaluate("document.querySelector('.reaction-form .reaction-actions button').scrollIntoView({ block: 'center' })");
    await capture("form-bottom");
    await wait("!document.querySelector('.reaction-form .reaction-actions button').disabled");
    await evaluate(`(() => {
      const send = window.fetch;
      let refused = false;
      window.fetch = (url, options) => {
        if (!refused && options?.body && JSON.parse(options.body).method === 'reaction.create') {
          refused = true;
          return Promise.resolve(new Response(JSON.stringify({ error: { code: -32003, message: 'Creation refused for observation' } })));
        }
        return send(url, options);
      };
    })()`);
    await activate('.reaction-form .reaction-actions button', true);
    await wait("document.querySelector('.reaction-form').textContent.includes('Creation refused for observation')");
    await capture("failed-create");
    expect(await evaluate("document.querySelector('.reaction-form textarea').value")).toBe(" exact newer\n words 🧭 ");
    await activate('.reaction-form .reaction-actions button', true);
    await wait("document.querySelector('.reaction-detail')?.textContent.includes('Form reaction')");
    const formReaction = (await app.rpc("reaction.list", null)).find(reaction => reaction.name === "Form reaction")!;
    expect(formReaction.instruction).toBe(" exact newer\n words 🧭 ");
    expect(formReaction.target).toBe(target.id);
    await capture("created");
    await browser("reload");
    await wait("!!document.querySelector('.reaction-row')");
    expect((await app.rpc("reaction.get", { id: created.id })).firings).toHaveLength(1);
    const source = agents[9]!;
    await app.rpc("agent.signal", { id: source.id, attempt: source.attempt!, payload: { hook_event_name: "UserPromptSubmit" } });
    const remainingSource = (await app.rpc("rail.tree", null)).find(node => node.id === agents[8]!.id)!;
    await app.rpc("agent.signal", { id: remainingSource.id, attempt: remainingSource.attempt!, payload: { hook_event_name: "UserPromptSubmit" } });
    const unavailable = await app.rpc("reaction.create", { operation: "unavailable", name: "Unavailable observation", target: target.id, instruction: "wait", condition: { kind: "agents", ids: [source.id, agents[8]!.id], any: false }, expires_at: expires });
    await app.rpc("rail.remove", { id: source.id });
    await vi.waitUntil(async () => (await app.rpc("reaction.get", { id: unavailable.id })).observation.health === "unavailable", { timeout: 20_000 });
    await evaluate("window.dispatchEvent(new Event('focus'))");
    await activate(`[data-reaction-opener="${unavailable.id}"]`);
    await wait("document.querySelector('.reaction-detail')?.textContent.includes('unavailable')");
    await capture("unavailable");
    await activate('.reaction-back');
    await app.rpc("rail.remove", { id: target.id });
    await evaluate("window.dispatchEvent(new Event('focus'))");
    await activate(`[data-reaction-opener="${created.id}"]`);
    await wait("document.querySelector('.reaction-firings')?.textContent.includes('dropped')");
    await capture("dropped");

    for (const node of await app.rpc("rail.tree", null)) await app.rpc("rail.remove", { id: node.id });
    await browser("reload");
    await activate(`[data-reaction-opener="${created.id}"]`);
    await wait("document.querySelector('.reaction-detail')?.textContent.includes('not in this Project')");
    await capture("retired-project");
    await browser("set", "media", "light");
    await wait("matchMedia('(prefers-color-scheme: light)').matches");
    expect(await evaluate("document.querySelector('.reaction-detail').textContent")).toContain(target.id);
  } finally {
    await browser("close").catch(() => {});
    await real.stop();
    await rm(profile, { recursive: true, force: true });
  }
}, 180_000);
