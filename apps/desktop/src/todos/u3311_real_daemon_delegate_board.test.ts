import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import type { CreateParams } from "@contracts/todo/CreateParams";
import type { Actor } from "@contracts/Actor";
import { captureDir } from "../testing/captures";
import { startRealDaemon } from "../testing/realDaemonFixture";
import { createServedApp } from "../testing/realSeam";
import { openLane } from "./laneBrowser";

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

  const observe = async (id: number, to: string) => {
    await lane.until(`document.querySelector('${row(id)}')?.closest('[data-shelf-group]')?.dataset.shelfGroup === ${JSON.stringify(to)}`);
    expect((await app.rpc("todo.list", null)).find(todo => todo.id === id)?.owner).toEqual(to === "me" ? me : actor(to));
    expect(await lane.evaluate("document.activeElement === document.body")).toBe(false);
    expected.set(id, to);
  };

  try {
    const home = await app.rpc("rail.createWorkstream", { name: "Release", parent: null });
    const agents: { id: string }[] = [];

    for (const name of ["Writer", "Builder", "Reviewer"]) agents.push(await app.rpc("agent.spawn", { cwd: real.dir, prompt: null, parent: home.id, name }));
    await writeFile(target, JSON.stringify(actor(agents[0]!.id)));
    await app.rpc("rail.startDoor", { id: home.id });
    const made = [];

    for (const [name, owner, estimate] of [["Prepare notes", me, 30], ["Check links", actor(agents[0]!.id), 15], ["Compile release", actor(agents[1]!.id), 20], ["Review changes", actor(agents[2]!.id), null], ["Pointer hand-off", null, 45], ["Number hand-off", me, 10], ["Arrow hand-off", me, 5], ["Automatic hand-off", null, 25]] as const) {
      const params: CreateParams = { title: name, body: null, blockers: null };

      if (owner) params.owner = owner;

      if (estimate !== null) params.estimate_minutes = estimate;
      const todo = await app.rpc("todo.create", params);

      await app.rpc("todo.move", { id: todo.id, home: home.id });
      made.push(todo);
    }

    await lane.browser("open", `${real.base}/harness.html?daemon=1`);
    await lane.until("!!document.querySelector('#shelf-tab-todos')");
    await lane.browser("click", `.rail-row[data-id="${home.id}"] .name`);
    await lane.evaluate("(() => {const tab=document.querySelector('#shelf-tab-todos');if(tab.getAttribute('aria-expanded')!=='true')tab.click();return true;})()");
    await lane.until(`!!document.querySelector('${group("unassigned")}')`);
    await lane.evaluate(`(() => {const g=document.querySelector('${group("unassigned")}');if(g.dataset.state==='closed')g.querySelector('[data-part=branch-control]').click();return true;})()`);
    await lane.capture("delegate-board", "board");

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
    const from = await point(row(moved.id));
    const to = await point(`${group(agents[0]!.id)} .shelf-group-head`);
    const busy = () => lane.evaluate<string>(`document.querySelector('${group(agents[0]!.id)} .todo-busy').textContent`);
    const original = await busy();
    await lane.browser("mouse", "move", String(from.x), String(from.y));
    await lane.browser("mouse", "down");
    await lane.browser("mouse", "move", String(from.x), String(from.y - 6));
    await lane.until("!!document.querySelector('[data-dnd-placeholder]')");
    await lane.browser("mouse", "move", String(to.x), String(to.y));
    await lane.until(`!!document.querySelector('${group(agents[0]!.id)}[data-drop-target]')`);
    expect(await busy()).not.toBe(original);
    expect((await app.rpc("todo.get", { id: moved.id })).owner).toBeNull();
    await lane.capture("delegate-board", "drag-preview");
    await lane.browser("press", "Escape");
    await lane.browser("mouse", "up");
    await lane.until(`document.querySelector('${group(agents[0]!.id)} .todo-busy').textContent === ${JSON.stringify(original)}`);

    await lane.browser("mouse", "move", String(from.x), String(from.y));
    await lane.browser("mouse", "down");
    await lane.browser("mouse", "move", String(from.x), String(from.y - 6));
    await lane.until("!!document.querySelector('[data-dnd-placeholder]')");
    await lane.browser("mouse", "move", String(to.x), String(to.y));
    await lane.browser("mouse", "up");
    await observe(moved.id, agents[0]!.id);
    await focus(made[5]!.id);
    await key("3", "Digit3");
    await observe(made[5]!.id, agents[2]!.id);
    await focus(made[6]!.id);
    await key("Enter"); await key("ArrowDown"); await key("Enter");
    await observe(made[6]!.id, agents[0]!.id);

    await lane.browser("focus", '[role="switch"]');
    await lane.evaluate("window.__held = document.activeElement");
    const scroll = await lane.evaluate<number>("document.querySelector('.shelf-area').scrollTop");
    await lane.browser("press", "Space");
    await lane.until("document.querySelector('[role=switch]').getAttribute('aria-checked')==='true'");
    await observe(made[7]!.id, agents[0]!.id);
    expect(await lane.evaluate("document.activeElement === window.__held")).toBe(true);
    expect(await lane.evaluate("document.querySelector('.shelf-area').scrollTop")).toBe(scroll);
    const prompts = await readFile(join(scratch, "prompts.jsonl"), "utf8");
    expect(prompts).toContain(`Todo #${made[7]!.id}`);
    await lane.capture("delegate-board", "auto-hand-off");

    await lane.evaluate("window.__glideRate = 0.1");
    await app.rpc("todo.assign", { id: moved.id, owner: actor(agents[1]!.id) });
    await lane.until(`window.__glides.filter(item=>item.id===${moved.id}).length===2`);
    await app.rpc("todo.assign", { id: moved.id, owner: actor(agents[2]!.id) });
    await observe(moved.id, agents[2]!.id);
    await lane.until(`window.__glides.filter(item=>item.id===${moved.id}).length===3 && window.__glides.filter(item=>item.id===${moved.id})[1].canceled`);
    expect(await lane.evaluate<boolean>("window.__glides.every(item=>item.frames.every(frame=>frame.active<=1))")).toBe(true);
    await lane.capture("delegate-board", "burst-hand-off");
    await lane.browser("set", "media", "dark", "reduced-motion");
    const beforeReduced = await lane.evaluate<number>(`window.__glides.filter(item=>item.id===${moved.id}).length`);
    await app.rpc("todo.assign", { id: moved.id, owner: actor(agents[0]!.id) });
    await observe(moved.id, agents[0]!.id);
    expect(await lane.evaluate(`window.__glides.filter(item=>item.id===${moved.id}).length`)).toBe(beforeReduced);
    await lane.capture("delegate-board", "reduced-motion");
    const captures = captureDir("delegate-board");

    if (captures) {
      await mkdir(captures, { recursive: true });
      await writeFile(join(captures,"hand-offs-frames.json"), JSON.stringify(await lane.evaluate("window.__glides")) + "\n");
    }

    const totals = (await app.rpc("todo.list", null)).filter(todo => !todo.done && todo.owner?.id === agents[0]!.id).reduce((sum, todo) => sum + (todo.estimate_minutes ?? 0), 0);
    const time = new Date(Date.now() + totals * 60_000);
    expect(await busy()).toBe(`busy until ${String(time.getHours()).padStart(2, "0")}:${String(time.getMinutes()).padStart(2, "0")}`);
    await lane.browser("reload");
    await lane.until("!!document.querySelector('[role=switch][aria-checked=true]')");
    await lane.browser("focus", "#shelf-tab-todos");

    for (const [id, to] of expected) await observe(id, to);
    expect((await app.rpc("todo.get", { id: made[0]!.id })).owner).toEqual(me);
  } catch (error) {
    console.error(await lane.evaluate("document.body.innerText"));
    console.error(await app.rpc("message.list", { to: null, status: null }));
    console.error(await readFile(target + ".log", "utf8").catch(() => "no child log"));
    console.error(await readFile(join(scratch, "prompts.jsonl"), "utf8").catch(() => "no prompts"));
    throw error;
  } finally {
    await lane.close();
    await real.stop();
    await rm(scratch, { recursive: true, force: true });
  }
}, 180_000);
