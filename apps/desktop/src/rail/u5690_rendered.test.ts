import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { captureDir } from "../testing/captures";
import { browser, read, url, wait } from "../ui/tabsBrowser";

const ids = ["U5690a", "U5690b", "U5690c", "U5690d", "U5690e"];

const baseline = !!process.env.U5690_BASELINE;

const capture = async (step: string) => {
  for (const id of ids) {
    const root = captureDir(id);

    if (!root) continue;
    const dir = join(root, baseline ? "base" : "head");
    await mkdir(dir, { recursive: true });
    await browser("screenshot", join(dir, `${step}.png`));
    await writeFile(join(dir, `${step}.checks.json`), JSON.stringify(await read("window.__checks()"), null, 2));
  }
};

it("u5690_rendered_selection_actions_on_dense_tree", async () => {
  await browser("set", "viewport", "1512", "950");
  await browser("set", "media", "dark");
  await browser("open", url("/harness.html?seed=tree-40&view=workstreams&items=1&tabs=1&menu=1", baseline));
  await wait("!!window.__fake && document.querySelectorAll('.rail-row').length > 5");
  const root = captureDir("U5690a");

  if (root) {
    const dir = join(root, baseline ? "base" : "head");
    await mkdir(dir, { recursive: true });
    await browser("record", "restart", join(dir, "selection-actions.webm"));
  }

  try {
    const chosen = await read<string[]>(`(async () => {
      const app = window.__fake.app;
      const nodes = await app.rpc('rail.tree', null);
      const visible = [...document.querySelectorAll('.rail-row[data-id]')].slice(0, 5).map(row => row.dataset.id);
      const first = nodes.find(node => node.id === visible[0]);
      first.name = 'A selected row with a long name '.padEnd(60, 'x');
      first.worktree = {path:'/p/selected',branch:'selected',base:'main'};
      app.handlers['rail.tree'] = () => nodes;
      app.handlers['rail.group'] = ({ids}) => {
        const group = {...first,id:'selection-group',name:'Group',kind:'group',parent:null,order:0,terminal_id:null,worktree:null,status:null,attempt:null};
        ids.forEach((id,order) => Object.assign(nodes.find(node => node.id === id),{parent:group.id,order}));
        nodes.unshift(group);
        app.emit({actor:{kind:'user',id:'you',parent:null},name:'rail.changed'});
        return group;
      };
      app.handlers['rail.removeSelection'] = ({ids}) => {
        for (const id of ids) { const at = nodes.findIndex(node => node.id === id); if(at >= 0) nodes.splice(at,1); }
        app.emit({actor:{kind:'user',id:'you',parent:null},name:'rail.changed'});
        return {removed:[],kept:[]};
      };
      app.emit({actor:{kind:'user',id:'you',parent:null},name:'rail.changed'});
      return visible;
    })()`);

    await wait("!!document.querySelector('.rail-row .name')?.textContent.includes('A selected row')");
    await capture("dense-before");
    await browser("click", "[data-todo-root]");
    await read(`(() => { for (const id of ${JSON.stringify(chosen)}) document.querySelector('.rail-row[data-id="'+id+'"]').dispatchEvent(new MouseEvent('click',{bubbles:true,metaKey:true})); return true; })()`);
    const point = await read<{ x: number; y: number }>(`(() => { const box = document.querySelector('.rail-row[data-id="${chosen[0]}"]').getBoundingClientRect(); return {x:box.left+80,y:box.top+box.height/2}; })()`);
    await browser("mouse", "move", String(point.x), String(point.y));
    await browser("mouse", "down", "right");
    await browser("mouse", "up", "right");
    await wait("!!document.querySelector('[role=menu]')");
    await capture("selection-menu");
    expect(await read("[...document.querySelectorAll('.rail-row[data-selected=true]')].map(row => row.dataset.id)")).toEqual(chosen);

    if (baseline) {
      await browser("press", "Escape");

      return;
    }

    expect(await read("document.querySelectorAll('[role=menuitem]').length")).toBe(2);
    await browser("find", "role", "menuitem", "click", "--name", "Group", "--exact");
    await wait("document.activeElement?.matches('input[aria-label=Name]')");
    await capture("group-name");
    await read("window.__fake.failNext(-32003, 'Name could not be saved. Try again.'); true");
    await browser("fill", '[aria-label="Name"]', "Selected review work");
    await browser("press", "Enter");
    await wait("!!document.querySelector('.failure-line, [role=alert]')");
    await capture("rename-failure");
    await browser("press", "Escape");
    expect(await read("window.__fake.app.calls.filter(call => ['agent.spawn','agent.resume','agent.stop','rail.startDoor'].includes(call.method))")).toEqual([]);
    await browser("click", "[data-todo-root]");
    await read(`(() => { for (const id of ${JSON.stringify(chosen)}) document.querySelector('.rail-row[data-id="'+id+'"]').dispatchEvent(new MouseEvent('click',{bubbles:true,metaKey:true})); document.querySelector('.rail-row[data-id="${chosen[0]}"]').focus(); return true; })()`);
    await browser("press", "Meta+Backspace");
    await wait("window.__question.shown !== null");

    if (root) await writeFile(join(root, "head", "native-question.json"), JSON.stringify(await read("window.__question.shown"), null, 2));
    await capture("removal-question");
    await read("window.__question.answer(false); true");
    await wait("window.__question.shown === null");
    await capture("kept-selection");
    await read(`document.querySelector('.rail-row[data-id="${chosen[0]}"]').focus(); true`);
    await browser("press", "Meta+Backspace");
    await wait("window.__question.shown !== null");
    await read("window.__question.answer(true); true");
    await wait(`!document.querySelector('.rail-row[data-id="${chosen[0]}"]')`);
    await capture("removed-selection");
  } finally { if (root) await browser("record", "stop"); }
}, 120_000);
