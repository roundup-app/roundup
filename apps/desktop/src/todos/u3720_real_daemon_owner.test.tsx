import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import type { CreateParams } from "@contracts/todo/CreateParams";
import type { Actor } from "@contracts/Actor";
import { captureDir } from "../testing/captures";
import { chromePath } from "../testing/chromePage";
import { startRealDaemon } from "../testing/realDaemonFixture";
import { createServedApp } from "../testing/realSeam";
import { openLane } from "./laneBrowser";

const execute = promisify(execFile);

// U3720 requires real pointer and keyboard input; jsdom cannot observe group drop targets.
it.skipIf(process.env.ROUNDUP_CAPTURES !== undefined)("u3720_real_daemon_owner_assign", async () => {
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
  const row = (id: number) => `.shelf [data-todo="${id}"] .sortable-handle`;
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
    const from = await point(`.shelf [data-todo="${id}"] .sortable-handle`);
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
    const agents = [];

    for (const name of ["Owner alpha", "Owner beta"]) agents.push(await app.rpc("agent.spawn", { cwd: real.dir, prompt: null, parent: null, name }));
    const actor = (id: string): Actor => ({ kind: "agent", id, parent: null });
    const owners = [{ id: "me", label: "Me", actor: me }, ...agents.map(agent => ({ id: agent.id, label: agent.name!, actor: actor(agent.id) })), { id: "unassigned", label: "Unassigned", actor: null }];

    for (const owner of owners) {
      const params = { title: `initial ${owner.label}`, body: null, blockers: null };

      await app.rpc("todo.create", owner.actor ? { ...params, owner: owner.actor } : params);
    }

    const moved = await app.rpc("todo.create", { title: "pointer assignment", body: null, blockers: null });
    const keyed = await app.rpc("todo.create", { title: "keyboard assignment", body: null, blockers: null, owner: me });
    await browser("set", "viewport", "1512", "950");
    await browser("set", "media", "dark");
    await browser("open", `${real.base}/harness.html?view=workstreams&items=1&tabs=1&daemon=1`);
    await browser("wait", "#shelf-tab-todos");
    await browser("click", "[data-todo-root]");
    await evaluate("(() => { const tab = document.querySelector('#shelf-tab-todos'); if (tab.getAttribute('aria-expanded') !== 'true') tab.click(); return true; })()");
    await until(`!!document.querySelector('${group("unassigned")}')`);
    await evaluate(`(() => { const group = document.querySelector('${group("unassigned")}'); if (group.dataset.state === 'closed') group.querySelector('[data-part="branch-control"]').click(); return true; })()`);
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
    // Assignment reveals the destination so the moved row can retain focus.
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


    // U3789b retires per-owner add controls: create once from the scope line.
    await browser("click", ".shelf-add");
    await until(`document.activeElement.matches('input[aria-label="New Todo title"]')`);
    await capture("dark-new-todo-field");
    await browser("fill", 'input[aria-label="New Todo title"]', "added from scope");
    await browser("press", "Enter");
    await until(`document.querySelector('input[aria-label="New Todo title"]')?.value === ''`);
    const made = (await app.rpc("todo.list", null)).find(todo => todo.title === "added from scope")!;

    await observe(made.id, null, "unassigned");
    await browser("press", "Escape");

    await browser("reload");
    await browser("wait", "#shelf-tab-todos");
    await browser("focus", "#shelf-tab-todos");
    await until(`!!document.querySelector('${group("me")}')`);

    for (const [id, target] of expected) await observe(id, target.owner, target.group);

    // Remove an owner after lifting, before releasing on its stale header.
    await lift(moved.id);
    const stale = await point(`${group(agents[1]!.id)} .shelf-group-head`);
    // Hold the Rail and Todo refetches so the in-flight gesture retains its stale target;
    // todo.assign still reaches the real Daemon and must refuse the removed id.
    await evaluate(`(() => { const fetch = window.fetch.bind(window); window.fetch = (url, options) => String(url).endsWith('/__daemon/rpc') && ['rail.tree','todo.list'].includes(JSON.parse(options.body).method) ? new Promise(() => {}) : fetch(url, options); return true; })()`);
    await app.rpc("rail.remove", { id: agents[1]!.id });
    await browser("mouse", "move", String(stale.x), String(stale.y));
    await browser("mouse", "up");
    await until(`!!document.querySelector('.shelf [data-todo="${moved.id}"] [role="alert"]')`);
    await observe(moved.id, me, "me");
    expect(await evaluate(`document.querySelector('.shelf [data-todo="${moved.id}"] [role="alert"]').textContent`)).toMatch(/agent|owner|found|exist/i);
  } catch (error) {
    console.error(await evaluate("JSON.stringify({text:document.body.innerText, active:document.activeElement.outerHTML, fields:[...document.querySelectorAll('.entry-field')].map(el=>el.outerHTML)})").catch(() => "browser unavailable"));
    throw error;
  } finally {
    try { await browser("close"); } finally { await real.stop(); await rm(profile, { recursive: true, force: true }); }
  }
}, 240_000);

