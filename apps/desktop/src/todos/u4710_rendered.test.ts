import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "vitest";
import { browser, read, url, wait } from "../ui/tabsBrowser";
import { captureDir } from "../testing/captures";

// Policy observer: the critic judges geometry; behavior is asserted by u3710/u3718.
it.each([true, false].flatMap(base => [1280, 1512].map(width => ({base, width}))))("u4710a_u4710b_u4710c_columns_and_landing_$base/$width", async ({base, width}) => {
  if (base && !process.env.U500_BASE_ROOT) return;
  const revision = execFileSync("git", ["rev-parse", base ? "origin/main" : "HEAD"], {encoding:"utf8"}).trim();
  const directories = ["U4710a", "U4710b", "U4710c"].flatMap(id => {
    const dir = captureDir(id);
    return dir ? [join(dir, base ? "base" : "head")] : [];
  });
  if (!directories.length) return;
  for (const directory of directories) mkdirSync(directory, {recursive:true});
  await browser("open", url("/harness.html?seed=tree-40", base));
  await wait("window.__fake && document.querySelector('.rail-tree')");
  await browser("eval", "localStorage.clear()");
  await browser("open", url("/harness.html?seed=tree-40", base));
  await wait("window.__fake && document.querySelector('.rail-tree')");
  if (!base) await browser("record", "start", join(directories[0]!, `${width}-interaction.webm`));
  try {
    await browser("set", "viewport", String(width), width === 1280 ? "820" : "950");
    await browser("set", "media", "dark");
    await browser("click", "[data-todo-root]");
    await browser("eval", `(async () => {
      const rpc = window.__fake.app.rpc;
      const blockers = [];
      for(let n=0;n<10;n++) blockers.push((await rpc('todo.create',{title:'blocker '+n,body:null,blockers:null})).id);
      await rpc('todo.update',{id:1,title:'T'.repeat(300),body:null});
      await rpc('todo.setBlockers',{id:1,blockers});
      await rpc('rail.rename',{id:'tokens',name:'A'.repeat(60)});
      await rpc('pad.rename',{name:'a-pad-with-a-very-long-name-here',newName:'P'.repeat(120),expectedIncarnation:'fixture-1'});
      window.__gripIds = [];
      let parent = null;
      for(const title of ['Root Todo','Child Todo','Grandchild Todo','Move Todo']) {
        const todo = await rpc('todo.create',{title,body:null,blockers:title === 'Move Todo' ? null : parent === null ? null : [parent]});
        window.__gripIds.push(todo.id); parent = todo.id;
      }
      const tab = document.querySelector('#shelf-tab-todos');
      if(tab.getAttribute('aria-expanded') !== 'true') tab.click();
    })()`);
    await wait("document.querySelector('.todos-tab')");
    await browser("eval", `document.querySelectorAll('.shelf-groups [data-state=closed] > .shelf-group-head [data-part=branch-control], .todos-tab [data-group-toggle][aria-expanded=false]').forEach(button => button.click())`);
    const selector = await read<string>("'.todos-tab [data-todo=\"'+window.__gripIds[3]+'\"] .sortable-handle'");
    await browser("scrollintoview", selector);
    const shot = async (step: string) => {
      const readings = await read(`({viewport:[innerWidth,innerHeight],seed:'tree-40',checks:window.__checks(),distance:window.__distance,step:getComputedStyle(document.documentElement).getPropertyValue('--tree-step'),panel:document.querySelector('.shelf')?.getBoundingClientRect().toJSON(),controls:Array.from(document.querySelectorAll('.shelf button')).filter(el=>el.checkVisibility()).map(el=>({label:el.getAttribute('aria-label'),box:el.getBoundingClientRect().toJSON()})),rows:Array.from(document.querySelectorAll('.shelf .shelf-row')).map(row=>({id:row.dataset.todo??row.dataset.pad,depth:row.getAttribute('aria-level'),box:row.getBoundingClientRect().toJSON(),grip:row.querySelector('.sortable-handle')?.getBoundingClientRect().toJSON(),age:row.querySelector('.item-age')?.getBoundingClientRect().toJSON()})),slot:document.querySelector('[data-dnd-placeholder]')?.getBoundingClientRect().toJSON(),calls:window.__fake.app.calls.filter(c=>['todo.setBlockers','todo.reorder','todo.move'].includes(c.method))})`);
      for (const directory of directories) {
        writeFileSync(join(directory, `${width}-${step}.checks.json`), JSON.stringify({revision,readings})+"\n");
        await browser("screenshot", join(directory, `${width}-${step}.png`));
      }
    };
    await browser("mouse", "move", "1", "1");
    await shot("rest");
    await browser("hover", selector); await shot("hover");
    await browser("focus", selector); await shot("focus");
    await browser("click", selector); await shot("selected");
    const start = await read<{x:number;y:number;step:number}>(`(() => {const b=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:b.left+1,y:b.top+b.height/2,step:parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tree-step'))};})()`);
    await browser("eval", "window.__fake.app.calls.length = 0");
    await browser("mouse", "move", String(start.x), String(start.y));
    await browser("mouse", "down");
    await browser("mouse", "move", String(start.x+6), String(start.y));
    await wait("!!document.querySelector('[data-dnd-placeholder]')");
    for (const depth of [0,1,2,3,8,-1]) {
      await browser("eval", `window.__distance = ${depth*start.step}`);
      await browser("mouse", "move", String(start.x+depth*start.step), String(start.y));
      await shot(`preview-${depth}`);
    }
    await browser("mouse", "move", String(start.x+2*start.step), String(start.y));
    await browser("mouse", "up");
    await wait("!document.querySelector('[data-dnd-placeholder]')");
    await shot("accepted");
    // A second lift canceled with Escape leaves no accepted change.
    await browser("mouse", "move", String(start.x), String(start.y));
    await browser("mouse", "down");
    await browser("mouse", "move", String(start.x-start.step), String(start.y));
    await wait("!!document.querySelector('[data-dnd-placeholder]')");
    await browser("press", "Escape");
    await browser("mouse", "up");
    await wait("!document.querySelector('[data-dnd-placeholder]')");
    await shot("cancelled");
    if (!base) {
      await browser("eval", "window.__fake.failNext(-32003, 'Cannot move this Todo because its dependency changed. Refresh and try again.')");
      await browser("focus", selector);
      await browser("press", "Space");
      await wait("!!document.querySelector('[data-dnd-placeholder]')");
      await browser("press", "ArrowLeft");
      await browser("press", "Space");
      await wait("!!document.querySelector('.todo-row [role=alert]')");
      await shot("failure");
    }
    await browser("click", "#shelf-tab-pads");
    await wait("!!document.querySelector('.pads-tab .pad-name')");
    await shot("pads");
  } finally { if (!base) await browser("record", "stop"); }
}, 180_000);
