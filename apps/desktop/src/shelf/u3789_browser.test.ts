import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { browser, read, url, wait } from "../ui/tabsBrowser";
import { captureDir } from "../testing/captures";
import { CHECK_IDS } from "../testing/checks";
import type { Checks } from "../testing/checks";

const shot = async (id: string, stage: string, step: string) => {
  const checks = await read<Checks>("window.__checks()");
  const directory = captureDir(id);

  if (directory) {
    const folder = join(directory, stage);
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, `${step}.checks.json`), JSON.stringify(checks) + "\n");
    await browser("screenshot", join(folder, `${step}.png`));

    if (id === "U4335a") {
      const geometry = await read(`(async () => { const todos = await window.__fake.app.rpc('todo.list', {}); const nodes = await window.__fake.app.rpc('rail.tree', {}); return Array.from(document.querySelectorAll('.rail-row, .rail-leaf, .todos-tab .todo-row')).filter(row => row.checkVisibility()).map(row => {
        const style = getComputedStyle(row);
        const rect = element => element?.getBoundingClientRect().toJSON();
        const id = row.dataset.id ?? row.dataset.todo ?? row.querySelector('[data-todo]')?.dataset.todo;
        const todo = todos.find(todo => String(todo.id) === id);
        return {id, surface: row.matches('.rail-leaf, .rail-row') ? 'rail' : 'shelf', depth: row.dataset.id ? Number(style.getPropertyValue('--tree-depth')) : Number(row.getAttribute('aria-level') ?? row.dataset.level) - 1, parent: todo ? todo.blockers[0] ?? (row.matches('.rail-leaf') ? todo.creator.id : null) : nodes.find(node => node.id === id)?.parent ?? null,
          row: rect(row), glyph: rect(row.querySelector('.row-state .glyph, .shelf-glyph .glyph, .line .glyph') ?? row.querySelector('.todo-tick')), label: rect(row.querySelector('.name, .shelf-title')),
          step: style.getPropertyValue('--tree-step'), origin: style.getPropertyValue('--tree-origin'),
          trunks: Array.from(row.querySelectorAll('.tree-pass, .tree-stem, .tree-branch, .rail-pass, .rail-stem, .rail-branch')).map(line => ({kind: line.className, level: line.style.getPropertyValue('--level'), last: line.dataset.last, rect: rect(line), backgroundSize: getComputedStyle(line).backgroundSize, backgroundPosition: getComputedStyle(line).backgroundPosition}))};
      }); })()`);

      writeFileSync(join(folder, `${step}.geometry.json`), JSON.stringify({sha: stage === "head" ? process.env.U4335_HEAD_SHA : process.env.U4335_BASE_SHA, seed: step, indentToken: "--space-5", rows: geometry}) + "\n");
    }

    const boxes = await read(`Array.from(document.querySelectorAll('.rail-row, .shelf-row')).map(row => ({id:row.dataset.id ?? row.dataset.todo ?? row.dataset.incarnation, box:row.getBoundingClientRect().toJSON(), state:row.querySelector('.row-state .glyph, .shelf-glyph .glyph')?.getBoundingClientRect().toJSON(), name:row.querySelector('.name, .shelf-title, .pad-name')?.getBoundingClientRect().toJSON(), controls:Array.from(row.querySelectorAll('button,input[type=checkbox]')).filter(control => getComputedStyle(control).opacity !== '0' && control.checkVisibility({opacityProperty:true})).map(control => control.getAttribute('aria-label'))}))`);
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
    await rpc('pad.rename', {name: 'a-pad-with-a-very-long-name-here', newName: 'P'.repeat(120), expectedIncarnation: 'fixture-1'});
  })()`);
};

it("u3789a_drag_never_opens", async () => {
  await browser("set", "viewport", "1512", "950");
  await browser("set", "media", "dark");
  await load("tree-40");
  await overview();
  await browser("eval", "document.querySelector('.todos-tab [data-shelf-group=unassigned][data-state=closed] [data-part=branch-control]')?.click()");
  const selector = '.todos-tab [data-todo="1"] .sortable-handle';
  await wait(`document.querySelector('${selector}')`);
  const point = await read<{ x: number; y: number }>(`(() => { const row = document.querySelector('${selector}'); row.scrollIntoView({block:'center'}); const box = row.getBoundingClientRect(); return {x: box.x + box.width / 2, y: box.y + box.height / 2}; })()`);
  await browser("eval", "window.__fake.app.calls.length = 0");
  await browser("mouse", "move", String(point.x), String(point.y));
  await browser("mouse", "down");
  await browser("mouse", "move", String(point.x + 8), String(point.y + 8));
  await wait("document.querySelector('[data-dnd-placeholder]')");
  await browser("mouse", "move", String(point.x), String(point.y));
  await browser("mouse", "up");
  await wait("!document.querySelector('[data-dnd-placeholder]')");
  expect(await read("!!document.querySelector('.drawer[data-open=true], .row-name-editor')")).toBe(false);
  expect(await read("window.__fake.app.calls.filter(call => ['todo.getHistory','todo.readHistory','todo.update'].includes(call.method))")).toEqual([]);
  await shot("U3789a", "head", "drag-release");
}, 120_000);

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

it("u3789b_u3789d_rendered_rows_and_unchanged_disclosures", async () => {
  await browser("set", "viewport", "1512", "950");
  await browser("set", "media", "dark");
  const baseline = new Map<string, Checks>();

  for (const base of process.env.U500_BASE_ROOT ? [true, false] : [false]) {
    for (const seed of ["tree-40", "agents-10", "empty-project"]) {
      await load(seed, base);
      await overview();
      const checks = await shot("U3789d", base ? "base" : "head", `${seed}-rest`);

      if (base) baseline.set(seed, checks);
      else {
        for (const id of CHECK_IDS) if (baseline.get(seed)?.[id].status === "pass") expect(checks[id].status, `${seed} ${id}`).toBe("pass");
      }

      if (seed === "tree-40") {
        await dense();
        await shot("U3789d", base ? "base" : "head", "dense-rest");
        await browser("mouse", "move", "1", "1");
        await shot("U3789d", base ? "base" : "head", "outside");
      }
    }
  }

  await load("tree-40");
  await overview();
  const directoryVideo = captureDir("U3789d");

  if (directoryVideo) {
    await browser("record", "start", join(directoryVideo, "interaction.webm"));
    await browser("set", "viewport", "1512", "950");
    await browser("set", "media", "dark");
    await wait("window.__fake && document.querySelector('.rail-tree')");
    await overview();
  }

  await dense();
  await wait("document.querySelector('.todos-tab [data-todo=\"1\"]')");
  await browser("eval", "document.querySelector('.todos-tab [data-shelf-group=unassigned][data-state=closed] [data-part=branch-control]')?.click()");
  const title = '.todos-tab [data-todo="1"] .todo-row-button';
  await browser("mouse", "move", "1", "1");
  await browser("eval", "document.activeElement.blur()");
  await shot("U3789d", "head", "dense-rest");
  await browser("hover", title);
  await shot("U3789d", "head", "dense-hover");
  await browser("focus", title);
  await shot("U3789d", "head", "dense-focus");
  await browser("click", title);
  await shot("U3789d", "head", "dense-selected");
  await browser("eval", `(() => {
    window.__rowMutations = [];
    const groups = document.querySelector('.todos-tab .shelf-groups');
    window.__rowObserver = new MutationObserver(records => window.__rowMutations.push(...records.map(record => ({type: record.type, target: record.target.nodeName}))));
    window.__rowObserver.observe(groups, {subtree: true, childList: true, characterData: true, attributes: true});
    window.__rowFolds = [...groups.querySelectorAll('[data-shelf-group]')].map(group => [group.dataset.shelfGroup, group.getAttribute('aria-expanded')]);
  })()`);
  await browser("click", ".shelf-add");
  await wait("document.activeElement?.matches('.entry-field')");
  await browser("fill", ".todos-tab .entry-field", "twenty characters ok");
  await shot("U3789b", "head", "typing");
  const typing = await read("({mutations: window.__rowMutations, folds: [...document.querySelectorAll('.todos-tab [data-shelf-group]')].map(group => [group.dataset.shelfGroup, group.getAttribute('aria-expanded')]), before: window.__rowFolds})");
  const directory = captureDir("U3789b");

  if (directory) writeFileSync(join(directory, "typing-observation.json"), JSON.stringify(typing) + "\n");
  await browser("eval", "window.__fake.failNext(-32003, 'add busy')");
  await browser("eval", "document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', code:'Enter', bubbles:true, cancelable:true}))");
  await wait("document.querySelector('.todos-tab [role=alert]')?.textContent.includes('add busy')");
  await shot("U3789b", "head", "dense-failure");
  await shot("U3789c", "head", "empty-groups-absent");
  await browser("eval", "window.__rowObserver.disconnect()");
  await browser("eval", "document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', code:'Escape', bubbles:true, cancelable:true}))");
  await browser("focus", title);
  await browser("press", "F2");
  await wait("document.querySelector('.row-name-editor input')");
  await browser("fill", ".row-name-editor input", "  renamed 日本語 🌱  ");
  await shot("U3789a", "head", "dense-rename");
  await browser("eval", "window.__fake.failNext(-32003, 'name taken')");
  await browser("press", "Enter");
  await wait("document.body.textContent.includes('name taken')");
  await shot("U3789d", "head", "dense-rename-failure");
  await browser("eval", "document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', code:'Escape', bubbles:true, cancelable:true}))");
  await wait("!document.querySelector('.row-name-editor') && document.querySelector('.todos-tab').checkVisibility()");
  await browser("scrollintoview", '.todos-tab [data-todo="2"] .todo-row-button');
  await browser("click", '.todos-tab [data-todo="2"] .todo-row-button');
  await shot("U3789d", "head", "before-complete");
  await wait("document.activeElement?.matches('.todos-tab [data-todo=\"2\"] .todo-row-button')");
  await browser("eval", "window.__fake.failNext(-32003, 'locked')");
  await browser("click", '.todos-tab [data-todo="2"] .todo-tick');
  await wait("document.body.textContent.includes('locked')");
  await shot("U3789d", "head", "dense-complete-failure");
  await browser("click", ".shelf-add");
  await browser("fill", ".todos-tab .entry-field", "accepted title");
  await browser("press", "Enter");
  await wait("document.querySelector('.todos-tab .entry-field')?.value === ''");
  await shot("U3789b", "head", "submitted");

  if (directoryVideo) await browser("record", "stop");
}, 300_000);

it("u3789d_focus_reaches_open_and_secondary_actions", async () => {
  await browser("set", "viewport", "1512", "950");
  await browser("set", "media", "dark");
  await load("tree-40");
  await overview();
  await browser("eval", "document.querySelector('.todos-tab [data-shelf-group=unassigned][data-state=closed] [data-part=branch-control]')?.click()");
  await browser("focus", '.todos-tab [data-todo="1"] .todo-row-button');
  await shot("U3789d", "head", "focused");
  await browser("press", "Tab");
  await wait("document.activeElement?.matches('.todo-tick')");
  await browser("press", "Shift+Tab");
  await wait("document.activeElement?.matches('.todos-tab [data-todo=\"1\"] .todo-row-button')");
  await browser("press", "Enter");
  await wait("document.querySelector('.drawer[data-open=true]')");
  expect(await read("window.__fake.app.calls.filter(call => call.method === 'todo.getHistory').length")).toBe(1);
  await browser("press", "Escape");
  await wait("!document.querySelector('.drawer[data-open=true]')");
}, 120_000);

it("u3789d_single_selection_and_retained_rail_failure", async () => {
  await browser("set", "viewport", "1512", "950");
  await browser("set", "media", "dark");

  for (const base of process.env.U500_BASE_ROOT ? [true, false] : [false]) {
    const stage = base ? "base" : "head";
    await load("tree-40", base);
    await overview();
    await browser("eval", "document.querySelector('.todos-tab [data-shelf-group=unassigned][data-state=closed] [data-part=branch-control]')?.click()");
    await browser("click", '.todos-tab [data-todo="2"] .todo-row-button');
    await wait("document.activeElement?.matches('.todo-row-button')");
    await shot("U3789d", stage, "tree-40-shelf-select");
    await browser("eval", "document.querySelector('.drawer[data-open=true] .close')?.click()");
    await wait("!document.querySelector('.drawer[data-open=true]')");
    await browser("click", "#shelf-tab-pads");
    await wait("document.querySelector('.pads-tab')");
    await shot("U3789d", stage, "tree-40-pads-rest");
    await browser("eval", "document.querySelector('.pads-tab [data-shelf-group=unassigned][data-state=closed] [data-part=branch-control]')?.click()");
    await browser("click", '.pads-tab [data-pad="a-pad-with-a-very-long-name-here"] .pad-name');
    await wait("document.activeElement?.matches('.pad-name')");
    await shot("U3789d", stage, "tree-40-pads-select");
    await load("conflict", base);
    await browser("click", "#shelf-tab-pads");
    await wait("document.querySelector('.pads-tab')");
    await browser("eval", "document.querySelector('.pads-tab [data-shelf-group=unassigned][data-state=closed] [data-part=branch-control]')?.click()");
    await browser("focus", '.pads-tab [data-pad="a-pad-with-a-very-long-name-here"] .pad-name');
    await browser("press", "Enter");
    await wait("document.querySelector('.drawer[data-open=true]')");
    await shot("U3789d", stage, "conflict-pad");
  }

  await load("tree-40");
  await browser("focus", '.rail-row[data-id="tokens"]');
  await browser("press", "F2");
  await wait("document.activeElement?.getAttribute('aria-label') === 'Name'");
  await browser("fill", '.rail-row[data-id="tokens"] input', "  exact 日本語 🌱  ");
  // Background resource reads must not consume the rename refusal.
  await browser("eval", "(async () => { const { RpcError } = await import('/src/app/seam.ts'); window.__fake.app.handlers['rail.rename'] = () => { throw new RpcError(-32003, 'name already taken'); }; })()");
  await browser("eval", "document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', code:'Enter', bubbles:true, cancelable:true}))");
  await wait("document.querySelector('[role=alert]')?.textContent.includes('name already taken')");
  await browser("click", '.rail-row[data-id="agent-4"] .name');
  await wait("document.activeElement?.closest('[data-id]')?.dataset.id === 'agent-4'");
  await shot("U3789d", "head", "rail-rename-failure-after-selection");
  await browser("find", "role", "button", "click", "--name", "Retry", "--exact");
  await wait("document.activeElement?.matches('.rail-row[data-id=tokens] input')");
  expect(await read("document.activeElement.value")).toBe("  exact 日本語 🌱  ");
  await shot("U3789d", "head", "rail-rename-retry");
}, 180_000);

it("u4275b_tab_reaches_quick_actions", async () => {
  await browser("set", "viewport", "1512", "950");
  await browser("set", "media", "dark");
  await load("tree-40");
  await browser("focus", '.rail-row[data-id="tokens"]');
  await browser("press", "Tab");
  await wait("document.activeElement?.getAttribute('aria-label') === 'Stop'");
  await browser("press", "Tab");
  await wait("document.activeElement?.getAttribute('aria-label') === 'Open folder'");
  await browser("press", "Tab");
  await wait("document.activeElement?.getAttribute('aria-label') === 'Open in editor'");
  await browser("press", "Shift+Tab");
  await wait("document.activeElement?.getAttribute('aria-label') === 'Open folder'");
  await browser("press", "Enter");
  await wait("window.__fake.app.openedTargets.length === 1");
  await browser("press", "Space");
  await wait("window.__fake.app.openedTargets.length === 2");
  expect(await read("window.__fake.app.openedTargets[0]")).toEqual(await read("window.__fake.app.openedTargets[1]"));
}, 120_000);

// U4707: dense rows read the 32px --row-text-inset Token; elbows and glyph columns follow it.
it("u4275a_u4275b_u4275c_dense_row_captures", async () => {
  await browser("set", "viewport", "1512", "950");
  await browser("set", "media", "dark");
  const baselines = new Map<string, Checks>();

  for (const base of process.env.U500_BASE_ROOT ? [true, false] : [false]) {
    for (const seed of ["tree-40", "agents-10"]) {
      const video = !base && seed === "tree-40" ? (captureDir("U4335a") ?? captureDir("U4275b")) : null;

      await load(seed, base);

      if (video) { mkdirSync(join(video, "head"), {recursive:true}); await browser("record", "start", join(video, "head", "interaction.webm")); await browser("set", "viewport", "1512", "950"); await browser("set", "media", "dark"); await wait("window.__fake && document.querySelector('.rail-tree')"); }

      await overview();

      if (seed === "tree-40") {
        await dense();
        await browser("eval", `(async () => {
          const rpc = window.__fake.app.rpc;
          const parent = await rpc('todo.create', {title: 'Parent Todo', body: 'Body stays in the opened Todo', blockers: null});
          const child = await rpc('todo.create', {title: 'Child Todo', body: null, blockers: null});
          const sibling = await rpc('todo.create', {title: 'Child sibling Todo', body: null, blockers: null});
          const grandchild = await rpc('todo.create', {title: 'Grandchild Todo', body: null, blockers: null});
          await rpc('todo.setBlockers', {id:child.id,blockers:[parent.id]});
          await rpc('todo.setBlockers', {id:sibling.id,blockers:[parent.id]});
          await rpc('todo.setBlockers', {id:grandchild.id,blockers:[child.id]});
          await rpc('todo.create', {title: 'Grandchild sibling Todo', body: null, blockers:[child.id]});
          window.__fake.actAs({kind:'agent', id:'tokens', parent:null});
          const root = await rpc('todo.create', {title:'Rail parent', body:null, blockers:null});
          const branch = await rpc('todo.create', {title:'Rail child', body:null, blockers:[root.id]});
          await rpc('todo.create', {title:'Rail sibling', body:null, blockers:[root.id]});
          await rpc('todo.create', {title:'Rail grandchild', body:null, blockers:[branch.id]});
          await rpc('todo.create', {title:'Rail grandchild sibling', body:null, blockers:[branch.id]});
          window.__fake.actAs({kind:'user', id:'you', parent:null});
        })()`);
      }

      await browser("eval", "document.querySelector('.todos-tab [data-shelf-group=unassigned][data-state=closed] [data-part=branch-control]')?.click()");
      await browser("eval", "document.querySelectorAll('.todos-tab [data-group-toggle][aria-expanded=false]').forEach(button => button.click())");
      const stage = base ? process.env.U4335_BASE_STAGE ?? "base" : "head";

      for (const step of ["rest", "hover", "focus", "selected"]) {
        await browser("mouse", "move", "1", "1");
        await browser("eval", "document.activeElement.blur()");

        if (step === "hover") await browser("hover", '.rail-row[data-id="agent-4"]');

        if (step === "focus") await browser("focus", '.rail-row[data-id="agent-4"]');

        if (step === "selected") {
          const row = seed === "tree-40" ? '.rail-row[data-id="tokens"]' : '.rail-row[data-id="agent-4"]';

          await browser("focus", row);
          await browser("press", "Enter");
          await wait(`document.querySelector('${row}')?.dataset.selected === 'true' && document.querySelector('[data-shelf-scope] button[aria-label^="add todo to "]')?.getAttribute('aria-label') === 'add todo to ' + document.querySelector('${row} .name')?.textContent`);
        }


        for (const id of ["U4275a", "U4275b", "U4275c", "U4335a"]) {
          const checks = await shot(id, stage, `${seed}-${step}`);
          const key = `${seed}-${step}`;

          if (base) baselines.set(key, checks);
          else if (!captureDir("U4335a")) for (const check of CHECK_IDS) if (baselines.get(key)?.[check].status === "pass") expect(checks[check].status, `${key} ${check}`).toBe("pass");
        }
      }

      if (seed === "tree-40") {
        await overview();
        await browser("eval", "document.querySelectorAll('.todos-tab [data-group-toggle][aria-expanded=false]').forEach(button => button.click())");
        await browser("eval", "document.querySelector('.todos-tab [data-todo=\"19\"]')?.scrollIntoView({block:'center'})");

        for (const id of ["U4275a", "U4275b", "U4275c", "U4335a"]) await shot(id, stage, "nested-todos");

        {
          await browser("eval", "(async () => { const {RpcError} = await import('/src/app/seam.ts'); window.__fake.app.openFailure = new RpcError(-32008, 'Folder unavailable; try again.'); })()");

          await browser("click", '.rail-row[data-id="agent-4"]');
          await browser("focus", '.rail-row[data-id="agent-4"] [aria-label="Open folder"]');
          await browser("press", "Enter");

          await wait("Array.from(document.querySelectorAll('.rail [role=alert]')).some(alert => alert.textContent.includes('Folder unavailable'))");

          for (const id of ["U4275a", "U4275b", "U4275c", "U4335a"]) await shot(id, stage, "dense-action-failure");
        }
      }

      if (video) await browser("record", "stop");
    }
  }
}, 300_000);


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
it.skipIf(!captureDir("U4908"))("u4908_paired_row_columns_and_actions", async () => {
  await browser("set", "viewport", "1512", "950");
  await browser("set", "media", "dark");
  for (const base of process.env.U500_BASE_ROOT ? [true, false] : [false]) {
    const stage = base ? "base" : "head";
    for (const seed of ["tree-40", "agents-10"]) {
      await load(seed, base);
      const video = !base && seed === "tree-40" ? captureDir("U4908") : null;
      if (video) { mkdirSync(join(video, "head"), {recursive:true}); await browser("record", "start", join(video, "head", "interaction.webm")); await wait("window.__fake && document.querySelector('.rail-tree')"); }
      await overview();
      await dense();
      await browser("eval", `(async () => {
        const rpc = window.__fake.app.rpc;
        let parent = null;
        for (const title of ['Root Todo', 'Child Todo', 'Grandchild Todo', 'Great-grandchild Todo']) {
          const todo = await rpc('todo.create', {title, body:null, blockers:parent === null ? null : [parent]});
          parent = todo.id;
        }
      })()`);
      for (const kind of ["todos", "pads"]) {
        await browser("click", `#shelf-tab-${kind}`);
        await wait(`document.querySelector('.${kind}-tab')`);
        await browser("eval", "document.querySelectorAll('.shelf-groups [data-state=closed] > .shelf-group-head [data-part=branch-control]').forEach(button => button.click())");
        const row = kind === "todos" ? '.todos-tab [data-todo="1"] .todo-row-button' : '.pads-tab .pad-name';
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
        await browser("press", "Escape");
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
      }
      if (video) await browser("record", "stop");
    }
  }
}, 300_000);
