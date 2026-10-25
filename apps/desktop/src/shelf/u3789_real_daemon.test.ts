import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { startRealDaemon } from "../testing/realDaemonFixture";
import { createServedApp } from "../testing/realSeam";

const execute = promisify(execFile);

it("u3789a_real_daemon_rows", async () => {
  const real = await startRealDaemon({}, true);
  const profile = await mkdtemp(join(tmpdir(), "u3789-real-"));
  const session = `u3789-real-${process.pid}`;

  const browser = async (...args: string[]) => {
    const { stdout } = await execute("agent-browser", ["--session", session, "--profile", profile, "--json", ...args], { timeout: 60_000 });
    const reply = JSON.parse(stdout);

    if (!reply.success) throw new Error(reply.error);

    return reply.data;
  };

  const evaluate = async (source: string) => (await browser("eval", source)).result;
  const until = async (source: string) => { await browser("wait", "--fn", source); };

  const app = createServedApp(real.base);

  try {
    const home = await app.rpc("rail.createWorkstream", { name: "row work", parent: null });
    const door = await app.rpc("rail.startDoor", { id: home.id });
    const child = await app.rpc("agent.spawn", { cwd: real.dir, prompt: null, parent: home.id, model: null, effort: null });
    const todo = await app.rpc("todo.create", { title: "row todo", body: "keep body", blockers: null });
    await app.rpc("todo.move", { id: todo.id, home: home.id });
    const pad = await app.rpc("pad.create", { name: "row pad", text: "keep text" });
    await app.rpc("pad.move", { name: pad.name, home: home.id });
    await browser("set", "viewport", "1512", "950");
    await browser("set", "media", "dark");
    await browser("open", `${real.base}/harness.html?daemon=1`);
    await until(`document.querySelector('.rail-row[data-id="${home.id}"]')`);
    await evaluate(`(() => {
      window.__rowCalls = [];
      const fetch = window.fetch;
      window.fetch = (...args) => { if (String(args[0]).endsWith('/__daemon/rpc')) window.__rowCalls.push(JSON.parse(args[1].body)); return fetch(...args); };
    })()`);
    await browser("click", `.rail-row[data-id="${child.id}"]`);
    await until(`document.activeElement?.closest('[data-id]')?.dataset.id === '${child.id}'`);
    expect(await evaluate("window.__rowCalls.filter(call => ['agent.spawn','agent.resume','rail.startDoor'].includes(call.method))")).toEqual([]);
    expect(await evaluate("!!document.querySelector('.bubble:not([hidden])')")).toBe(false);
    await browser("press", "Enter");
    await until("document.activeElement?.closest('.pane-screen')");
    await browser("click", `.rail-row[data-id="${home.id}"]`);
    await until(`document.activeElement?.closest('[data-id]')?.dataset.id === '${home.id}'`);
    await evaluate("(() => {const tab = document.querySelector('#shelf-tab-todos'); if (tab.getAttribute('aria-expanded') !== 'true') tab.click();})()");

    for (const kind of ["todo", "pad"]) {
      if (kind === "pad") {
        await evaluate("(() => {window.__rowCalls = []; const fetch = window.fetch; window.fetch = (...args) => { if (String(args[0]).endsWith('/__daemon/rpc')) window.__rowCalls.push(JSON.parse(args[1].body)); return fetch(...args); };})()");
        await browser("click", "#shelf-tab-pads");
      }

      await evaluate("document.querySelector('.shelf [data-shelf-group=unassigned][data-state=closed] [data-part=branch-control]')?.click()");
      const row = kind === "todo" ? `.todos-tab [data-todo="${todo.id}"] .todo-row-button` : '.pads-tab [data-pad="row pad"] .pad-name';
      await until(`document.querySelector('${row}')`);
      await evaluate("window.__rowCalls.length = 0");
      await browser("click", row);
      expect(await evaluate("window.__rowCalls.filter(call => ['todo.get','todo.readHistory','todo.getHistory','pad.read','agent.spawn','agent.resume','rail.startDoor'].includes(call.method))")).toEqual([]);

      for (const input of ["return", "open"]) {
        if (input === "return") await browser("press", "Enter");
        else await browser("click", kind === "todo" ? `[data-todo="${todo.id}"] [aria-label="Open"]` : '[data-pad="row pad"] [aria-label="Open"]');
        await until("document.querySelector('.drawer[data-open=true]')");
        await browser("click", ".drawer .close");
        await until("!document.querySelector('.drawer[data-open=true]')");
        await browser("focus", row);
      }

      expect(await evaluate(`window.__rowCalls.filter(call => call.method === '${kind === "todo" ? "todo.getHistory" : "pad.read"}').length`)).toBe(2);
      await browser("press", "F2");
      await until("document.activeElement?.getAttribute('aria-label') === 'Name'");
      await browser("fill", "input[aria-label=Name]", `renamed ${kind}`);
      await evaluate("document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter',code:'Enter',bubbles:true,cancelable:true}))");
      await until("!document.querySelector('.row-name-editor')");
      expect(await evaluate(`window.__rowCalls.filter(call => call.method === '${kind === "todo" ? "todo.update" : "pad.rename"}').length`)).toBe(1);
      const renamedRow = kind === "todo" ? row : `[data-incarnation="${pad.incarnation}"] .pad-name`;
      await browser("focus", renamedRow);
      await browser("press", "Enter");
      await until("document.querySelector('.drawer[data-open=true]')");
      await browser("click", ".drawer .close");
      await until("!document.querySelector('.drawer[data-open=true]')");
      await browser("reload");
      await until("document.querySelector('.shelf-tabs')");
    }

    const renamedTodo = (await app.rpc("todo.list", null)).find(item => item.id === todo.id);
    const renamedPad = (await app.rpc("pad.list", null)).find(item => item.incarnation === pad.incarnation);
    expect(renamedTodo).toMatchObject({ title: "renamed todo", body: "keep body", home: home.id, creator: todo.creator });
    expect(renamedPad).toMatchObject({ name: "renamed pad", text: "keep text", home: home.id, owner: pad.owner, revision: pad.revision });
    expect((await app.rpc("rail.tree", null)).find(node => node.id === home.id)?.attempt).toBe(door.attempt);
  } finally {
    try { await browser("close"); } finally { await real.stop(); await rm(profile, { recursive: true, force: true }); }
  }
}, 240_000);
