import { execFile } from "node:child_process";
import { connect } from "node:net";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import * as v from "valibot";
import { startRealDaemon } from "../testing/realDaemonFixture";
import { createServedApp } from "../testing/realSeam";
import { captureDir } from "../testing/captures";
import type { CreateParams as TodoCreate } from "@contracts/todo/CreateParams";
import type { CreateParams as PadCreate } from "@contracts/pad/CreateParams";
import type { Actor } from "@contracts/Actor";
import type { Todo } from "@contracts/todo/Todo";
import type { Pad } from "@contracts/pad/Pad";

const exec = promisify(execFile);

const reply = v.object({ id: v.number(), result: v.optional(v.unknown()), error: v.optional(v.object({ message: v.string() })) });

// The same identified socket as U460's ownerCall seeds provenance the user RPC cannot author.
const actorCall = (socketPath: string, actor: Actor, method: "todo.create" | "pad.create", params: TodoCreate | PadCreate) => new Promise<unknown>((resolve, reject) => {
  const socket = connect(socketPath);
  const timer = setTimeout(() => { socket.destroy(); reject(new Error(`${method} timed out`)); }, 20_000);
  let pending = "";

  const finish = (frame: v.InferOutput<typeof reply>) => {
    clearTimeout(timer);
    socket.destroy();

    if (frame.error) reject(new Error(frame.error.message));
    else resolve(frame.result);
  };

  socket.setEncoding("utf8");
  socket.on("connect", () => socket.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "daemon.identify", params: { actor } }) + "\n"));
  socket.on("error", error => { clearTimeout(timer); socket.destroy(); reject(error); });
  socket.on("data", (chunk: string) => {
    pending += chunk;

    for (let end = pending.indexOf("\n"); end >= 0; end = pending.indexOf("\n")) {
      const frame = v.parse(reply, JSON.parse(pending.slice(0, end)));
      pending = pending.slice(end + 1);

      if (frame.error) finish(frame);
      else if (frame.id === 1) socket.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method, params }) + "\n");
      else finish(frame);
    }
  });
});

