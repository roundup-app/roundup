import { afterAll, beforeAll, expect, it } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { openLane, type LaneBrowser } from "../todos/laneBrowser";
import { captureDir } from "../testing/captures";

let lane: LaneBrowser;

beforeAll(async () => { lane = await openLane(1512, "dark", "shared-pads"); }, 180_000);

afterAll(async () => { await lane?.close(); });

it("u3736_home_moves_regroup_the_same_pad_without_assignment", async () => {
  await lane.evaluate(`(() => { const tab = document.querySelector('#shelf-tab-pads'); if (tab.getAttribute('aria-expanded') !== 'true') tab.click(); return true; })()`);
  await lane.until(`!!document.querySelector('.pads-tab [data-pad="pad-0"]')`);
  const home = await lane.evaluate<string>(`window.__fake.app.rpc('rail.tree').then(nodes => nodes.find(node => node.kind === 'workstream').id)`);
  const pad = await lane.evaluate<{ incarnation: string; text: string }>(`window.__fake.app.rpc('pad.read', {name:'pad-0'})`);
  await lane.evaluate(`window.__fake.app.rpc('pad.move', {name:'pad-0',home:${JSON.stringify(home)}})`);
  await lane.until(`document.querySelector('.pads-tab [data-pad="pad-0"]')?.closest('[data-shelf-group]')?.dataset.shelfGroup === ${JSON.stringify(home)}`);
  expect(await lane.evaluate(`window.__fake.app.rpc('pad.read', {name:'pad-0'}).then(pad => ({incarnation:pad.incarnation,text:pad.text}))`)).toEqual(pad && { incarnation: pad.incarnation, text: pad.text });
  await lane.evaluate(`window.__fake.failNext(-32003, 'A Pad with this name already exists. Choose another name.')`);
  await lane.browser("click", "button[aria-label='Add Pad']");
  await lane.browser("fill", "input[aria-label='Pad name']", "pad-0");
  await lane.browser("press", "Enter");
  await lane.until(`document.body.innerText.includes('Choose another name.')`);
  const dir = captureDir("U3736");

  if (dir) {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "shared-home.checks.json"), JSON.stringify(await lane.evaluate("window.__checks()")) + "\n");
    await lane.browser("screenshot", join(dir, "shared-home.png"));
  }
});
