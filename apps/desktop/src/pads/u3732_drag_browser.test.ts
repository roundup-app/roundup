import { afterAll, beforeAll, expect, it } from "vitest";
import { openLane } from "../todos/laneBrowser";
import type { LaneBrowser } from "../todos/laneBrowser";

type Point = { x: number; y: number };

const centre = (lane: LaneBrowser, selector: string) => lane.evaluate<Point>(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.scrollIntoView({ block: "center" }); const b = el.getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }; })()`);

const move = (lane: LaneBrowser, point: Point) => lane.browser("mouse", "move", String(point.x), String(point.y));

let lane: LaneBrowser;

beforeAll(async () => { lane = await openLane(1512, "dark", "u3732"); }, 180_000);

afterAll(async () => { await lane?.close(); });

it("u3732_drag_to_a_group_calls_set_owner_once", async () => {
  await lane.evaluate(`(() => { document.querySelector('#shelf-tab-pads').click(); return true; })()`);
  await lane.until(`!!document.querySelector('.pads-tab [data-pad="pad-0"]')`);
  await lane.resetCalls();

  const from = await centre(lane, '.pads-tab [data-pad="pad-0"] .pad-name');

  await move(lane, from);
  await lane.browser("mouse", "down");
  await move(lane, { x: from.x, y: from.y - 6 });
  await lane.until(`!!document.querySelector('.pads-tab [data-shelf-group="me"]')`);
  await move(lane, await centre(lane, '.pads-tab [data-shelf-group="me"] .shelf-group-head'));
  await lane.until(`!!document.querySelector('.pads-tab [data-shelf-group="me"][data-drop-target]')`);
  await lane.browser("mouse", "up");
  await lane.until(`window.__fake.app.calls.some(call => call.method === 'pad.setOwner')`);

  expect((await lane.calls()).filter(call => call.method !== "pad.list" && call.method.startsWith("pad."))).toEqual([{ method: "pad.setOwner", params: { name: "pad-0", owner: { kind: "user", id: "you", parent: null } } }]);
  await lane.until(`!!document.querySelector('.pads-tab [data-shelf-group="me"] [data-pad="pad-0"]')`);
}, 120_000);
