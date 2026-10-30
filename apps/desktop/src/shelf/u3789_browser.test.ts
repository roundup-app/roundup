import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { browser, read, url, wait } from "../ui/tabsBrowser";
import { captureDir } from "../testing/captures";
import type { Checks } from "../testing/checks";

const shot = async (id: string, stage: string, step: string) => {
  const checks = await read<Checks>("window.__checks()");

  for (const directory of [captureDir(id), ...(id === "U4908" ? [captureDir("U4708")] : [])]) {
    if (!directory) continue;

    const folder = join(directory, stage);
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, `${step}.checks.json`), JSON.stringify(checks) + "\n");
    await browser("screenshot", join(folder, `${step}.png`));

    if (id === "U4908") {
      const columns = await read(`Array.from(document.querySelectorAll('.shelf-group-control, .shelf-row')).filter(row => row.checkVisibility()).map(row => ({name:row.textContent, mark:row.querySelector('[data-part=branch-indicator], .shelf-glyph')?.getBoundingClientRect().toJSON(), title:row.querySelector('.shelf-group-name, .shelf-title, .entry-field')?.getBoundingClientRect().toJSON(), count:row.querySelector('.shelf-group-count')?.getBoundingClientRect().toJSON()}))`);
      writeFileSync(join(folder, `${step}.columns.json`), JSON.stringify(columns) + "\n");
    }

    const boxes = await read(`Array.from(document.querySelectorAll('.rail-row, .shelf-row')).map(row => ({id:row.dataset.id ?? row.dataset.todo ?? row.dataset.incarnation, box:row.getBoundingClientRect().toJSON(), state:row.querySelector('.row-state .glyph, .shelf-glyph .glyph, .shelf-glyph .icon')?.getBoundingClientRect().toJSON(), name:row.querySelector('.name, .shelf-title, .pad-name')?.getBoundingClientRect().toJSON(), controls:Array.from(row.querySelectorAll('button,input[type=checkbox]')).filter(control => getComputedStyle(control).opacity !== '0' && control.checkVisibility({opacityProperty:true})).map(control => control.getAttribute('aria-label'))}))`);
    writeFileSync(join(folder, `${step}.rows.json`), JSON.stringify(boxes) + "\n");
  }

  return checks;
};

const load = async (seed: string, base = false) => {
  await browser("open", url(`/harness.html?seed=${seed}`, base));
  await wait("window.__fake && document.querySelector('.rail-tree')");
  await browser("eval", "localStorage.clear()");
  await browser("open", url(`/harness.html?seed=${seed}`, base));
  await wait("window.__fake && document.querySelector('.rail-tree')");
};

const overview = async () => {
  await browser("click", "[data-todo-root]");

  if (!await read("!!document.querySelector('#shelf-tab-todos')")) {
    await browser("press", "Meta+k");
    await browser("press", "b");
    await wait("document.querySelector('#shelf-tab-todos')");
  }

  await browser("eval", "(() => {const tab = document.querySelector('#shelf-tab-todos'); if (tab.getAttribute('aria-expanded') !== 'true') tab.click();})()");
  await wait("document.querySelector('.todos-tab')");
};

const dense = async () => {
  await browser("eval", `(async () => {
    const rpc = window.__fake.app.rpc;
    await rpc('todo.update', {id: 1, title: 'T'.repeat(300), body: null});
    await rpc('rail.rename', {id: 'tokens', name: 'A'.repeat(60)});
    await rpc('rail.rename', {id: 'payments', name: 'W'.repeat(60)});
    const made = [];
    for (let i = 0; i < 10; i++) made.push((await rpc('todo.create', {title: 'blocker ' + i, body: null, blockers: null})).id);
    await rpc('todo.setBlockers', {id: 1, blockers: made});
    await rpc('todo.assign', {id: 1, owner: {kind:'agent', id:'tokens', parent:null}});
    await rpc('pad.rename', {name: 'a-pad-with-a-very-long-name-here', newName: 'P'.repeat(120), expectedIncarnation: 'fixture-1'});
  })()`);
};

