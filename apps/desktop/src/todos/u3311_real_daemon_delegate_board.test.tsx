import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import type { Todo } from "@contracts/todo/Todo";
import type { Actor } from "@contracts/Actor";
import { captureDir } from "../testing/captures";
import { chromePath } from "../testing/chromePage";
import { startRealDaemon } from "../testing/realDaemonFixture";
import { createServedApp } from "../testing/realSeam";

const execute = promisify(execFile);

// U3311 requires real pointer and keyboard input; jsdom cannot observe group drop targets.
it("u3311_real_daemon_delegate_board", async () => {
  const executable = chromePath();

  if (!executable) throw new Error("U3311 needs a Chrome binary");
  const fixture = await mkdtemp(join(tmpdir(), "u3311-door-"));
  const script = join(fixture, "assign.py");
  const target = join(fixture, "target.json");
  // A deterministic fake Door reads its actual delivered Auto Message, then uses the public CLI.
  // It never selects work before that Message exists; no App-side assignment simulates Auto.
  await writeFile(script, `import json, os, subprocess, time
from pathlib import Path
config = Path(${JSON.stringify(target)})
end = time.monotonic() + 150
while time.monotonic() < end:
    if config.exists():
        chosen = json.loads(config.read_text())
        result = subprocess.run(["rup", "--json", "message", "list"], capture_output=True, text=True)
        if result.returncode == 0:
            messages = json.loads(result.stdout)
            notice = next((m for m in messages if "Auto acceptance" in m["body"] and m["status"] == "delivered"), None)
            if notice:
                result = subprocess.run(["rup", "--json", "todo", "assign", str(chosen["todo"]), "--owner", json.dumps(chosen["owner"])], capture_output=True, text=True)
                config.with_suffix(".result").write_text(json.dumps({"message":notice,"code":result.returncode,"stdout":result.stdout,"stderr":result.stderr}))
                break
    time.sleep(0.05)
`);
  const real = await startRealDaemon({ FAKE_CLAUDE_DOOR_PROCESS: JSON.stringify(["python3", script]), FAKE_CLAUDE_PROMPT_LOG: join(fixture, "prompts.jsonl") }, true);
  const profile = await mkdtemp(join(tmpdir(), "u3311-browser-"));
  const config = join(profile, "agent-browser-config.json");
  await writeFile(config, "{}");
  const session = `u3311-${process.pid}`;
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("AGENT_BROWSER_")));

  const browser = async (...args: string[]) => {
    const { stdout } = await execute("agent-browser", ["--executable-path", executable, "--args", "--no-sandbox", "--config", config, "--session", session, "--profile", profile, "--json", ...args], { env, timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
    const reply = JSON.parse(stdout);
    expect(reply.success, stdout).toBe(true);

    return reply.data;
  };

  const evaluate = async (source: string) => (await browser("eval", source)).result;
  const until = (source: string) => browser("wait", "--fn", source);
  const group = (id: string) => `.shelf [data-shelf-group="${id}"]`;
  const row = (id: number) => `.shelf [data-todo="${id}"] .shelf-title`;
  const point = (selector: string) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.scrollIntoView({block:'center'}); const b = el.getBoundingClientRect(); return {x: Math.round(b.left + b.width/2), y: Math.round(b.top + b.height/2)}; })()`);
  const app = createServedApp(real.base);
  const me: Actor = { kind: "user", id: "you", parent: null };
  const expected = new Map<number, { owner: Actor | null; group: string }>();

  const observe = async (id: number, owner: Actor | null, target: string) => {
    await until(`document.querySelector('.shelf [data-todo="${id}"]')?.closest('[data-shelf-group]')?.dataset.shelfGroup === ${JSON.stringify(target)}`);
    expect((await app.rpc("todo.list", null)).find(todo => todo.id === id)?.owner).toEqual(owner);
    expect(await evaluate("document.activeElement === document.body")).toBe(false);
    expected.set(id, { owner, group: target });
  };

  const capture = async (step: string) => {
    const dir = captureDir("delegate-board");

    if (!dir) return;
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${step}.checks.json`), JSON.stringify(await evaluate("window.__checks()")) + "\n");
    await browser("screenshot", join(dir, `${step}.png`));
  };

  const lift = async (id: number) => {
    const from = await point(row(id));
    await browser("mouse", "move", String(from.x), String(from.y));
    await browser("mouse", "down");
    await browser("mouse", "move", String(from.x), String(from.y - 6));
    await until(`!!document.querySelector('[data-dnd-placeholder]')`);
  };

  const drop = async (target: string) => {
    const to = await point(`${group(target)} .shelf-group-head`);
    await browser("mouse", "move", String(to.x), String(to.y));
    await until(`!!document.querySelector('${group(target)}[data-drop-target], ${group(target)} [data-drop-target]')`);
    await browser("mouse", "up");
  };

  try {
    const home = await app.rpc("rail.createWorkstream", { name: "Delegate Board", parent: null, order: { kind: "clarification", question: "Hand out the Todos" } });
    await app.rpc("rail.startDoor", { id: home.id });
    const agents = [];

    for (const name of ["Writer", "Reviewer"]) agents.push(await app.rpc("agent.spawn", { cwd: real.dir, prompt: null, parent: home.id, name }));
    const actor = (id: string): Actor => ({ kind: "agent", id, parent: null });
    const owners = [me, ...agents.map(agent => actor(agent.id)), null];
    const made: Todo[] = [];

    for (const [at, owner] of owners.entries()) {
      const params = { title: `Queue ${at}`, body: null, blockers: null, estimate_minutes: 15 * (at + 1) };
      const todo = await app.rpc("todo.create", owner ? { ...params, owner } : params);
      await app.rpc("todo.move", { id: todo.id, home: home.id });
      made.push(todo);
    }

    const auto = await app.rpc("todo.create", { title: "Auto acceptance", body: null, blockers: null, estimate_minutes: 10 });
    await app.rpc("todo.move", { id: auto.id, home: home.id });
    await writeFile(target, JSON.stringify({ todo: auto.id, owner: actor(agents[1]!.id) }));
    await browser("set", "viewport", "1512", "950");
    await browser("set", "media", "dark");
    await browser("open", `${real.base}/harness.html?daemon=1`);
    await browser("wait", "#shelf-tab-todos");
    await browser("click", `[data-id="${home.id}"] > .rail-row`);
    await evaluate("(() => { const tab = document.querySelector('#shelf-tab-todos'); if (tab.getAttribute('aria-expanded') !== 'true') tab.click(); return true; })()");
    await until(`!!document.querySelector('${group("unassigned")}')`);
    await evaluate(`(() => { const g = document.querySelector('${group("unassigned")}'); if (g.dataset.state === 'closed') g.querySelector('[data-part="branch-control"]').click(); return true; })()`);
    await until(`!!document.querySelector('${row(made[3]!.id)}')`);
    await capture("dark-before");

    await browser("focus", `.shelf [data-todo="${made[3]!.id}"] .todo-row-button`);
    await lift(made[3]!.id);
    const to = await point(`${group(agents[0]!.id)} .shelf-group-head`);
    const before = await evaluate(`document.querySelector('${group(agents[0]!.id)} .shelf-owner-time').textContent`);
    await browser("mouse", "move", String(to.x), String(to.y));
    await until(`!!document.querySelector('[data-drop-target]')`);
    expect(await evaluate(`document.querySelector('${group(agents[0]!.id)} .shelf-owner-time').textContent`)).not.toBe(before);
    await capture("dark-drag-preview");
    await browser("press", "Escape");
    await browser("mouse", "up");
    expect(await evaluate(`document.querySelector('${group(agents[0]!.id)} .shelf-owner-time').textContent`)).toBe(before);
    await lift(made[3]!.id);
    await drop(agents[0]!.id);
    await observe(made[3]!.id, actor(agents[0]!.id), agents[0]!.id);

    const press = (key: string, code = key) => evaluate(`(() => { const target = document.activeElement; target.dispatchEvent(new KeyboardEvent('keydown', {key:${JSON.stringify(key)},code:${JSON.stringify(code)},bubbles:true})); target.dispatchEvent(new KeyboardEvent('keyup', {key:${JSON.stringify(key)},code:${JSON.stringify(code)},bubbles:true})); return true; })()`);
    await browser("focus", `.shelf [data-todo="${made[0]!.id}"] .todo-row-button`);
    await press("3", "Digit3");
    await observe(made[0]!.id, actor(agents[1]!.id), agents[1]!.id);
    await browser("focus", `.shelf [data-todo="${made[1]!.id}"] .todo-row-button`);
    await press("Enter");
    await press("ArrowDown");
    await press("Enter");
    await observe(made[1]!.id, actor(agents[1]!.id), agents[1]!.id);
    await capture("dark-key-hand-off");

    const time = await evaluate(`document.querySelector('${group(agents[1]!.id)} .shelf-owner-time').textContent`);
    expect(time).toContain("busy until");
    await browser("focus", '[role="switch"]');
    await browser("press", "Space");
    await until(`document.querySelector('[role="switch"]').getAttribute('aria-checked') === 'true'`);
    await observe(auto.id, actor(agents[1]!.id), agents[1]!.id);
    const response = JSON.parse(await readFile(join(fixture, "target.result"), "utf8"));
    expect(response.code).toBe(0);
    expect(response.message.body).toContain(`#${auto.id}`);
    await capture("dark-auto-on");

    await browser("reload");
    await browser("wait", "#shelf-tab-todos");
    await browser("focus", "#shelf-tab-todos");

    for (const [id, target] of expected) await observe(id, target.owner, target.group);
    expect((await app.rpc("todo.list", null)).find(todo => todo.id === made[2]!.id)?.owner).toEqual(actor(agents[1]!.id));
    expect(await evaluate(`document.querySelector('[role="switch"]').getAttribute('aria-checked')`)).toBe("true");
  } catch (error) {
    console.error(await evaluate("document.body.innerText").catch(() => "browser unavailable"));
    throw error;
  } finally {
    try { await browser("close"); } finally { await real.stop(); await rm(profile, { recursive: true, force: true }); await rm(fixture, { recursive: true, force: true }); }
  }
}, 240_000);
