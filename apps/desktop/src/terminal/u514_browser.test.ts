import { expect, it } from "vitest";
import { browser, read, url, wait } from "../ui/tabsBrowser";

const load = async (query = "") => {
  await browser("open", url(`/src/terminal/u514.html${query}`));
  await wait("document.body.dataset.ready === '1' && document.querySelectorAll('.turn-gutter').length >= 0");
};

it("u514_browser_the_gutters_select_turns_and_leave_the_columns", async () => {
  await load();
  await wait("document.querySelectorAll('.turn-gutter').length === 3");
  expect(await read<string[]>("[...document.querySelectorAll('.turn-gutter')].map(g => g.getAttribute('aria-label') + ':' + g.tagName)")).toEqual(Array(3).fill("Select command:BUTTON"));
  const cols = await read<number>("window.__cols");

  await browser("click", ".turn-gutter:first-of-type");
  expect(await read<string>("window.__emu.selection()")).toBe("$ one\n1");
  await browser("eval", "document.querySelectorAll('.turn-gutter')[2].dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }))");
  expect(await read<string>("window.__emu.selection()")).toBe("$ one\n1\n$ two\n2\n$ three\n3");

  await load("?marks=none");
  expect(await read<number[]>("[document.querySelectorAll('.turn-gutter').length, window.__cols]")).toEqual([0, cols]);
}, 90_000);
