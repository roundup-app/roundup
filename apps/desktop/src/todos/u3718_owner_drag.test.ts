import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openLane } from "./laneBrowser";
import type { LaneBrowser } from "./laneBrowser";

type Point = { x: number; y: number };

const ROW = (id: number) => `.shelf [data-id="${id}"] .shelf-title`;

const HEAD = `.shelf [data-shelf-group="me"] .shelf-group-head`;

const centre = (lane: LaneBrowser, selector: string) => lane.evaluate<Point>(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.scrollIntoView({ block: "center" }); const b = el.getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }; })()`);

const move = (lane: LaneBrowser, x: number, y: number) => lane.browser("mouse", "move", String(x), String(y));

/** Presses the row, starts the drag, and returns once every owner shows (U3718). */
const lift = async (lane: LaneBrowser, id: number) => {
  const from = await centre(lane, ROW(id));

  await move(lane, from.x, from.y);
  await lane.browser("mouse", "down");
  await move(lane, from.x, from.y - 6);
  await lane.until(`!!document.querySelector('.shelf [data-shelf-group="me"]')`);

  return from;
};

describe("u3718 a Todo dragged to another owner's group", () => {
  let lane: LaneBrowser;

  beforeAll(async () => { lane = await openLane(1512, "light", "u3718"); }, 180_000);

  afterAll(async () => { await lane?.close(); });

  it("u3718_every_owner_is_a_drop_target_while_dragging_and_a_drop_assigns_once", async () => {
    await lane.seedTodos(["first", "second", "third"]);

    const [one] = await lane.order();

    expect(await lane.evaluate<boolean>(`!document.querySelector('.shelf [data-shelf-group="me"]')`)).toBe(true);
    await lift(lane, one!);
    // The empty Me group is named while the drag is live, though it holds no Todo.
    const to = await centre(lane, HEAD);

    await move(lane, to.x, to.y);
    await lane.until(`!!document.querySelector('[data-drop-target]')`);
    await lane.browser("mouse", "up");
    await lane.until(`document.querySelector('.shelf [data-id="${one}"]')?.closest('[data-shelf-group]')?.dataset.shelfGroup === 'me'`);

    expect((await lane.calls("todo.assign")).map(call => call.params)).toEqual([{ id: one, owner: { kind: "user", id: "you", parent: null } }]);
    expect(await lane.calls("todo.reorder")).toEqual([]);
  }, 120_000);

  it("u3718_esc_calls_nothing", async () => {
    await lane.seedTodos(["first", "second", "third"]);

    const [one] = await lane.order();
    await lift(lane, one!);
    const to = await centre(lane, HEAD);

    await move(lane, to.x, to.y);
    await lane.browser("press", "Escape");
    await lane.browser("mouse", "up");
    await new Promise(resolve => setTimeout(resolve, 500));

    expect(await lane.calls("todo.assign")).toEqual([]);
  }, 120_000);
});