it("u3800a_owned_todo_grip_reorders_once", async () => {
  await load("tree-40");
  await browser("eval", `document.querySelector('.rail-row[data-id="tokens"] [data-pads-control]').click()`);
  await wait('document.querySelectorAll(".todos-tab .sortable-handle").length > 1');
  const grip = '.todos-tab [data-todo="1"] .sortable-handle';
  await browser("eval", "window.__fake.app.calls.length = 0");
  await browser("focus", grip);
  await browser("press", "Space");
  await wait('document.querySelector("[data-dnd-placeholder]")');
  await shot("U3800a", "head", "owned-todo-slot");
  await browser("press", "ArrowDown");
  await wait(`document.querySelector('.todos-tab [data-todo="1"]').closest(".todo-list").dataset.sortableIndex === "1"`);
  await browser("press", "Space");
  await wait('!document.querySelector("[data-dnd-placeholder]")');
  expect(await read("window.__fake.app.calls.filter(c => c.method === 'todo.reorder').map(c => c.params)")).toEqual([{id:1,before:3}]);
  expect(await read("window.__fake.app.calls.filter(c => ['todo.getHistory','todo.complete','todo.update','pad.write'].includes(c.method))")).toEqual([]);
  await wait(`document.activeElement === document.querySelector('${grip}')`);
}, 60_000);

it.each(["pad", "todo"].flatMap(kind => ["pointer", "Enter", "Space"].map(activation => ({ kind, activation }))))("u4908_open_button_opens_chosen_item_once_$kind/$activation", async ({ kind, activation }) => {
  await load("tree-40");
  await overview();

  if (kind === "pad") {
    await browser("click", "#shelf-tab-pads");
    await wait("document.querySelector('.pads-tab')");
  }

  await browser("eval", "document.querySelectorAll('.shelf-groups [data-state=closed] > .shelf-group-head [data-part=branch-control]').forEach(button => button.click())");
  const selector = kind === "pad" ? '.pads-tab [data-pad="a-pad-with-a-very-long-name-here"] .todo-open' : '.todos-tab [data-todo="1"] .todo-open';
  // Read the role/name before activating: a missing Pad action is the red case.
  expect(await read(`(() => { const button = document.querySelector('${selector}'); return button ? {role:button.tagName, name:button.getAttribute('aria-label')} : null; })()`)).toEqual({role:"BUTTON", name:kind === "pad" ? "Open a-pad-with-a-very-long-name-here" : "Open todo 1"});
  await browser("eval", "window.__fake.app.calls.length = 0");

  if (activation === "pointer") await browser("click", selector);
  else {
    await browser("focus", selector);
    await wait(`document.activeElement === document.querySelector('${selector}')`);
    await browser("press", activation);
  }

  await wait("document.querySelector('.drawer[data-open=true]')");
  const method = kind === "pad" ? "pad.read" : "todo.getHistory";
  expect(await read(`window.__fake.app.calls.filter(call => call.method === '${method}').map(call => call.params)`)).toEqual([kind === "pad" ? {name:"a-pad-with-a-very-long-name-here"} : {id:1}]);
  expect(await read("window.__fake.app.calls.filter(call => ['pad.rename','pad.move','todo.update','todo.complete','todo.reopen','todo.move','todo.assign'].includes(call.method))")).toEqual([]);
}, 60_000);


