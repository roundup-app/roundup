import { afterAll, beforeAll, expect, it } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { openLane, type LaneBrowser } from "../todos/laneBrowser";
import { captureDir } from "../testing/captures";

let lane: LaneBrowser;

beforeAll(async () => {
  lane = await openLane(1512, "dark", "shared-pads");
  const dir = captureDir("U3736");

  if (dir) {
    await mkdir(dir, { recursive: true });
    const url = await lane.evaluate<string>("location.href");
    await lane.browser("record", "start", join(dir, "shared-home.webm"), "about:blank");
    await lane.browser("set", "media", "dark");
    await lane.browser("open", url);
  }

  await lane.browser("set", "media", "dark");
  await lane.until(`!!document.querySelector("#shelf-tab-pads")`);
  await lane.evaluate(`(() => { const tab = document.querySelector('#shelf-tab-pads'); if (tab.getAttribute('aria-expanded') !== 'true') tab.click(); return true; })()`);
  await lane.until(`!!document.querySelector('.pads-tab [data-pad="pad-0"]')`);
}, 180_000);

afterAll(async () => { await lane?.close(); });

it("u3736_home_moves_regroup_the_same_pad_without_assignment", async () => {
  const dir = captureDir("U3736");
  const home = await lane.evaluate<string>(`window.__fake.app.rpc('rail.tree').then(nodes => nodes.find(node => node.kind === 'workstream').id)`);
  const homes = await lane.evaluate<string[]>(`window.__fake.app.rpc('rail.tree').then(nodes => nodes.filter(node => node.kind === 'workstream').slice(0, 3).map(node => node.id))`);
  await lane.evaluate(`(async () => {
    await window.__fake.app.rpc('pad.move', {name:'a-pad-with-a-very-long-name-here',home:${JSON.stringify(homes[1])}});
    await window.__fake.app.rpc('pad.rename', {name:'a-pad-with-a-very-long-name-here',newName:'Review notes with a deliberately long name for shared Project work',expectedIncarnation:(await window.__fake.app.rpc('pad.read',{name:'a-pad-with-a-very-long-name-here'})).incarnation});
    await window.__fake.app.rpc('pad.move', {name:'pad-2',home:${JSON.stringify(homes[2])}});
    return true;
  })()`);
  const pad = await lane.evaluate<{ incarnation: string; text: string }>(`window.__fake.app.rpc('pad.read', {name:'pad-0'})`);
  await lane.evaluate(`window.__fake.app.rpc('pad.move', {name:'pad-0',home:${JSON.stringify(home)}})`);
  await lane.until(`document.querySelector('.pads-tab [data-pad="pad-0"]')?.closest('[data-shelf-group]')?.dataset.shelfGroup === ${JSON.stringify(home)}`);
  expect(await lane.evaluate(`window.__fake.app.rpc('pad.read', {name:'pad-0'}).then(pad => ({incarnation:pad.incarnation,text:pad.text}))`)).toEqual(pad && { incarnation: pad.incarnation, text: pad.text });
  await lane.evaluate(`window.__fake.failNext(-32003, 'Taken; rename')`);
  await lane.browser("click", "button[aria-label='Add Pad']");
  await lane.browser("fill", "input[aria-label='Pad name']", "pad-0");
  await lane.browser("press", "Enter");
  await lane.until(`document.body.innerText.includes('Taken; rename')`);

  if (dir) {
    await lane.browser("record", "stop");
    await writeFile(join(dir, "shared-home.checks.json"), JSON.stringify(await lane.evaluate("window.__checks()")) + "\n");
    await lane.browser("screenshot", join(dir, "shared-home.png"));
  }
});
