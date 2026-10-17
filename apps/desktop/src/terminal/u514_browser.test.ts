import { expect, it } from "vitest";
import { browser, read, url, wait } from "../ui/tabsBrowser";

const load = async (query = "") => {
  await browser("open", url(`/src/terminal/u514.html${query}`));
  await wait("document.body.dataset.ready === '1' && document.querySelectorAll('.turn-gutter').length >= 0");
};

it("u514_browser_the_gutters_select_turns_and_leave_the_columns", async () => {
  await load();
  await wait("document.querySelectorAll('.turn-gutter').length === 3");
  expect(await read<string[]>("[...document.querySelectorAll('.turn-gutter')].map(g => g.getAttribute('aria-label') + ':' + g.tagName)")).toEqual(["Select command: $ one:BUTTON", "Select command: $ two:BUTTON", "Select command: $ three:BUTTON"]);
  expect(await read<boolean>("[...document.querySelectorAll('.turn-gutter')].every(g => g.getBoundingClientRect().right <= document.querySelector('.xterm-screen').getBoundingClientRect().left)")).toBe(true);
  expect(await read<boolean>("(() => { const clip = document.querySelector('.pane-screen').getBoundingClientRect(); return [...document.querySelectorAll('.turn-gutter')].every(g => { const r = g.getBoundingClientRect(); return r.left >= clip.left && document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === g; }); })()")).toBe(true);
  const cols = await read<number>("window.__cols");

  await browser("click", ".turn-gutter:first-of-type");
  expect(await read<string>("window.__emu.selection()")).toBe("$ one\n1");
  await browser("eval", "document.querySelectorAll('.turn-gutter')[2].dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }))");
  expect(await read<string>("window.__emu.selection()")).toBe("$ one\n1\n$ two\n2\n$ three\n3");

  await load("?marks=none");
  expect(await read<number[]>("[document.querySelectorAll('.turn-gutter').length, window.__cols]")).toEqual([0, cols]);
}, 90_000);

it("u514_browser_a_turn_taller_than_the_screen_keeps_a_gutter_on_its_visible_rows", async () => {
  await load("?tall");
  await wait("document.querySelectorAll('.turn-gutter').length === 1");
  expect(await read<number>("Math.round(document.querySelector('.turn-gutter').getBoundingClientRect().height)")).toBeGreaterThan(100);
}, 90_000);
