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

// U3733 to U3736 require real pointer and keyboard input; jsdom cannot observe group drop targets.
it("u3732_real_daemon_agent_owner", async () => {
  const executable = chromePath();

  if (!executable) throw new Error("U3732 needs a Chrome binary");
  const real = await startRealDaemon({}, true);
  const profile = await mkdtemp(join(tmpdir(), "u3732-browser-"));
  const config = join(profile, "agent-browser-config.json");
  await writeFile(config, "{}");
  const session = `u3732-${process.pid}`;
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
  const padRow = (name: string) => `.shelf [data-pad="${name}"] .pad-name`;
  const point = (selector: string) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.scrollIntoView({block:'center'}); const b = el.getBoundingClientRect(); return {x: Math.round(b.left + b.width/2), y: Math.round(b.top + b.height/2)}; })()`);
  const app = createServedApp(real.base);

  const capture = async (step: string) => {
    const dir = captureDir("shelf-agent-owner");

    if (!dir) return;
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${step}.checks.json`), JSON.stringify(await evaluate("window.__checks()")) + "\n");
    await browser("screenshot", join(dir, `${step}.png`));
  };

  const lift = async (selector: string) => {
    const from = await point(selector);
    await browser("mouse", "move", String(from.x), String(from.y));
    await browser("mouse", "down");
    await browser("mouse", "move", String(from.x), String(from.y - 6));
    await until(`!!document.querySelector('.sortable-slot')`);
  };

  const drop = async (target: string) => {
    const to = await point(`${group(target)} .shelf-group-head`);
    await browser("mouse", "move", String(to.x), String(to.y));
    await until(`!!document.querySelector('${group(target)}[data-drop-target], ${group(target)} [data-drop-target]')`);
    await browser("mouse", "up");
  };

  const actorOf = (id: string): Actor => ({ kind: "agent", id, parent: null });

  const owned = async (kind: "todo" | "pad", key: number | string, owner: Actor, target: string) => {
    const attribute = kind === "todo" ? `data-todo="${key}"` : `data-pad="${key}"`;

    await until(`document.querySelector('.shelf [${attribute}]')?.closest('[data-shelf-group]')?.dataset.shelfGroup === ${JSON.stringify(target)}`);
    const found = kind === "todo" ? (await app.rpc("todo.list", null)).find(todo => todo.id === key) : (await app.rpc("pad.list", null)).find(pad => pad.name === key);

    expect(found?.owner).toEqual(owner);
    await until("document.activeElement !== document.body");
    const history = await app.rpc("provenance.history", { item: kind === "todo" ? `todo:${key}` : `pad:${key}` });

    expect(history.length).toBeGreaterThan(0);
  };

  const add = async (button: string, label: string, text: string) => {
    await browser("click", `button[aria-label="${button}"]`);
    await until(`document.activeElement.matches('input[aria-label="${label}"]')`);
    await browser("fill", `input[aria-label="${label}"]`, text);
    await browser("press", "Enter");
  };

  try {
    const agents = [];

    for (const name of ["Owner alpha", "Owner beta"]) agents.push(await app.rpc("agent.spawn", { cwd: real.dir, prompt: null, parent: null, name }));
    // SAFETY: the loop above spawned exactly two Agents.
    const [alpha, beta] = agents as [typeof agents[number], typeof agents[number]];

    await browser("set", "viewport", "1512", "950");
    await browser("set", "media", "dark");
    await browser("open", `${real.base}/harness.html?view=workstreams&items=1&tabs=1&daemon=1`);
    await browser("wait", "#shelf-tab-todos");
    await browser("click", `.rail-row[data-id="${alpha.id}"]`);
    await evaluate("(() => { const tab = document.querySelector('#shelf-tab-todos'); if (tab.getAttribute('aria-expanded') !== 'true') tab.click(); return true; })()");
    await add(`add todo to ${alpha.name}`, "New Todo title", "agent todo");
    await until(`[...document.querySelectorAll('.shelf .shelf-title')].some(el => el.textContent === 'agent todo')`);
    const todo = (await app.rpc("todo.list", null)).find(each => each.title === "agent todo")!;

    await owned("todo", todo.id, actorOf(alpha.id), alpha.id);
    await evaluate("(() => { document.querySelector('#shelf-tab-pads').click(); return true; })()");
    await add("Add Pad", "Pad name", "agent-pad");
    await until(`!!document.querySelector('${padRow("agent-pad")}')`);
    await owned("pad", "agent-pad", actorOf(alpha.id), alpha.id);
    await capture("dark-pads-by-owner");

    await browser("reload");
    await browser("wait", "#shelf-tab-pads");
    await browser("focus", "#shelf-tab-pads");
    await owned("pad", "agent-pad", actorOf(alpha.id), alpha.id);

    // An existing destination Pad keeps beta nonempty; U3789c retires empty drag targets.
    await app.rpc("pad.create", {name:"beta destination",text:null});
    await app.rpc("pad.setOwner", {name:"beta destination",owner:actorOf(beta.id)});
    // Overview keeps the source visible after it leaves the first Agent.
    await browser("click", "[data-todo-root]");
    await until(`!!document.querySelector('${group(beta.id)}') || !!document.querySelector('${group(alpha.id)}')`);
    await owned("pad", "agent-pad", actorOf(alpha.id), alpha.id);

    // By drag, then by `o`, each to the other Agent.
    await lift('.shelf [data-pad="agent-pad"] .pad-grip');
    await drop(beta.id);
    await owned("pad", "agent-pad", actorOf(beta.id), beta.id);
    await browser("focus", padRow("agent-pad"));
    await browser("press", "o");
    await browser("wait", "[role=menu]");
    await browser("press", "ArrowDown");
    await browser("press", "Enter");
    await until(`document.activeElement.closest('[data-pad]')?.dataset.pad === 'agent-pad'`);
    await owned("pad", "agent-pad", { kind: "user", id: "you", parent: null }, "unassigned");
  } catch (error) {
    console.error(await evaluate("JSON.stringify({text:document.body.innerText, active:document.activeElement.outerHTML})").catch(() => "browser unavailable"));
    throw error;
  } finally {
    try { await browser("close"); } finally { await real.stop(); await rm(profile, { recursive: true, force: true }); }
  }
}, 60_000);

