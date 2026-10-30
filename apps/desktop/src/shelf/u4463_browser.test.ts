import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { shelfBrowser } from "./u371Browser";
import { captureDir } from "../testing/captures";

const { browser, evaluate, settle, openShelf } = shelfBrowser();

const directory = captureDir("U4463");

const dir = directory ? join(directory, process.env.ROUNDUP_U4463_BASELINE === "1" ? "base" : "head") : null;

const capture = async (name: string) => {
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  const [, checks] = await Promise.all([browser("screenshot", join(dir, `${name}.png`)), evaluate("window.__checks()")]);
  writeFileSync(join(dir, `${name}.checks.json`), JSON.stringify(checks, null, 2));
};

const cases = dir ? [["tree-40", 240], ["tree-40", 320], ["empty-project", 240], ["empty-project", 320]] as const : [["tree-40", 320]] as const;

it.each(cases)("u4463_space_requests_auto_once_from_the_head_%s_%s", async (seed, width) => {
  await openShelf(seed, 288, width, 1512, "dark");
  await browser("set", "viewport", "1512", "950");

  // The empty seed's existing Workstream action supplies the scenario's scoped Workstream.
  if (seed === "empty-project") {
    await evaluate(`window.__fake.app.rpc('rail.createWorkstream', {name:'Research', parent:null})`);
    await settle();
  }

  // Keep the dense seed's Todos in scope so refusal captures include its progress line.
  if (seed === "tree-40") {
    await evaluate(`(async () => {
      const todos = await window.__fake.app.rpc('todo.list', null);
      for (const todo of todos) await window.__fake.app.rpc('todo.move', {id:todo.id, home:'backend'});
    })()`);
  }

  const target = seed === "tree-40" ? '.rail-row[data-id="backend"]' : '.rail-row[data-id="n1"]';
  await browser("wait", target);
  await browser("click", `${target} .name`);
  await browser("wait", ".shelf-bar [role=switch]");
  // Like u3310's App-seam observer, acknowledge Auto through the Workstream event.
  await evaluate(`(async () => {
    const tree = await window.__fake.app.rpc('rail.tree', {});
    window.__fake.app.handlers['workstream.setAuto'] = ({id, auto}) => {
      tree.find(node => node.id === id).auto = auto;
      window.__fake.app.handlers['rail.tree'] = () => tree;
      window.__fake.emit({actor:{kind:'user',id:'you',parent:null},name:'workstream.updated',data:{id,auto}});
      return null;
    };
  })()`);
  await settle();

  if (seed === "tree-40") await browser("wait", "[data-todo-count]");

  await capture(`${seed}-${width}-todos`);
  await evaluate(`document.querySelector('.shelf-bar [role=switch]').focus()`);
  await browser("press", "Tab");
  await browser("press", "Shift+Tab");
  await capture(`${seed}-${width}-focus`);
  await browser("press", "Space");
  await browser("wait", "--fn", `document.querySelector('.shelf-bar [role=switch]').getAttribute('aria-checked') === 'true'`);
  expect(await evaluate(`window.__fake.app.calls.filter(c => c.method === 'workstream.setAuto').map(c => c.params.auto)`)).toEqual([true]);

  await evaluate(`window.__fake.failNext(-32003, 'Supervisor unavailable; start it and retry')`);
  await browser("click", ".shelf-bar [role=switch]");
  await browser("wait", ".shelf-bar [role=alert]");
  await capture(`${seed}-${width}-refused`);
  await browser("hover", ".shelf-bar [role=alert]");
  await browser("wait", "[role=tooltip]");
  await capture(`${seed}-${width}-refused-detail`);

  await browser("click", "#shelf-tab-pads");
  await browser("wait", ".pads-tab");
  await settle();
  await capture(`${seed}-${width}-pads`);

  if (dir && seed === "tree-40") {
    await browser("click", "#shelf-tab-todos");
    await browser("click", ".shelf-bar .shelf-add");
    await browser("fill", ".todos-tab .entry-field", "Review this work");
    await evaluate(`window.__fake.failNext(-32003, 'Todo refused; retry after reconnecting')`);
    await browser("press", "Enter");
    await browser("wait", ".todos-tab [role=alert]");
    await capture(`tree-40-${width}-todo-refused`);
    await browser("hover", ".todos-tab [role=alert]");
    await browser("wait", "[role=tooltip]");
    await capture(`tree-40-${width}-todo-refused-detail`);
    await browser("click", ".todos-tab .entry-field");
    await browser("press", "Escape");
    await evaluate(`(async () => {
      const tree = await window.__fake.app.rpc('rail.tree', {});
      tree.find(node => node.id === 'backend').name = 'W'.repeat(60);
      await window.__fake.app.rpc('rail.rename', {id:'backend',name:'W'.repeat(60)});
      const [template] = await window.__fake.app.rpc('todo.list', null);
      const todos = Array.from({length:200}, (_, index) => ({...template,id:index+1,title:'Review item '+index,home:'backend',done:true,blockers:[],blocked:false}));
      window.__fake.app.handlers['todo.list'] = () => todos;
      window.__fake.emit({actor:{kind:'user',id:'you',parent:null},name:'todo.updated',data:todos[0]});
    })()`);
    await browser("wait", "--fn", `document.querySelector('[data-todo-count]')?.textContent === '200/200'`);
    await settle();
    await capture(`tree-40-${width}-long-200-todos`);
    await browser("click", "#shelf-tab-pads");
    await settle();
    await capture(`tree-40-${width}-long-200-pads`);
  }
}, 60_000);
