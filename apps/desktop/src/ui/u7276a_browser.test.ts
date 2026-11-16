import { afterAll, beforeAll, expect, it } from "vitest";
import { browser, closeBrowser, openBrowser, read } from "./u484Browser";
import { REORDERS, harness, liftAndEscape, pointIn, todos } from "./u7276Browser";

beforeAll(openBrowser, 90_000);

afterAll(closeBrowser);

/** Expands `tab` unless a stored layout already shows it expanded. */
const expand = (tab: string) => browser("eval", `(() => { const tab = document.querySelector(${JSON.stringify(tab)}); if (tab.getAttribute('aria-expanded') !== 'true') tab.click(); })()`);

const pads = async () => {
  await expand("#shelf-tab-pads");
  await browser("wait", "--fn", "document.querySelectorAll('.pads-tab .pad-name').length >= 2");
};

// The Rail row's hover icons cover its name's midpoint, so each press lands near the start of the row's surface.
const SURFACES = [
  { list: "rail", seed: "tree-40", open: null, surface: '.rail-row[data-id="tokens"] .name' },
  { list: "pads", seed: "tree-40", open: pads, surface: ".pads-tab [data-pad] .pad-name" },
  { list: "todos", seed: "tree-40", open: todos, surface: '.todos-tab [data-todo="1"] .todo-row-button' },
] as const;

// A Todo row's body is its title button, so U7276b's `u7276b_a_todo_title_button_drags` is this test's Todos row.
it.each(SURFACES.filter(row => row.list !== "todos"))("u7276a_a_press_on_the_row_body_and_a_move_drags_it ($list)", async ({ seed, open, surface }) => {
  await harness(seed, open, surface);
  await liftAndEscape(surface, await pointIn(surface, 4), 12);
}, 60_000);

it.each(SURFACES)("u7276a_a_press_under_the_threshold_stays_a_click ($list)", async ({ seed, open, surface }) => {
  await harness(seed, open, surface);
  const at = await pointIn(surface, 4);
  await browser("mouse", "move", String(at.x), String(at.y));
  await browser("mouse", "down");
  await browser("mouse", "move", String(at.x), String(at.y + 2));
  await browser("mouse", "up");
  await browser("wait", "--fn", "window.__hits === 1");
  expect(await read<boolean>("window.__dragged")).toBe(false);
  expect(await read<number>(REORDERS)).toBe(0);
}, 60_000);