// Policy observer: pictures and Check readings are judged by the design critic.
it.skipIf(!captureDir("U4908")).each([true, false].flatMap(base => ["tree-40", "agents-10"].flatMap(seed => ["todos", "pads"].map(kind => ({base, seed, kind})))))("u4908_paired_row_columns_and_actions_$base/$seed/$kind", async ({base, seed, kind}) => {
  if (base && !process.env.U500_BASE_ROOT) return;
  const stage = base ? "base" : "head";
  await browser("set", "viewport", "1512", "950");
  await browser("set", "media", "dark");
  await load(seed, base);
  const video = !base && seed === "tree-40" ? captureDir("U4908") : null;

  if (video) { mkdirSync(join(video, "head"), {recursive:true}); await browser("record", "start", join(video, "head", `interaction-${kind}.webm`)); await wait("window.__fake && document.querySelector('.rail-tree')"); }

  try {
    // Recording starts a fresh browser context, so restore the observer media there.
    await browser("set", "viewport", "1512", "950");
    await browser("set", "media", "dark");
    await wait("matchMedia('(prefers-color-scheme: dark)').matches");
    await overview();

    if (seed === "tree-40") await dense();
    else await browser("eval", `(async () => {
      const rpc = window.__fake.app.rpc;
      await rpc('rail.rename', {id:'agent-1',name:'A'.repeat(60)});
      const blockers = [];
      for (let n=0;n<10;n++) blockers.push((await rpc('todo.create',{title:'blocker '+n,body:null,blockers:null})).id);
      await rpc('todo.create', {title:'T'.repeat(300),body:null,blockers,owner:{kind:'agent',id:'agent-1',parent:null}});
      await rpc('pad.create',{name:'P'.repeat(120),text:null});
      await rpc('pad.create',{name:'Short Pad',text:null});
    })()`);
    await browser("eval", `(async () => {
      const rpc = window.__fake.app.rpc;
      let parent = null;
      for (const title of ['Root Todo', 'Child Todo', 'Grandchild Todo', 'Great-grandchild Todo']) {
        const todo = await rpc('todo.create', {title, body:null, blockers:parent === null ? null : [parent]});
        parent = todo.id;
      }
    })()`);

    if (kind === "pads") await browser("click", "#shelf-tab-pads");
    await wait(`document.querySelector('.${kind}-tab')`);
    await browser("eval", "document.querySelectorAll('.shelf-groups [data-state=closed] > .shelf-group-head [data-part=branch-control]').forEach(button => button.click())");
    await browser("eval", "document.querySelectorAll('.todos-tab [data-group-toggle][aria-expanded=false]').forEach(button => button.click())");
    const row = kind === "todos" ? `.todos-tab [data-todo="${seed === "tree-40" ? 1 : 11}"] .todo-row-button` : `.pads-tab [data-pad="${"P".repeat(120)}"] .pad-name`;
    await browser("scrollintoview", row);
    await browser("mouse", "move", "1", "1");
    await browser("eval", "document.activeElement.blur()");
    await shot("U4908", stage, `${seed}-${kind}-rest`);
    await browser("hover", row);
    await shot("U4908", stage, `${seed}-${kind}-hover`);
    await browser("focus", row);
    await shot("U4908", stage, `${seed}-${kind}-focus`);
    await browser("click", row);
    await shot("U4908", stage, `${seed}-${kind}-selected`);
    await browser("press", "Enter");
    await wait("document.querySelector('.drawer[data-open=true]')");
    await shot("U4908", stage, `${seed}-${kind}-opened`);
    await browser("click", ".drawer[data-open=true] .close");
    await wait("!document.querySelector('.drawer[data-open=true]')");
    await browser("click", ".shelf-add");
    await wait("document.querySelector('.entry-field')");
    await shot("U4908", stage, `${seed}-${kind}-add`);
    await browser("fill", ".entry-field", "Rejected item");
    await browser("eval", `(async () => { const {RpcError} = await import('/src/app/seam.ts'); window.__fake.app.handlers['${kind === "todos" ? "todo.create" : "pad.create"}'] = () => {throw new RpcError(-32003, 'Creation refused; change the name and try again.');}; })()`);
    await browser("press", "Enter");
    await wait("document.body.textContent.includes('Creation refused')");
    await shot("U4908", stage, `${seed}-${kind}-failure`);
    await browser("press", "Escape");
    await browser("set", "viewport", "1280", "820");
    await shot("U4908", stage, `${seed}-${kind}-1280`);

  } finally {
    if (video) await browser("record", "stop");
  }
}, 60_000);