it("u2744a_shelf_scope_real_daemon", async () => {
  const real = await startRealDaemon({}, true);
  const profile = mkdtempSync(join(tmpdir(), "u2744a-profile-"));
  const session = `u2744a-${process.pid}`;
  const browser = async (...args: string[]) => (await exec("agent-browser", ["--session", session, "--profile", profile, ...args], { timeout: 60_000 })).stdout;
  // SAFETY: agent-browser serialises the page expression's JSON value.
  const evaluate = async <T,>(source: string): Promise<T> => JSON.parse(await browser("eval", source)) as T;
  const until = (source: string) => browser("wait", "--fn", source);
  const app = createServedApp(real.base);

  const capture = async (step: string) => {
    const dir = captureDir("shelf-scope");

    if (!dir) return;
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${step}.checks.json`), JSON.stringify(await evaluate("window.__checks()")) + "\n");
    await browser("screenshot", join(dir, `${step}.png`));
  };

  try {
    const w = await app.rpc("rail.createWorkstream", { name: "Shelf workstream one", parent: null });
    const other = await app.rpc("rail.createWorkstream", { name: "Shelf workstream two", parent: null });
    const a = await app.rpc("agent.spawn", { cwd: real.dir, prompt: null, parent: w.id, name: "Shelf maker one" });
    const b = await app.rpc("agent.spawn", { cwd: real.dir, prompt: null, parent: other.id, name: "Shelf maker two" });
    const root = await app.rpc("agent.spawn", { cwd: real.dir, prompt: null, parent: null, name: "Shelf root maker" });
    const user: Actor = { kind: "user", id: "you", parent: null };
    const agent = (id: string): Actor => ({ kind: "agent", id, parent: null });
    const makers = [user, agent(a.id), agent(b.id), agent(root.id), agent(w.id), agent("absent-maker"), { kind: "ext", id: "shelf-extension", parent: null } as const];
    const homes = [null, w.id, w.id, null, w.id, w.id, null];

    for (let at = 0; at < makers.length; at++) {
      const title = at === 1 ? "T".repeat(300) : `Shelf item ${at}`;
      const made = await actorCall(join(real.dir, "rupd.sock"), makers[at]!, "todo.create", { title, body: null, blockers: null });
      const id = v.parse(v.object({ id: v.number() }), made).id;
      await app.rpc("todo.move", { id, home: homes[at]! });
      const name = at === 1 ? "p".repeat(120) : `shelf-pad-${at}`;
      await actorCall(join(real.dir, "rupd.sock"), makers[at]!, "pad.create", { name, text: "scope observer" });
      await app.rpc("pad.move", { name, home: homes[at]! });

      if (at === 2) await app.rpc("todo.complete", { id });
    }

    const rootHome = await actorCall(join(real.dir, "rupd.sock"), agent(a.id), "todo.create", { title: "root Home by workstream maker", body: null, blockers: null });
    await app.rpc("todo.move", { id: v.parse(v.object({ id: v.number() }), rootHome).id, home: null });
    await actorCall(join(real.dir, "rupd.sock"), agent(a.id), "pad.create", { name: "root-home-pad", text: "root" });
    await app.rpc("pad.move", { name: "root-home-pad", home: null });
    await app.rpc("agent.stop", { id: a.id });
    await app.rpc("agent.stop", { id: b.id });
    const shell = await app.rpc("terminal.open", { workstream: w.id });
    await app.rpc("terminal.open", { workstream: null });
    await browser("set", "viewport", "1512", "950");
    await browser("open", `${real.base}/harness.html?daemon=1`);
    await browser("wait", ".shelf-tabs");

    const select = async (id: string | null) => {
      await browser("click", id ? `.rail [data-id="${id}"] .name` : "[data-todo-root]");
      await until(id ? `document.querySelector('.rail-row[data-selected="true"]')?.dataset.id === ${JSON.stringify(id)}` : "!document.querySelector('.rail-row[data-selected=\"true\"]')");
    };

    const tab = async (kind: "todos" | "pads") => {
      await evaluate(`(() => { const tab = document.querySelector('#shelf-tab-${kind}'); if (tab.getAttribute('aria-selected') !== 'true') tab.click(); return true; })()`);
      await until(`!!document.querySelector('#shelf-panel-${kind}:not([hidden])')`);
    };

    const expand = async () => {
      await evaluate(`(() => { document.querySelectorAll('.shelf [data-part="branch-control"]').forEach(control => { if (control.closest('[role="treeitem"]').getAttribute('aria-expanded') === 'false') control.click(); }); const done = [...document.querySelectorAll('.shelf-done-line .todo-row-button')][0]; if (done && !document.querySelector('.shelf .todo-tick:checked')) done.click(); return true; })()`);
      await evaluate("new Promise(resolve => requestAnimationFrame(() => resolve(true)))");
    };

    const readback = async (id: string | null, maker = false) => {
      const expectedTodos = (await app.rpc("todo.list", null)).filter(row => id === null || (maker ? row.creator.kind === "agent" && row.creator.id === id : row.home === id));
      const expectedPads = (await app.rpc("pad.list", null)).filter(row => id === null || (maker ? row.owner.kind === "agent" && row.owner.id === id : row.home === id));
      await tab("todos");
      await expand();
      await until(`document.querySelectorAll('#shelf-panel-todos [data-todo]').length === ${expectedTodos.length}`);
      const todoIds = await evaluate<number[]>("[...document.querySelectorAll('#shelf-panel-todos [data-todo]')].map(row => Number(row.dataset.todo))");
      expect(todoIds.toSorted((a, b) => a - b)).toEqual(expectedTodos.map(row => row.id).toSorted((a, b) => a - b));
      await tab("pads");
      await expand();
      await until(`document.querySelectorAll('#shelf-panel-pads .pad-name').length === ${expectedPads.length}`);
      expect((await evaluate<string[]>("[...document.querySelectorAll('#shelf-panel-pads .pad-name')].map(row => row.textContent)")).toSorted()).toEqual(expectedPads.map(row => row.name).toSorted());
      await tab("todos");
    };

    for (const scheme of ["light", "dark"]) {
      await browser("set", "media", scheme);
      await select(null);
      await tab("todos");
      await capture(`${scheme}-overview-folded`);
      await readback(null);
      await capture(`${scheme}-overview-open`);
      await select(w.id);
      await readback(w.id);
      await capture(`${scheme}-workstream`);
      await browser("click", `.terminal-tab[data-bubble="${shell.terminal_id}"]`);
      await readback(w.id);
      await select(a.id);
      await readback(a.id, true);
      await capture(`${scheme}-agent`);
      await select(other.id);
      await readback(other.id);
      await select(b.id);
      await readback(b.id, true);
      await select(root.id);
      await readback(root.id, true);
    }

    await select(w.id);
    await app.rpc("rail.rename", { id: w.id, name: "Renamed Shelf workstream" });
    await until("document.querySelector('[data-shelf-scope]')?.textContent === 'Renamed Shelf workstream'");
    const all: Todo[] = await app.rpc("todo.list", null);
    await app.rpc("todo.move", { id: all.find(row => row.creator.id === a.id)!.id, home: other.id });
    const allPads: Pad[] = await app.rpc("pad.list", null);
    await app.rpc("pad.setOwner", { name: allPads.find(row => row.owner.id === a.id)!.name, owner: user });
    await readback(w.id);
    await select(a.id);
    await readback(a.id, true);

    for (const scheme of ["light", "dark"]) {
      await browser("set", "media", scheme);
      await browser("open", `${real.base}/harness.html?seed=first-run`);
      await browser("wait", ".shelf-tabs");
      await capture(`${scheme}-first-run`);
    }
  } finally {
    await browser("close").catch(() => undefined);
    await real.stop();
    rmSync(profile, { recursive: true, force: true });
  }
}, 240_000);
