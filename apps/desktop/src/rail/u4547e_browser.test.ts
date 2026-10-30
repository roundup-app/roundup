import { mkdirSync } from "node:fs";
import { afterAll, beforeAll, expect, it } from "vitest";
import { captureDir } from "../testing/captures";
import { openLane, type LaneBrowser } from "../todos/laneBrowser";

let lane: LaneBrowser;

beforeAll(async () => { lane = await openLane(1512, "dark", "u4547e"); }, 60_000);

afterAll(async () => { await lane?.close(); }, 60_000);

const seed = async () => {
  await lane.seedTodos([], false, "agents-10");

  return lane.evaluate<{ plain: string; mode: string }>(`(async () => {
    const plain = await window.__fake.app.rpc('rail.createWorkstream', {name:'Research',parent:null});
    const mode = await window.__fake.app.rpc('rail.createWorkstream', {name:'Review changes',parent:null});
    await window.__fake.app.rpc('workstream.setOpeningPrompt', {id:mode.id,prompt:'Review the current changes'});
    const agents = await window.__fake.app.rpc('rail.tree', null);
    for (const [index, agent] of agents.filter(node => node.kind === 'agent' && node.id !== 'agent-4').entries()) {
      await window.__fake.app.rpc('rail.move', {id:agent.id,parent:index % 2 ? mode.id : plain.id,index:0});
    }
    window.__fake.app.calls.length = 0;
    return {plain:plain.id,mode:mode.id};
  })()`);
};

const row = (id: string) => `.rail-row[data-id="${id}"]`;

it("u4547e_drag_reparents_the_chosen_agent_without_restarting", async () => {
  for (const kind of ["plain", "mode"] as const) {
    const destinations = await seed();
    const parent = destinations[kind];
    await lane.until(`document.querySelector(${JSON.stringify(row(parent))}) !== null`);
    await lane.browser("click", row("agent-4"));
    const identity = await lane.evaluate(`window.__fake.app.rpc('rail.tree', null).then(nodes => nodes.find(node => node.id === 'agent-4'))`);
    await lane.capture("U4547e", `before-${kind}`);

    const bounds = await lane.evaluate<{x:number;y:number;end:number}>(`(() => {
      const a = document.querySelector('${row("agent-4")} .sortable-handle').getBoundingClientRect();
      const b = document.querySelector('${row(parent)}').getBoundingClientRect();
      return {x:a.x+1,y:a.y+a.height/2,end:b.bottom+2};
    })()`);

    await lane.browser("mouse", "move", String(Math.round(bounds.x)), String(Math.round(bounds.y)));
    await lane.browser("mouse", "down");
    await lane.browser("mouse", "move", String(Math.round(bounds.x+6)), String(Math.round(bounds.y+6)));
    await lane.until("document.querySelector('[data-dnd-placeholder]') !== null");
    const destinationIndex = await lane.evaluate<number>(`[...document.querySelectorAll('.rail-row[data-id]')].filter(el => el.dataset.id !== 'agent-4').findIndex(el => el.dataset.id === '${parent}') + 1`);
    const target = await lane.evaluate<{top:number;bottom:number}>(`(() => { const b = document.querySelector('${row(parent)}').getBoundingClientRect(); return {top:b.top,bottom:b.bottom}; })()`);

    for (let y = target.top + 2; y < target.bottom + 64; y += 4) {
      await lane.browser("mouse", "move", String(Math.round(bounds.x+16)), String(Math.round(y)));
      const index = await lane.evaluate<string | undefined>(`document.querySelector('[data-sortable-index]')?.getAttribute('data-sortable-index')`);

      if (index === String(destinationIndex)) break;
    }

    await lane.browser("mouse", "up");
    await lane.until(`window.__fake.app.calls.some(call => call.method === 'rail.move') && !document.querySelector('[data-dnd-placeholder]')`);
    expect(await lane.calls("rail.move")).toEqual([{method:"rail.move",params:{id:"agent-4",parent,index:0}}]);
    const moved = await lane.evaluate(`window.__fake.app.rpc('rail.tree', null).then(nodes => nodes.find(node => node.id === 'agent-4'))`);
    expect(moved).toEqual({...Object(identity),parent,order:0});
    await lane.until(`document.querySelectorAll('${row("agent-4")}').length === 1 && !document.querySelector('.rail-section[aria-label="AGENTS"]')`);
    expect(await lane.evaluate(`document.querySelectorAll('${row("agent-4")}').length`)).toBe(1);
    expect(await lane.evaluate(`document.querySelector('.rail-section[aria-label="AGENTS"]')`)).toBeNull();
    await lane.capture("U4547e", `drag-${kind}`);
  }
}, 60_000);

it("u4547e_rendered_picker_and_refusal_keep_the_live_agent", async () => {
  const capture = captureDir("U4547e");

  if (capture) {
    mkdirSync(capture, { recursive: true });
    await lane.browser("record", "start", `${capture}/move-and-retry.webm`);
    // Recording restarts Chromium, so the new context needs the capture theme again.
    await lane.browser("set", "media", "dark");
  }

  await seed();
  await lane.capture("U4547e", "before-picker");
  await lane.browser("focus", row("agent-4"));
  await lane.browser("press", "m");
  await lane.until("document.querySelector('[role=combobox]') === document.activeElement");
  await lane.capture("U4547e", "destinations");
  await lane.browser("press", "Escape");
  await lane.until("!document.querySelector('[role=combobox]')");
  expect(await lane.evaluate("document.activeElement?.getAttribute('data-id')")).toBe("agent-4");
  expect(await lane.calls("rail.move")).toEqual([]);
  await lane.browser("press", "m");
  await lane.until("document.querySelector('[role=combobox]') === document.activeElement");
  await lane.evaluate("window.__fake.failNext(-32003, 'Move refused. Reopen the destination, then retry.')");
  await lane.browser("fill", "[role=combobox]", "Review");
  await lane.until("document.querySelectorAll('[role=option]').length === 1");
  await lane.browser("press", "Enter");
  await lane.until("document.querySelector('[role=alert]')?.textContent.includes('Move refused')");
  expect(await lane.evaluate("document.activeElement?.getAttribute('data-id')")).toBe("agent-4");
  await lane.capture("U4547e", "rejected-move");
  await lane.browser("click", ".rail-command-notice button");
  await lane.until("!document.querySelector('.rail-command-notice [role=alert]')");
  expect(await lane.calls("rail.move")).toHaveLength(1);
  await lane.capture("U4547e", "retry");

  if (capture) await lane.browser("record", "stop");
}, 60_000);