// U4457 names the real Daemon and native button activation, which jsdom cannot prove.
it("u4457_the_real_daemon_pads_control_supports_pointer_enter_and_space", async () => {
  const executable = chromePath();

  if (!executable) throw new Error("U4457 needs Chromium");
  const real = await startRealDaemon({}, true);
  const profile = await mkdtemp(join(tmpdir(), "u4457-browser-"));
  const config = join(profile, "config.json");
  await writeFile(config, "{}");
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("AGENT_BROWSER_")));

  const browser = async (...args: string[]) => {
    const { stdout } = await promisify(execFile)("agent-browser", ["--executable-path", executable, "--args", "--no-sandbox", "--config", config, "--session", `u4457-${process.pid}`, "--profile", profile, "--json", ...args], { env, timeout: 60_000, maxBuffer: 4 * 1024 * 1024 }).catch(error => { throw new Error(`${error.message}\n${error.stdout}\n${error.stderr}`); });
    const reply = JSON.parse(stdout);
    expect(reply.success, stdout).toBe(true);

    return reply.data;
  };

  const evaluate = async (source: string) => (await browser("eval", source)).result;
  const until = (source: string) => browser("wait", "--fn", source);
  const app = createServedApp(real.base);

  const capture = async (step: string) => {
    const dir = captureDir("U4457");

    if (!dir) return;
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${step}.checks.json`), JSON.stringify(await evaluate("window.__checks()")) + "\n");
    await browser("screenshot", join(dir, `${step}.png`));
  };

  try {
    const workstream = await app.rpc("rail.createWorkstream", { name: "Pad Home", parent: null });
    const other = await app.rpc("rail.createWorkstream", { name: "Other Home", parent: null });
    const alpha = await app.rpc("agent.spawn", { cwd: real.dir, prompt: null, parent: workstream.id, name: "Pad author" });
    const beta = await app.rpc("agent.spawn", { cwd: real.dir, prompt: null, parent: null, name: "Selected Agent" });

    for (const name of ["notes", "plan"]) {
      await app.rpc("pad.create", { name, text: null });
      await app.rpc("pad.setOwner", { name, owner: { kind: "agent", id: alpha.id, parent: null } });
    }

    await app.rpc("pad.move", { name: "notes", home: workstream.id });
    await app.rpc("pad.move", { name: "plan", home: other.id });

    const recording = captureDir("U4457");

    if (recording) {
      await mkdir(recording, { recursive: true });
      await browser("record", "start", join(recording, "activation.webm"));
    }

    await browser("set", "viewport", "1512", "950");
    await browser("set", "media", "dark");
    await browser("open", `${real.base}/harness.html?daemon=1`);
    await browser("wait", `[data-id="${alpha.id}"] [data-pads-control]`);
    await browser("click", `.rail-row[data-id="${beta.id}"] .name`);
    await until(`document.querySelector('.rail-row[data-id="${beta.id}"]')?.getAttribute('aria-selected') === 'true'`);
    const before = await evaluate("document.querySelectorAll('.rail-row').length");
    await capture("before");
    const control = `.rail-row[data-id="${alpha.id}"] [data-pads-control]`;
    const group = `.pads-tab [data-shelf-group="${workstream.id}:${alpha.id}"]`;

    for (const activation of ["click", "Enter", "Space"]) {
      if (activation !== "click") {
        await browser("click", `.pads-tab [data-shelf-group="${workstream.id}"] .shelf-group-control`);
        await until(`document.querySelector('.pads-tab [data-shelf-group="${workstream.id}"]')?.getAttribute('aria-expanded') === 'false'`);
      }

      if (activation === "click") {
        await browser("focus", `.rail-row[data-id="${alpha.id}"]`);
        await until(`getComputedStyle(document.querySelector('${control}')).pointerEvents === 'auto'`);
        await browser("click", control);
      }
      else {
        await browser("click", "#shelf-tab-todos");
        await until("!!document.querySelector('.todos-tab')");
        await browser("focus", control);
        await browser("press", activation);
      }

      await until(`document.querySelector('${group}')?.getAttribute('aria-expanded') === 'true' && document.activeElement === document.querySelector('${group} .shelf-group-control')`);
      expect(await evaluate("document.querySelectorAll('.rail-row').length")).toBe(before);
      expect(await evaluate(`document.querySelector('.rail-row[data-id="${beta.id}"]')?.getAttribute('aria-selected')`)).toBe("true");
      expect(await evaluate("document.querySelectorAll('.pads-tab [data-pad]').length")).toBe(2);
      expect(await evaluate("Number(document.querySelector('#shelf-tab-pads .shelf-count')?.textContent)")).toBe(2);
      await capture(activation);
    }

    if (recording) await browser("record", "stop");

    if (captureDir("U4457")) {
      await browser("open", `${real.base}/harness.html?seed=tree-40&view=workstreams&items=1&tabs=1`);
      await browser("wait", "[data-todo-root]");
      const todoControl = '[data-id="tokens"] [data-pads-control]';
      const todoGroup = '[data-shelf-group="unassigned"]';

      await browser("focus", '.rail-row[data-id="tokens"]');
      await browser("click", todoControl);
      await until("document.activeElement.matches('.todo-row-button') && !document.activeElement.closest('[hidden]')");
      await browser("click", `${todoGroup} .shelf-group-control`);
      await until(`document.querySelector('${todoGroup}')?.getAttribute('aria-expanded') === 'false'`);
      await browser("focus", '.rail-row[data-id="tokens"]');
      await browser("click", todoControl);
      await until("document.activeElement.matches('.todo-row-button') && !document.activeElement.closest('[hidden]')");
      await capture("tree-40-todo-control");
      await browser("click", "[data-todo-root]");
      await browser("wait", "#shelf-tab-pads");
      await browser("click", "#shelf-tab-pads");
      await until("!!document.querySelector('.pads-tab')");
      await browser("click", 'button[aria-label="Add Pad"]');
      await browser("wait", 'input[aria-label="Pad name"]');
      await browser("fill", 'input[aria-label="Pad name"]', "unsaved notes");
      await evaluate("window.__fake.failNext(-32003, 'name already taken')");
      await browser("press", "Enter");
      await until("document.querySelector('.pads-tab').textContent.includes('name already taken')");
      await capture("tree-40-failure");
    }
  } catch (error) {
    console.error(await evaluate("JSON.stringify({active:document.activeElement.outerHTML,text:document.body.innerText})").catch(() => "browser unavailable"));
    throw error;
  } finally {
    try { await browser("close"); } finally { await real.stop(); await rm(profile, { recursive: true, force: true }); }
  }
}, 60_000);