// A deterministic vendor child reads only delivered Auto Messages and answers through the public CLI as its Door.
const door = `import json,os,re,subprocess,sys,time
rup,target=sys.argv[1:];sys.stderr=open(target+'.log','w',buffering=1);ident=os.environ['ROUNDUP_AGENT'];seen=set();end=time.monotonic()+90
def call(*args):
 p=subprocess.run([rup,*args,'--json'],capture_output=True,text=True,timeout=10)
 assert p.returncode==0,(args,p.stderr)
 return json.loads(p.stdout)
while time.monotonic()<end:
 for m in call('message','list','--to',ident,'--status','delivered'):
  match=re.search(r'Todo #(\\d+):',m['body'])
  if not match or m['id'] in seen:continue
  seen.add(m['id'])
  call('todo','assign',match[1],'--owner',open(target).read())
 time.sleep(.1)
`;

// U3311 names a real Daemon and pointer/clock observer; the fake vendor never supplies App or Todo success facts.
it("u3311_real_daemon_delegate_board", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "u3311-"));
  const target = join(scratch, "owner.json");

  const real = await startRealDaemon({
    FAKE_CLAUDE_DOOR_PROCESS: JSON.stringify(["python3", "-c", door, resolve("../../target/debug/rup"), target]),
    FAKE_CLAUDE_PROMPT_LOG: join(scratch, "prompts.jsonl"),
    FAKE_CLAUDE_LAUNCH_LOG: join(scratch, "launches.jsonl"),
  }, true);

  const lane = await openLane(1512, "dark", "u3311-delegate-board");
  const app = createServedApp(real.base);
  const me: Actor = { kind: "user", id: "you", parent: null };
  const actor = (id: string): Actor => ({ kind: "agent", id, parent: null });
  const row = (id: number) => `.shelf [data-todo="${id}"] .todo-row-button`;
  const group = (id: string) => `.shelf [data-shelf-group="${id}"]`;
  const focus = (id: number) => lane.evaluate(`document.querySelector('${row(id)}').focus()`);
  const key = (key: string, code = key) => lane.evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(key)},code:${JSON.stringify(code)},bubbles:true,cancelable:true}))`);
  const point = (selector: string) => lane.evaluate<{ x: number; y: number }>(`(() => {const el=document.querySelector(${JSON.stringify(selector)});el.scrollIntoView({block:'nearest'});const b=el.getBoundingClientRect();return {x:Math.round(b.left+b.width/2),y:Math.round(b.top+b.height/2)};})()`);
  const expected = new Map<number, string>();
  const saved = new Map<number, { title: string; body: string }>();
  let homeId: string;
  const lostFocus: number[] = [];

  const capture = async (step: string) => {
    for (const id of ["U3308", "U3311", "T4902"]) {
      await lane.capture(id, step);
      const dir = captureDir(id);

      if (dir) await writeFile(join(dir, `${step}.observer.json`), JSON.stringify(await lane.evaluate("({focus:document.activeElement?.outerHTML, scrollBeforeAuto:window.__scroll, scrollAfterAuto:window.__scrollAfterAuto, text:[...document.querySelectorAll('.todos-tab,.todo-detail')].map(el=>el.innerText)})")) + "\n");
    }
  };

  const observe = async (id: number, to: string) => {
    await lane.until(`document.querySelector('${row(id)}')?.closest('[data-shelf-group]')?.dataset.shelfGroup === ${JSON.stringify(to)}`);
    expect((await app.rpc("todo.list", null)).find(todo => todo.id === id)).toMatchObject({ id, home: homeId, title: saved.get(id)?.title, body: saved.get(id)?.body, owner: to === "me" ? me : actor(to) });

    if (await lane.evaluate("document.activeElement === document.body")) lostFocus.push(id);

    expected.set(id, to);
  };

  try {
    const home = await app.rpc("rail.createWorkstream", { name: "Release", parent: null });
    homeId = home.id;
    const agents: { id: string }[] = [];

    for (const name of ["Writer", "Builder", "Reviewer", "Empty destination"]) agents.push(await app.rpc("agent.spawn", { cwd: real.dir, prompt: null, parent: home.id, name }));
    await writeFile(target, JSON.stringify(actor(agents[0]!.id)));
    await app.rpc("rail.startDoor", { id: home.id });
    const made = [];

    for (const [name, owner] of [["Prepare notes", me], ["Check links", actor(agents[0]!.id)], ["Compile release", actor(agents[1]!.id)], ["Review changes", actor(agents[2]!.id)], ["Pointer hand-off", null], ["Number hand-off", me], ["Arrow hand-off", me], ["Automatic hand-off", null]] as const) {
      const params: CreateParams = { title: name, body: null, blockers: null };

      if (owner) params.owner = owner;

      const todo = await app.rpc("todo.create", params);

      await app.rpc("todo.move", { id: todo.id, home: home.id });
      made.push(todo);
      saved.set(todo.id, { title: todo.title, body: todo.body });
    }

    const done = await app.rpc("todo.create", { title: "Published release notes", body: "Completed work", blockers: null, owner: me });
    await app.rpc("todo.move", { id: done.id, home: home.id });
    await app.rpc("todo.complete", { id: done.id });
    const video = captureDir("U3311");

    if (video) {
      await mkdir(video, { recursive: true });
      await lane.browser("record", "start", join(video, "hand-offs.webm"), `${real.base}/harness.html?view=workstreams&items=1&tabs=1&daemon=1`);
    } else await lane.browser("open", `${real.base}/harness.html?view=workstreams&items=1&tabs=1&daemon=1`);
    await lane.browser("set", "viewport", "1512", "950");
    await lane.browser("set", "media", "dark");
    await lane.until("matchMedia('(prefers-color-scheme: dark)').matches && !!document.querySelector('#shelf-tab-todos')");
    await lane.browser("focus", `.rail-row[data-id="${home.id}"]`);
    await lane.until(`document.activeElement?.matches('.rail-row[data-id="${home.id}"]')`);
    await lane.browser("press", "Enter");
    await lane.until(`document.querySelector('.rail-row[data-id="${home.id}"]')?.dataset.selected === 'true'`);
    await lane.evaluate("(() => {const tab=document.querySelector('#shelf-tab-todos');if(tab.getAttribute('aria-expanded')!=='true')tab.click();return true;})()");
    await lane.until(`!!document.querySelector('${group("unassigned")}')`);
    await lane.evaluate(`(() => {const g=document.querySelector('${group("unassigned")}');if(g.dataset.state==='closed')g.querySelector('[data-part=branch-control]').click();return true;})()`);
    await lane.evaluate(`(() => { window.__assignCalls = []; const fetch = window.fetch.bind(window); window.fetch = (url, options) => { if (String(url).endsWith('/__daemon/rpc')) { const call = JSON.parse(options.body); if (call.method === 'todo.assign') window.__assignCalls.push(call); if (call.method === window.__failure?.method) { const failure = window.__failure; window.__failure = null; return Promise.resolve(new Response(JSON.stringify({error:{code:-32003,message:failure.message}}), {headers:{'Content-Type':'application/json'}})); } } return fetch(url, options); }; return true; })()`);
    await lane.browser("click", ".shelf-done-line button:first-child");
    await lane.until("document.querySelector('.todo-done-fold')?.dataset.open === 'true'");
    await capture("board");

    await lane.evaluate(`(() => {
      window.__glides = []; window.__glideRate = 1;
      const animate = Element.prototype.animate;
      Element.prototype.animate = function(...args) {
        const animation = animate.apply(this,args);
        if (!this.matches('.todo-row')) return animation;
        animation.playbackRate = window.__glideRate;
        const item = {id:Number(this.dataset.todo), canceled:false, frames:[]};
        window.__glides.push(item);
        animation.addEventListener('cancel',()=>{item.canceled=true;});
        const sample = () => {
          const box=this.getBoundingClientRect();
          item.frames.push({t:performance.now(),x:box.left,y:box.top,active:this.getAnimations().filter(a=>a.playState==='running').length});
          if(animation.playState==='running') requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
        return animation;
      };
      return true;
    })()`);

    const moved = made[4]!;
    const from = await point(`.shelf [data-todo="${moved.id}"] .sortable-handle`);
    const to = await point(`${group(agents[0]!.id)} .shelf-group-head`);
    await lane.browser("mouse", "move", String(from.x), String(from.y));
    await lane.browser("mouse", "down");
    await lane.browser("mouse", "move", String(from.x), String(from.y - 6));
    await lane.until("!!document.querySelector('[data-dnd-placeholder]')");
    await lane.browser("mouse", "move", String(to.x), String(to.y));
    await lane.until(`!!document.querySelector('${group(agents[0]!.id)}[data-drop-target]')`);
    expect(await lane.evaluate("window.__assignCalls.length")).toBe(0);
    expect(await app.rpc("todo.get", { id: moved.id })).toMatchObject({ id: moved.id, home: home.id, owner: null, ...saved.get(moved.id) });
    await capture("drag-preview");
    await lane.browser("press", "Escape");
    await lane.browser("mouse", "up");
    await lane.until("!document.querySelector('[data-dnd-placeholder]')");
    expect(await lane.evaluate("window.__assignCalls.length")).toBe(0);
    expect(await app.rpc("todo.get", { id: moved.id })).toMatchObject({ id: moved.id, home: home.id, owner: null, ...saved.get(moved.id) });

    await lane.browser("mouse", "move", String(from.x), String(from.y));
    await lane.browser("mouse", "down");
    await lane.browser("mouse", "move", String(from.x), String(from.y - 6));
    await lane.until("!!document.querySelector('[data-dnd-placeholder]')");
    await lane.browser("mouse", "move", String(to.x), String(to.y));
    await lane.browser("mouse", "up");
    await observe(moved.id, agents[0]!.id);
    expect(await lane.evaluate<number>(`window.__glides.filter(item=>item.id===${moved.id}).length`)).toBe(1);
    await focus(made[5]!.id);
    await lane.evaluate("window.__failure = {method:'todo.assign',message:'Agent unavailable; choose another owner'}");
    await key("3", "Digit3");
    await lane.until(`!!document.querySelector('.shelf [data-todo="${made[5]!.id}"] [role=alert]')`);
    expect(await app.rpc("todo.get", { id: made[5]!.id })).toMatchObject({ id: made[5]!.id, home: home.id, owner: me, ...saved.get(made[5]!.id) });
    await capture("assign-failure");
    await key("3", "Digit3");
    await observe(made[5]!.id, agents[2]!.id);
    await focus(made[6]!.id);
    await lane.browser("press", "o");
    await lane.until("!!document.querySelector('[role=menu]')");
    await lane.browser("press", "ArrowDown");
    await lane.browser("press", "Enter");
    await observe(made[6]!.id, agents[0]!.id);

    await lane.browser("focus", '[role="switch"]');
    await lane.evaluate("window.__kept = document.activeElement; window.__scroll = [...document.querySelectorAll('.rail, .shelf-body')].map(el => el.scrollTop)");
    await lane.browser("press", "Space");
    await lane.until("document.querySelector('[role=switch]').getAttribute('aria-checked')==='true'");
    await observe(made[7]!.id, agents[0]!.id);
    expect(await lane.evaluate("document.activeElement === window.__kept")).toBe(true);
    await lane.evaluate("window.__scrollAfterAuto = [...document.querySelectorAll('.rail, .shelf-body')].map(el => el.scrollTop)");
    const prompts = await readFile(join(scratch, "prompts.jsonl"), "utf8");
    expect(prompts).toContain(`Todo #${made[7]!.id}`);
    await capture("auto-hand-off");

    const beforeBurst = await lane.evaluate<number>(`window.__glides.filter(item=>item.id===${moved.id}).length`);

    await lane.evaluate("window.__glideRate = 0");
    await app.rpc("todo.assign", { id: moved.id, owner: actor(agents[1]!.id) });
    await lane.until(`window.__glides.filter(item=>item.id===${moved.id}).length===${beforeBurst + 1}`);
    await app.rpc("todo.assign", { id: moved.id, owner: actor(agents[2]!.id) });
    await observe(moved.id, agents[2]!.id);
    await lane.until(`window.__glides.filter(item=>item.id===${moved.id}).length===${beforeBurst + 2} && window.__glides.filter(item=>item.id===${moved.id})[${beforeBurst}].canceled`);
    expect(await lane.evaluate<boolean>("window.__glides.every(item=>item.frames.every(frame=>frame.active<=1))")).toBe(true);
    await lane.evaluate("(() => { window.__glideRate = 1; for (const row of document.querySelectorAll('.todo-row')) for (const animation of row.getAnimations()) animation.playbackRate = 1; })()");
    // Motion frames above record the retarget; the layout Checks read its settled destination.
    await lane.evaluate("Promise.all([...document.querySelectorAll('.todo-row')].flatMap(row=>row.getAnimations()).map(animation=>animation.finished.catch(()=>{}))).then(()=>true)");
    await capture("burst-hand-off");
    await lane.browser("set", "media", "dark", "reduced-motion");
    const beforeReduced = await lane.evaluate<number>(`window.__glides.filter(item=>item.id===${moved.id}).length`);
    await app.rpc("todo.assign", { id: moved.id, owner: actor(agents[0]!.id) });
    await observe(moved.id, agents[0]!.id);
    expect(await lane.evaluate(`window.__glides.filter(item=>item.id===${moved.id}).length`)).toBe(beforeReduced);
    await capture("reduced-motion");
    const captures = captureDir("U3311");

    if (captures) {
      await mkdir(captures, { recursive: true });
      await writeFile(join(captures,"hand-offs-frames.json"), JSON.stringify(await lane.evaluate("window.__glides")) + "\n");
    }

    await focus(moved.id);
    await lane.browser("press", "Enter");
    await lane.until("!!document.querySelector('.todo-detail-title .todo-editable')");
    await lane.browser("dblclick", ".todo-detail-title .todo-editable p");
    await lane.until("!!document.querySelector('textarea[aria-label=Title]')");
    await lane.browser("fill", "textarea[aria-label=Title]", "Release notes revised");
    await lane.evaluate("window.__failure = {method:'todo.update',message:'Save unavailable; retry your retained edit'}");
    await lane.browser("press", "Tab");
    await lane.until("!!document.querySelector('.todo-detail [role=alert]')");
    expect(await app.rpc("todo.get", { id: moved.id })).toMatchObject({ id: moved.id, home: home.id, owner: actor(agents[0]!.id), ...saved.get(moved.id) });
    await capture("save-failure");
    await lane.until("!!document.querySelector('.todo-detail-title textarea[aria-label=Title]')");
    await lane.browser("click", ".todo-detail-title .todo-editable button:last-child");
    await lane.until("!document.querySelector('textarea[aria-label=Title]')");
    await lane.until("document.querySelector('.todo-detail-title .todo-editable p')?.textContent === 'Release notes revised' && document.activeElement !== document.body");
    saved.set(moved.id, { title: "Release notes revised", body: "" });
    await observe(moved.id, agents[0]!.id);
    await lane.browser("click", ".todo-add-notes");
    await lane.until("!!document.querySelector('textarea[aria-label=Body]')");
    await lane.browser("fill", "textarea[aria-label=Body]", "Exact body é 🧪\n次の行");
    await lane.browser("press", "Tab");
    await lane.until("!document.querySelector('textarea[aria-label=Body]')");
    await lane.until("document.activeElement !== document.body && !!document.querySelector('.todo-detail-body .todo-editable p')");
    saved.set(moved.id, { title: "Release notes revised", body: "Exact body é 🧪\n次の行" });
    await observe(moved.id, agents[0]!.id);
    await lane.browser("click", ".todo-history-line");
    await lane.until("document.querySelector('.todo-history-line')?.getAttribute('aria-expanded') === 'true'");
    await capture("drawer-changes");

    await lane.browser("reload");
    await lane.until("!!document.querySelector('[role=switch][aria-checked=true]')");
    await lane.browser("focus", "#shelf-tab-todos");

    for (const [id, to] of expected) await observe(id, to);
    expect((await app.rpc("todo.get", { id: made[0]!.id })).owner).toEqual(me);
    await capture("project-reopened");
    await lane.browser("focus", `.rail-row[data-id="${agents[3]!.id}"]`);
    await lane.browser("press", "Enter");
    await lane.until(`document.querySelector('.rail-row[data-id="${agents[3]!.id}"]')?.dataset.selected === 'true'`);
    await capture("empty-agent");
    expect(lostFocus).toEqual([]);
  } catch (error) {
    console.error(await lane.evaluate("document.body.innerText"));
    console.error(await app.rpc("message.list", { to: null, status: null }));
    console.error(await readFile(target + ".log", "utf8").catch(() => "no child log"));
    console.error(await readFile(join(scratch, "prompts.jsonl"), "utf8").catch(() => "no prompts"));
    throw error;
  } finally {
    try {
      if (captureDir("U3311")) await lane.browser("record", "stop");
    } finally {
      await lane.close();
      await real.stop();
      await rm(scratch, { recursive: true, force: true });
    }
  }
}, 180_000);
