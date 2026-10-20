import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import type { Actor } from "@contracts/Actor";
import { captureDir } from "../testing/captures";
import { chromePath } from "../testing/chromePage";
import { startRealDaemon } from "../testing/realDaemonFixture";
import { createServedApp } from "../testing/realSeam";

const execute = promisify(execFile);

// Replaces the jsdom readback: only this browser observer proves pointer drops,
// keyboard assignment and group creation reach the real Daemon and survive reload.
it("u3720_real_daemon_owner_assign", async () => {
  const executable = chromePath();

  if (!executable) throw new Error("U3720 needs a Chrome binary");
  const real = await startRealDaemon({}, true);
  const profile = await mkdtemp(join(tmpdir(), "u3720-browser-"));
  const config = join(profile, "agent-browser-config.json");
  await writeFile(config, "{}");
  const session = `u3720-${process.pid}`;
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
    const dir = captureDir("shelf-owner");

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
    await until(`!!document.querySelector('${group("me")}')`);
  };
  const drop = async (target: string) => {
    const to = await point(`${group(target)} .shelf-group-head`);
    await browser("mouse", "move", String(to.x), String(to.y));
    await until(`!!document.querySelector('${group(target)}[data-drop-target], ${group(target)} [data-drop-target]')`);
    await browser("mouse", "up");
  };

  try {
    const agents = [];
    for (const name of ["Owner alpha", "Owner beta"]) agents.push(await app.rpc("agent.spawn", { cwd: real.dir, prompt: null, parent: null, name }));
    const actor = (id: string): Actor => ({ kind: "agent", id, parent: null });
    const owners = [{ id: "me", label: "Me", actor: me }, ...agents.map(agent => ({ id: agent.id, label: agent.name!, actor: actor(agent.id) })), { id: "unassigned", label: "Unassigned", actor: null }];
    for (const owner of owners) await app.rpc("todo.create", { title: `initial ${owner.label}`, body: null, blockers: null, owner: owner.actor });
    const moved = await app.rpc("todo.create", { title: "pointer assignment", body: null, blockers: null });
    const keyed = await app.rpc("todo.create", { title: "keyboard assignment", body: null, blockers: null, owner: me });
    await browser("set", "viewport", "1512", "950");
    await browser("set", "media", "dark");
    await browser("open", `${real.base}/harness.html?daemon=1`);
    await browser("wait", "#shelf-tab-todos");
    await browser("click", "#shelf-tab-todos");
    await until(`!!document.querySelector('${group("unassigned")}')`);
    await browser("click", `${group("unassigned")} [data-part="branch-control"]`);
    await until(`!!document.querySelector('${row(moved.id)}') && !document.querySelector('${row(moved.id)}').closest('[hidden]')`);

    // The folded Agent header takes a pointer drop without unfolding first.
    await browser("click", `${group(agents[0]!.id)} [data-part="branch-control"]`);
    await until(`document.querySelector('${group(agents[0]!.id)} [data-part="branch-content"]').hidden`);
    await lift(moved.id);
    const target = await point(`${group(agents[0]!.id)} .shelf-group-head`);
    await browser("mouse", "move", String(target.x), String(target.y));
    await until(`!!document.querySelector('[data-drop-target]')`);
    await capture("dark-drag-over-folded-group");
    await browser("mouse", "up");
    await observe(moved.id, actor(agents[0]!.id), agents[0]!.id);
    await browser("click", `${group(agents[0]!.id)} [data-part="branch-control"]`);
    await until(`!document.querySelector('${row(moved.id)}').closest('[hidden]')`);
    await lift(moved.id);
    await drop("me");
    await observe(moved.id, me, "me");

    await browser("focus", `.shelf [data-todo="${keyed.id}"] .todo-row-button`);
    await browser("press", "o");
    await browser("wait", "[role=menu]");
    await browser("press", "ArrowDown");
    await browser("press", "Enter");
    await observe(keyed.id, actor(agents[0]!.id), agents[0]!.id);
    await until(`document.activeElement.closest('[data-todo]')?.dataset.todo === '${keyed.id}'`);

    for (const owner of owners) {
      await browser("click", `button[aria-label="add todo to ${owner.label}"]`);
      await until(`document.activeElement.matches('input[aria-label="New Todo title"]')`);
      if (owner.id === "me") await capture("dark-new-todo-field");
      await browser("fill", 'input[aria-label="New Todo title"]', `added ${owner.label}`);
      await browser("press", "Enter");
      await until(`!document.querySelector('input[aria-label="New Todo title"]')`);
      const made = (await app.rpc("todo.list", null)).find(todo => todo.title === `added ${owner.label}`)!;
      await observe(made.id, owner.actor, owner.id);
    }

    await browser("reload");
    await browser("wait", "#shelf-tab-todos");
    await browser("focus", "#shelf-tab-todos");
    await until(`!!document.querySelector('${group("me")}')`);
    for (const [id, target] of expected) await observe(id, target.owner, target.group);

    // Remove an owner after lifting, before releasing on its stale header.
    await lift(moved.id);
    const stale = await point(`${group(agents[1]!.id)} .shelf-group-head`);
    // Hold only the Rail refetch so the in-flight gesture retains its target;
    // todo.assign still reaches the real Daemon and must refuse the removed id.
    await evaluate(`(() => { const fetch = window.fetch.bind(window); window.fetch = (url, options) => String(url).endsWith('/__daemon/rpc') && JSON.parse(options.body).method === 'rail.tree' ? new Promise(() => {}) : fetch(url, options); return true; })()`);
    await app.rpc("rail.remove", { id: agents[1]!.id });
    await browser("mouse", "move", String(stale.x), String(stale.y));
    await browser("mouse", "up");
    await until(`!!document.querySelector('.shelf [data-todo="${moved.id}"] [role="alert"]')`);
    await observe(moved.id, me, "me");
    expect(await evaluate(`document.querySelector('.shelf [data-todo="${moved.id}"] [role="alert"]').textContent`)).toMatch(/agent|owner|found|exist/i);
  } finally {
    try { await browser("close"); } finally { await real.stop(); await rm(profile, { recursive: true, force: true }); }
  }
}, 240_000);
